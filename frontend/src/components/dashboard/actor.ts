import { AGENT_STYLE } from "@/lib/agents";
import type { Agent } from "@/lib/types";

export function actorStyle(actor: string, agents: Agent[]) {
  const a = agents.find((x) => x.id === actor);
  if (a) return { label: a.name.replace("Agent ", "agent-").toLowerCase(), text: AGENT_STYLE[a.slot].text, dot: AGENT_STYLE[a.slot].dot };
  if (actor === "stackfox" || actor === "synk") return { label: "stackfox", text: "text-accent", dot: "bg-accent" };
  return { label: actor, text: "text-fg-2", dot: "bg-fg-3" };
}

export function fmtClock(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = Math.floor(ms % 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}
