"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage } from "@/components/views/shared";

type Answer = {
  answer: string;
  model: string;
  rateLimited: boolean;
  cypher: string[];
  evidenceCount: number;
};

const EXAMPLES = ["Which files do several branches change?", "What issues are linked to recent commits?"];

/** GraphRAG question box: the answer is built only from this workspace's FalkorDB graph. */
export function AskGraph() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState("");

  async function ask(q: string) {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      setResult(await apiFetch<Answer>("/api/graph/ask", { method: "POST", body: { question: text } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-line">
      <div className="flex h-10 items-center gap-2 px-4">
        <Sparkles size={13} strokeWidth={1.5} className="text-fg-3" />
        <span className="eyebrow">Ask the graph</span>
      </div>
      <form
        className="space-y-2 px-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <textarea
          aria-label="Question about this workspace"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          rows={2}
          maxLength={1000}
          placeholder="Why did lib/request.js change?"
          className="w-full resize-none rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-2.5 py-2 text-[12.5px] text-fg outline-none placeholder:text-fg-3 focus:border-accent/60"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap gap-1">
            {!result &&
              EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setQuestion(ex);
                    void ask(ex);
                  }}
                  className="truncate rounded px-1.5 py-0.5 text-left text-[11px] text-fg-3 hover:bg-surface-2 hover:text-fg-2"
                >
                  {ex}
                </button>
              ))}
          </div>
          <Button size="sm" variant="primary" type="submit" disabled={busy || !question.trim()}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {busy ? "Thinking" : "Ask"}
          </Button>
        </div>

        {error && <p role="alert" className="text-[12px] leading-relaxed text-conflict">{error}</p>}

        {result && (
          <div className="surface space-y-2 p-3">
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg">{result.answer}</p>
            <p className="font-mono text-[10.5px] text-fg-3">
              {result.evidenceCount} graph facts · {result.model}
              {result.rateLimited ? " · rate limited" : ""}
            </p>
            {result.cypher.length > 0 && (
              <details className="font-mono text-[10.5px] text-fg-3">
                <summary className="cursor-pointer hover:text-fg-2">Graph queries used ({result.cypher.length})</summary>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{result.cypher.join("\n")}</pre>
              </details>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
