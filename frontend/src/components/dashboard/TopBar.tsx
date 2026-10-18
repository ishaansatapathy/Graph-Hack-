"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";
import type { StreamState } from "@/lib/scenario-store";
import type { Phase } from "@/lib/types";
import { fmtClock } from "./actor";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "working", label: "Branches" },
  { phase: "merged", label: "Clean" },
  { phase: "conflict", label: "Conflict" },
  { phase: "evidence", label: "Evidence" },
];

export type TopBarTab = "studio" | "ide" | "vault" | "integrations" | "workspace" | "conflicts";

const NAV_TABS: { id: TopBarTab; label: string }[] = [
  { id: "studio", label: "Studio" },
  { id: "ide", label: "IDE" },
  { id: "vault", label: "API Vault" },
  { id: "integrations", label: "Integrations" },
  { id: "workspace", label: "Workspace" },
  { id: "conflicts", label: "Conflicts" },
];

export function TopBar({
  repo,
  workspace,
  phase,
  stream,
  clock,
  importing,
  importError,
  onImport,
  onReconnect,
  activeTab = "studio",
  onSelectTab,
}: {
  repo?: string | null;
  workspace?: string;
  phase: Phase;
  stream: StreamState;
  clock: number;
  importing: boolean;
  importError?: string;
  onImport: (repo: string) => void;
  onReconnect: () => void;
  activeTab?: TopBarTab;
  onSelectTab?: (tab: TopBarTab) => void;
}) {
  const idx = STEPS.findIndex((s) => s.phase === phase);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  return (
    <header className="relative z-10 flex h-12 items-center gap-3 border-b border-line bg-surface-1 px-4">
      <Link href="/" className="flex items-center gap-2 text-fg" aria-label="Stackfox home">
        <Logo className="size-[18px] text-accent" />
        <span className="text-[13px] font-semibold tracking-[0.12em]">STACKFOX</span>
      </Link>

      <span className="h-4 w-px bg-line-strong" />

      <nav className="flex items-center gap-1 font-mono text-[11.5px]">
        {NAV_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab?.(tab.id)}
            className={cn(
              "rounded px-2.5 py-1 transition-colors",
              activeTab === tab.id ? "bg-surface-3 font-semibold text-accent shadow-sm" : "text-fg-3 hover:bg-surface-2 hover:text-fg-2",
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <span className="hidden h-4 w-px bg-line-strong lg:block" />

      <div className="hidden min-w-0 items-center gap-2 font-mono text-[11px] text-fg-3 2xl:flex">
        <span className="truncate text-fg-2">{workspace ?? "—"}</span>
        <span>/</span>
        <span className="truncate">{repo ?? "no repository"}</span>
      </div>

      {activeTab === "studio" ? (
        <ol className="mx-auto hidden items-center gap-1 min-[1280px]:flex" aria-label="Workspace state">
          {STEPS.map((s, i) => {
            const done = idx > i;
            const active = idx === i;
            const tone = s.phase === "conflict" && (active || done) ? "text-conflict" : active ? "text-fg" : done ? "text-fg-2" : "text-fg-3";
            return (
              <li key={s.phase} className="flex items-center gap-1">
                {i > 0 && <span className={cn("h-px w-2.5 transition-colors duration-500 2xl:w-4", done || active ? "bg-fg-3" : "bg-line-strong")} />}
                <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors duration-500", active && "bg-surface-3", tone)}>
                  <span
                    className={cn(
                      "size-1.5 rounded-full transition-colors duration-500",
                      s.phase === "conflict" && (active || done) ? "bg-conflict" : active ? "bg-accent" : done ? "bg-fg-2" : "bg-fg-3/50",
                    )}
                  />
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <span className="mx-auto" />
      )}

      <div className="ml-auto flex items-center gap-3">
        {activeTab === "studio" ? (
          <>
            <StreamBadge stream={stream} />
            <span className="w-[68px] text-right font-mono text-[11.5px] tabular text-fg-2">{fmtClock(clock)}</span>
            {(stream === "ended" || stream === "error") && (
              <Button size="sm" onClick={onReconnect}>
                <RotateCcw size={12} strokeWidth={2} /> Reconnect
              </Button>
            )}
            <form
              className="relative flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) {
                  setHint(true);
                  input.current?.focus();
                  return;
                }
                setHint(false);
                onImport(draft.trim());
              }}
            >
              <input
                ref={input}
                aria-label="GitHub repository"
                aria-invalid={hint || !!importError}
                placeholder={repo ?? "owner/repo"}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setHint(false);
                }}
                className={cn(
                  "h-7 w-[170px] rounded-[var(--radius-control)] border border-line-strong bg-surface-2 px-2.5 font-mono text-[11.5px] text-fg outline-none placeholder:text-fg-3 focus:border-accent/60",
                  (hint || importError) && "border-conflict/60",
                )}
              />
              <Button size="sm" variant="primary" type="submit" disabled={importing}>
                {importing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} strokeWidth={2} />}
                {importing ? "Importing" : "Import"}
              </Button>
              {(hint || importError) && (
                <p role="alert" className="surface absolute right-0 top-[calc(100%+8px)] w-[320px] px-3 py-2 text-[12px] leading-relaxed text-conflict">
                  {hint ? "Type a GitHub repository first, e.g. expressjs/express" : importError}
                </p>
              )}
            </form>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onSelectTab?.("studio")} className="font-mono text-[11.5px] text-accent">
            ← Back to Graph Studio
          </Button>
        )}
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
