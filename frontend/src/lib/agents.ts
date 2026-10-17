import type { AgentSlot, AgentStatus } from "./types";
import type { TokenName } from "./tokens";

/** Static class maps so Tailwind can see every agent utility. */
export const AGENT_STYLE: Record<AgentSlot, { text: string; bg: string; border: string; dot: string; token: TokenName }> = {
  a: { text: "text-agent-a", bg: "bg-agent-a/10", border: "border-agent-a/30", dot: "bg-agent-a", token: "agent-a" },
  b: { text: "text-agent-b", bg: "bg-agent-b/10", border: "border-agent-b/30", dot: "bg-agent-b", token: "agent-b" },
  c: { text: "text-agent-c", bg: "bg-agent-c/10", border: "border-agent-c/30", dot: "bg-agent-c", token: "agent-c" },
};

export const STATUS_STYLE: Record<AgentStatus, { label: string; text: string; dot: string }> = {
  idle: { label: "Idle", text: "text-fg-3", dot: "bg-fg-3" },
  working: { label: "Working", text: "text-fg-2", dot: "bg-accent" },
  blocked: { label: "Blocked", text: "text-risk", dot: "bg-risk" },
  adapted: { label: "Adapted", text: "text-pass", dot: "bg-pass" },
  verified: { label: "Verified", text: "text-pass", dot: "bg-pass" },
};
