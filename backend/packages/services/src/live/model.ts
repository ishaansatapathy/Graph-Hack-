import type { AgentSlot, NodeKind } from "./types";

/** Graph label → dashboard node kind. Labels not listed here stay out of the canvas. */
const KIND_BY_LABEL: Record<string, NodeKind> = {
  Change: "change",
  Commit: "change",
  File: "file",
  Function: "function",
  Test: "test",
  Issue: "issue",
  Discussion: "issue",
  Decision: "issue",
  Conflict: "incident",
  Endpoint: "endpoint",
  Schema: "schema",
  Field: "field",
};

export function kindForLabel(label: string): NodeKind | null {
  return KIND_BY_LABEL[label] ?? null;
}

/** Stable, human-readable node id — the same id is used in snapshots and live patches. */
export function nodeKey(label: string, props: Record<string, unknown>, internalId: string): string {
  switch (label) {
    case "Change":
      return `change:${props.id}`;
    case "Commit":
      return `commit:${props.sha}`;
    case "File":
      return `file:${props.path}`;
    case "Function":
      return `fn:${props.file ?? ""}#${props.name}`;
    case "Test":
      return `test:${props.name}`;
    case "Issue":
      return `issue:${props.key}`;
    case "Conflict":
      return `conflict:${props.id}`;
    default:
      return `${label.toLowerCase()}:${internalId}`;
  }
}

export function nodeLabel(label: string, props: Record<string, unknown>): string {
  switch (label) {
    case "Change":
      return String(props.branch ?? props.id);
    case "Commit":
      return String(props.sha ?? "").slice(0, 7);
    case "File":
      return String(props.path ?? "").split("/").pop() || String(props.path);
    case "Function":
      return `${props.name}()`;
    case "Conflict":
      return `⚠ ${String(props.file ?? "").split("/").pop()}`;
    default:
      return String(props.name ?? props.key ?? props.title ?? props.id ?? label);
  }
}

/** Graph relationship type → dashboard edge kind. */
export function edgeKind(type: string): string {
  if (type === "MODIFIED") return "MODIFIES";
  if (type === "AFFECTS" || type === "BETWEEN") return "INVOLVED";
  return type;
}

export const changeId = (repo: string, branch: string) => `${repo}@${branch}`;
export const agentId = (repo: string, branch: string) => `agent:${repo}@${branch}`;
export const slotFor = (index: number): AgentSlot => (["a", "b", "c"] as const)[index % 3]!;

export function fileLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
    py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", rb: "ruby",
    cs: "csharp", cpp: "cpp", c: "c", h: "c", json: "json", yaml: "yaml", yml: "yaml",
    md: "markdown", sh: "shell", css: "css", html: "html", sql: "sql",
  };
  return map[ext] ?? "plaintext";
}
