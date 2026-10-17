"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowDown, ChevronDown, ShieldCheck, TerminalSquare } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { cn } from "@/lib/cn";
import type { StreamState } from "@/lib/scenario-store";
import type { Agent, ToolCallEvent } from "@/lib/types";
import { actorStyle, fmtClock } from "./actor";

type Filter = "all" | "tools" | "agents" | "stackfox";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tools", label: "MCP tool calls" },
  { id: "agents", label: "Agents" },
  { id: "stackfox", label: "Stackfox" },
];

export function EventLog({
  log,
  agents,
  stream,
  streamError,
  open,
  onToggle,
  onRun,
}: {
  log: ToolCallEvent[];
  agents: Agent[];
  stream: StreamState;
  streamError?: string;
  open: boolean;
  onToggle: () => void;
  onRun: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const agentIds = useMemo(() => new Set(agents.map((a) => a.id)), [agents]);

  const rows = useMemo(
    () =>
      log.filter((e) =>
        filter === "all" ? true : filter === "tools" ? e.kind === "tool_call" || e.kind === "tool_result" : filter === "agents" ? agentIds.has(e.actor) : (e.actor === "stackfox" || e.actor === "synk"),
      ),
    [log, filter, agentIds],
  );
  const toolCalls = log.filter((e) => e.kind === "tool_call").length;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [rows.length, stick, open]);

  // A fresh run re-pins the log to the bottom.
  const [wasEmpty, setWasEmpty] = useState(log.length === 0);
  if (wasEmpty !== (log.length === 0)) {
    setWasEmpty(log.length === 0);
    if (log.length === 0) setStick(true);
  }

  return (
    <section className={cn("flex min-h-0 flex-col border-t border-line bg-surface-1", open ? "h-[clamp(200px,30vh,300px)]" : "h-10")}>
      <div className="flex h-10 shrink-0 items-center gap-3 px-4">
        <button onClick={onToggle} className="flex items-center gap-2 text-fg-2 hover:text-fg" aria-expanded={open}>
          <TerminalSquare size={13} strokeWidth={1.5} />
          <span className="eyebrow !text-inherit">Event log</span>
          <ChevronDown size={13} strokeWidth={1.5} className={cn("transition-transform duration-300", !open && "rotate-180")} />
        </button>
        <span className="font-mono text-[11px] tabular text-fg-3">
          {log.length} events · {toolCalls} tool calls
        </span>
        {open && (
          <div className="ml-auto flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn("rounded-[4px] px-2 py-0.5 text-[11.5px] transition-colors", filter === f.id ? "bg-surface-4 text-fg" : "text-fg-3 hover:text-fg-2")}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {open && (
        <div className="relative min-h-0 flex-1">
          <div
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
            }}
            className="h-full overflow-y-auto pb-2 font-mono text-[12px] leading-[20px]"
            role="log"
            aria-live="polite"
          >
            {stream === "error" && <ErrorState title="Event stream disconnected" message={streamError} onRetry={onRun} />}
            {stream !== "error" && log.length === 0 && (
              <EmptyState
                icon={<TerminalSquare size={16} strokeWidth={1.5} />}
                title={stream === "connecting" ? "Connecting to agents…" : "No events yet"}
                body="Run the scenario to stream every agent action and MCP tool call — with arguments and results — as it happens."
              />
            )}
            {rows.map((e) => (
              <LogRow key={e.id} e={e} agents={agents} />
            ))}
            {stream === "live" && (
              <div className="px-4 text-fg-3">
                <span className="caret">▍</span>
              </div>
            )}
          </div>
          {!stick && rows.length > 0 && (
            <button
              onClick={() => setStick(true)}
              className="absolute bottom-3 right-4 flex items-center gap-1.5 rounded-full border border-line-strong bg-surface-3 px-2.5 py-1 text-[11.5px] text-fg-2 hover:text-fg"
            >
              <ArrowDown size={12} strokeWidth={1.5} /> Latest
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function fmtArgs(args?: Record<string, unknown>) {
  if (!args) return "";
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
}

function fmtResult(r: unknown) {
  const s = JSON.stringify(r);
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}

const KIND_ROW: Partial<Record<ToolCallEvent["kind"], string>> = {
  conflict: "bg-conflict/[0.07] shadow-[inset_2px_0_0_var(--conflict)]",
  recall: "bg-risk/[0.06] shadow-[inset_2px_0_0_var(--risk)]",
  verified: "bg-pass/[0.07] shadow-[inset_2px_0_0_var(--pass)]",
  fix: "shadow-[inset_2px_0_0_var(--accent)]",
};

function LogRow({ e, agents }: { e: ToolCallEvent; agents: Agent[] }) {
  const a = actorStyle(e.actor, agents);
  const [expanded, setExpanded] = useState(false);

  const body = (() => {
    switch (e.kind) {
      case "tool_call":
        return (
          <span>
            <span className="text-fg-3">→ </span>
            <span className="text-accent">{e.tool}</span>
            <span className="text-fg-3">(</span>
            <span className="text-fg-2">{fmtArgs(e.args)}</span>
            <span className="text-fg-3">)</span>
          </span>
        );
      case "tool_result":
        return (
          <button className="text-left" onClick={() => setExpanded((x) => !x)}>
            <span className="text-fg-3">← </span>
            <span className="text-fg">{e.message}</span>
            {e.durationMs != null && <span className="text-fg-3"> · {e.durationMs}ms</span>}
            <span className="text-fg-3"> {expanded ? "" : fmtResult(e.result)}</span>
            {expanded && <pre className="mt-1 whitespace-pre-wrap rounded-[var(--radius-control)] border border-line bg-surface-2 px-2 py-1.5 text-[11.5px] text-fg-2">{JSON.stringify(e.result, null, 2)}</pre>}
          </button>
        );
      case "conflict":
        return <span className="text-conflict">CONFLICT · {e.message}</span>;
      case "recall":
        return <span className="text-risk">{e.message}</span>;
      case "verified":
        return <span className="text-pass">{e.message}</span>;
      case "merge":
        return <span className="text-fg">{e.message}</span>;
      case "test":
        return <span className={e.message.startsWith("✗") ? "text-conflict" : e.message.startsWith("✓") ? "text-pass" : "text-fg-2"}>{e.message}</span>;
      default:
        return <span className="text-fg-2">{e.message}</span>;
    }
  })();

  if (e.kind === "prevented") return <PreventedRow e={e} label={a.label} text={a.text} />;

  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn("grid grid-cols-[84px_76px_1fr] gap-3 px-4", KIND_ROW[e.kind])}
    >
      <span className="tabular text-fg-3">{fmtClock(e.at)}</span>
      <span className={cn("truncate", a.text)}>{a.label}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{body}</span>
    </motion.div>
  );
}

/** Prevention is distinct from detection: amber "risk" settles into green "prevented". */
function PreventedRow({ e, label, text }: { e: ToolCallEvent; label: string; text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative my-1 grid grid-cols-[84px_76px_1fr] gap-3 overflow-hidden px-4 py-1"
    >
      <motion.span aria-hidden className="absolute inset-0 bg-risk/10 shadow-[inset_2px_0_0_var(--risk)]" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: 0.9, duration: 0.7 }} />
      <motion.span aria-hidden className="absolute inset-0 bg-pass/[0.08] shadow-[inset_2px_0_0_var(--pass)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.7 }} />
      <span className="relative tabular text-fg-3">{fmtClock(e.at)}</span>
      <span className={cn("relative truncate", text)}>{label}</span>
      <span className="relative flex min-w-0 items-start gap-2">
        <ShieldCheck size={13} strokeWidth={1.5} className="mt-[3px] shrink-0 text-pass" />
        <span>
          <span className="text-pass">PREVENTED · </span>
          <span className="text-fg">{e.message}</span>
        </span>
      </span>
    </motion.div>
  );
}
