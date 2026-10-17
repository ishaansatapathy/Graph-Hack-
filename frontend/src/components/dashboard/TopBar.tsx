"use client";

import Link from "next/link";
import { Play, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";
import type { StreamState } from "@/lib/scenario-store";
import type { Phase } from "@/lib/types";
import { fmtClock } from "./actor";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "working", label: "Agents working" },
  { phase: "merged", label: "Merged" },
  { phase: "conflict", label: "Conflict" },
  { phase: "evidence", label: "Evidence" },
  { phase: "tests", label: "Tests" },
  { phase: "fix", label: "Fix" },
  { phase: "verified", label: "Verified" },
];

export function TopBar({
  repo,
  sessionId,
  phase,
  stream,
  clock,
  durationMs,
  onRun,
  onStop,
}: {
  repo?: string;
  sessionId?: string;
  phase: Phase;
  stream: StreamState;
  clock: number;
  durationMs?: number;
  onRun: () => void;
  onStop: () => void;
}) {
  const idx = STEPS.findIndex((s) => s.phase === phase);
  const running = stream === "live" || stream === "connecting";
  const progress = durationMs ? Math.min(1, clock / durationMs) : 0;

  return (
    <header className="relative z-10 flex h-12 items-center gap-4 border-b border-line bg-surface-1 px-4">
      <Link href="/" className="flex items-center gap-2 text-fg" aria-label="Stackfox home">
        <Logo className="size-[18px] text-accent" />
        <span className="text-[13px] font-semibold tracking-[0.12em]">STACKFOX</span>
      </Link>
      <span className="h-4 w-px bg-line-strong" />
      <div className="hidden min-w-0 items-center gap-2 font-mono text-[11.5px] text-fg-3 xl:flex">
        <span className="truncate text-fg-2">{repo ?? "—"}</span>
        <span>/</span>
        <span>{sessionId ?? "—"}</span>
      </div>

      <ol className="mx-auto flex items-center gap-1" aria-label="Scenario progress">
        {STEPS.map((s, i) => {
          const done = idx > i || phase === "verified";
          const active = idx === i && phase !== "verified";
          const tone =
            s.phase === "conflict" && (active || done) ? "text-conflict" : s.phase === "verified" && done ? "text-pass" : active ? "text-fg" : done ? "text-fg-2" : "text-fg-3";
          return (
            <li key={s.phase} className="flex items-center gap-1">
              {i > 0 && <span className={cn("h-px w-3 transition-colors duration-500 2xl:w-5", done || active ? "bg-fg-3" : "bg-line-strong")} />}
              <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] transition-colors duration-500", active && "bg-surface-3", tone)}>
                <span
                  className={cn(
                    "size-1.5 rounded-full transition-colors duration-500",
                    s.phase === "conflict" && (active || done) ? "bg-conflict" : s.phase === "verified" && done ? "bg-pass" : active ? "bg-accent" : done ? "bg-fg-2" : "bg-fg-3/50",
                  )}
                />
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-3">
        <StreamBadge stream={stream} />
        <span className="w-[72px] text-right font-mono text-[11.5px] tabular text-fg-2">{fmtClock(clock)}</span>
        {running ? (
          <Button size="sm" onClick={onStop}>
            <Square size={11} strokeWidth={1.5} /> Stop
          </Button>
        ) : null}
        <Button size="sm" variant="primary" onClick={onRun}>
          {stream === "idle" ? <Play size={12} strokeWidth={2} /> : <RotateCcw size={12} strokeWidth={2} />}
          {stream === "idle" ? "Run scenario" : "Replay"}
        </Button>
      </div>

      <div className="absolute inset-x-0 bottom-[-1px] h-px overflow-hidden">
        <div
          className={cn("h-full origin-left bg-accent transition-transform duration-500 ease-linear", phase === "verified" && "bg-pass")}
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </header>
  );
}

function StreamBadge({ stream }: { stream: StreamState }) {
  const map: Record<StreamState, { label: string; dot: string; text: string }> = {
    idle: { label: "Ready", dot: "bg-fg-3", text: "text-fg-3" },
    connecting: { label: "Connecting", dot: "bg-risk", text: "text-fg-2" },
    live: { label: "Live", dot: "bg-pass", text: "text-fg-2" },
    ended: { label: "Ended", dot: "bg-fg-3", text: "text-fg-3" },
    error: { label: "Disconnected", dot: "bg-conflict", text: "text-conflict" },
  };
  const s = map[stream];
  return (
    <span className={cn("flex items-center gap-1.5 text-[11.5px]", s.text)}>
      <span className="relative flex size-1.5">
        {stream === "live" && <span className={cn("pulse-ring absolute inset-0 rounded-full", s.dot)} />}
        <span className={cn("relative size-1.5 rounded-full", s.dot)} />
      </span>
      {s.label}
    </span>
  );
}
