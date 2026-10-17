/**
 * AI Router — task-based model selection + rate limiting.
 *
 * Philosophy:
 *   Simple tasks  → gpt-4o-mini   (fast, cheap, free-tier friendly)
 *   Complex tasks → gpt-4o        (used only when really needed)
 *
 * Rate limiting is enforced per-workspace per minute (in-memory sliding window).
 * No external dep — uses the OpenAI REST API directly via fetch.
 */

import { env } from "../env";
import { redactSecrets } from "../graph/redact";

// ── Task complexity classification ──────────────────────────────────────────

export type TaskComplexity = "simple" | "complex";

const COMPLEX_SIGNALS = [
  /conflict/i, /resolv/i, /architect/i, /refactor/i, /secur/i,
  /vulnerab/i, /performance/i, /optimi/i, /design/i, /review/i,
  /explain.*why/i, /how does/i, /compare/i, /tradeoff/i,
];

export function classifyTask(prompt: string): TaskComplexity {
  const tokens = prompt.split(/\s+/).length;
  if (tokens > 120) return "complex";
  if (COMPLEX_SIGNALS.some((r) => r.test(prompt))) return "complex";
  return "simple";
}

// ── Model selection ──────────────────────────────────────────────────────────

const MODELS: Record<TaskComplexity, string> = {
  simple:  "gpt-4o-mini",
  complex: "gpt-4o",
};

export function modelForTask(complexity: TaskComplexity): string {
  return MODELS[complexity];
}

// ── Rate limiting (sliding window, in-memory) ────────────────────────────────

const RATE_LIMIT_RPM = 20;           // max requests per minute per workspace
const RATE_LIMIT_COMPLEX_RPM = 5;    // stricter for gpt-4o

const rateWindows = new Map<string, number[]>(); // workspaceId → [timestamps]

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export function checkRateLimit(workspaceId: string, complexity: TaskComplexity): RateLimitResult {
  const key = `${workspaceId}:${complexity}`;
  const now = Date.now();
  const window = 60_000; // 1 minute
  const limit = complexity === "complex" ? RATE_LIMIT_COMPLEX_RPM : RATE_LIMIT_RPM;

  let timestamps = rateWindows.get(key) ?? [];
  timestamps = timestamps.filter((t) => now - t < window);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0] ?? now;
    return { ok: false, retryAfterMs: window - (now - oldest) };
  }

  timestamps.push(now);
  rateWindows.set(key, timestamps);
  return { ok: true };
}

// ── OpenAI completion ────────────────────────────────────────────────────────

export type Message = { role: "system" | "user" | "assistant"; content: string };

export type CompletionOptions = {
  messages: Message[];
  workspaceId: string;
  /** Override model selection — if not provided, auto-routed by prompt complexity. */
  forceModel?: string;
  maxTokens?: number;
  temperature?: number;
};

export type CompletionResult = {
  content: string;
  model: string;
  complexity: TaskComplexity;
  promptTokens: number;
  completionTokens: number;
  rateLimited: boolean;
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export async function complete(opts: CompletionOptions): Promise<CompletionResult> {
  const userPrompt =
    [...opts.messages].reverse().find((m: Message) => m.role === "user")?.content ?? "";
  const complexity = classifyTask(userPrompt);
  const model = opts.forceModel ?? modelForTask(complexity);

  // Rate limit check
  const rl = checkRateLimit(opts.workspaceId, complexity);
  if (!rl.ok) {
    return {
      content: `⚠️ Rate limit reached. Please wait ${Math.ceil(rl.retryAfterMs / 1000)}s before sending another ${complexity} request.`,
      model,
      complexity,
      promptTokens: 0,
      completionTokens: 0,
      rateLimited: true,
    };
  }

  const apiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured. Add it to your .env file.");
  }

  // Sanitize: redact secrets from all user messages before sending
  const cleanMessages = opts.messages.map((m) => ({
    role: m.role,
    content: m.role === "user" ? redactSecrets(m.content) : m.content,
  }));

  const body = {
    model,
    messages: cleanMessages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.2,
  };

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
    model: string;
  };

  const content = data.choices[0]?.message?.content?.trim() ?? "";
  return {
    content,
    model: data.model ?? model,
    complexity,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    rateLimited: false,
  };
}

// ── GraphRAG-enhanced completion ─────────────────────────────────────────────
// Builds a system prompt that includes graph evidence from FalkorDB,
// then calls the AI with full context.

export async function completeWithGraphContext(opts: {
  workspaceId: string;
  question: string;
  graphContext: string;      // pre-fetched from GraphRAG
  memoryThread: Message[];   // sliding-window conversation history
  systemExtra?: string;
}): Promise<CompletionResult> {
  const systemContent = [
    "You are Stackfox AI — a graph-powered development assistant.",
    "You have access to the team's knowledge graph (code, issues, discussions, decisions) stored in FalkorDB.",
    "Use the provided graph context to give precise, evidence-backed answers.",
    "When you cite evidence, mention the node type (Function, Commit, Issue, etc.) and its key property.",
    "If the graph context is empty or insufficient, say so clearly.",
    opts.systemExtra ?? "",
  ]
    .filter(Boolean)
    .join("\n");

  const contextMessage: Message = {
    role: "user",
    content: `## Graph context from FalkorDB\n\n${opts.graphContext}\n\n---\n\n## Question\n${opts.question}`,
  };

  // Keep last 6 memory turns to avoid bloating the context
  const recent = opts.memoryThread.slice(-6);

  return complete({
    workspaceId: opts.workspaceId,
    messages: [
      { role: "system", content: systemContent },
      ...recent,
      contextMessage,
    ],
  });
}
