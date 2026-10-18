"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileCode2, GitBranch, GitCommit, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { apiFetch, errorMessage, useResource, ViewError, ViewLoading, type OpenTab } from "./shared";

interface Conflict {
  id: string;
  file: string;
  authorA: string;
  commitShaA: string;
  messageA: string;
  branchA: string;
  authorB: string;
  commitShaB: string;
  messageB: string;
  branchB: string;
  evidence?: "overlapping_hunks" | "diff_unavailable";
  overlappingLines?: string[];
  patchA?: string;
  patchB?: string;
  source: "commits" | "import";
}

interface Review {
  suggestion: string;
  model: string;
  rateLimited: boolean;
  graphContextUsed: boolean;
}

type ReviewState = { status: "loading" } | { status: "done"; review: Review } | { status: "error"; message: string };

export function ConflictsView({ onOpenTab }: { onOpenTab?: OpenTab }) {
  const { state, reload } = useResource<{ conflicts: Conflict[] }>("/api/conflicts");
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});

  if (state.status === "loading") return <ViewLoading label="Checking the workspace graph for conflicts…" />;
  if (state.status === "error") return <ViewError title="Couldn't load conflicts" error={state.error} onRetry={() => reload(false)} />;

  const { conflicts } = state.data;

  const review = async (c: Conflict) => {
    setReviews((r) => ({ ...r, [c.id]: { status: "loading" } }));
    try {
      const result = await apiFetch<Review>(`/api/conflicts/${encodeURIComponent(c.id)}/resolve`, { method: "POST", body: {} });
      setReviews((r) => ({ ...r, [c.id]: { status: "done", review: result } }));
    } catch (err) {
      setReviews((r) => ({ ...r, [c.id]: { status: "error", message: errorMessage(err) } }));
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold text-fg">Conflicts</h1>
            {conflicts.length > 0 && (
              <span className="rounded border border-conflict/30 bg-conflict/10 px-2 py-0.5 font-mono text-[11px] text-conflict">{conflicts.length} open</span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-fg-2">
            Files changed on two branches since they diverged. With GitHub connected, pushed-commit candidates are kept only when their diffs overlap.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => reload()} className="gap-2">
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </div>

      {conflicts.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-1">
          <EmptyState
            icon={<CheckCircle2 size={16} strokeWidth={1.5} className="text-pass" />}
            title="No open conflicts"
            body="Conflicts appear when two branches change the same file — from a repository import in Studio or from GitHub push webhooks."
            action={
              onOpenTab && (
                <Button size="sm" onClick={() => onOpenTab("studio")}>
                  Import a repository in Studio
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          {conflicts.map((c) => (
            <ConflictCard key={c.id} c={c} r={reviews[c.id]} onReview={() => void review(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileInsight {
  owners: { author: string; commits: number }[];
  impact: { caller: string; file: string }[];
  issues: { key: string; title: string; status: string }[];
  primaryOwner: string | null;
}

/** Same rule as the conflict reviewer: a side is outside its usual area if none of its authors does much in this file. */
function outsideUsualArea(insight: FileInsight, sides: string[]) {
  const primary = insight.owners[0];
  if (!primary) return [];
  return sides.filter((side) => {
    const names = side.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length === 0 || names.includes(primary.author)) return false;
    const share = Math.max(0, ...names.map((n) => insight.owners.find((o) => o.author === n)?.commits ?? 0));
    return share * 3 < primary.commits;
  });
}

function insightSummary(insight: FileInsight | null) {
  if (!insight) return "Loading graph context…";
  return [
    insight.primaryOwner ? `Owner: ${insight.primaryOwner}` : "No ownership history in the graph",
    insight.issues.length ? `Issues: ${insight.issues.map((i) => i.key).join(", ")}` : "",
    insight.impact.length ? `${insight.impact.length} dependent caller(s) in other files` : "",
  ].filter(Boolean).join(" · ");
}

function ConflictCard({ c, r, onReview }: { c: Conflict; r?: ReviewState; onReview: () => void }) {
  const [insight, setInsight] = useState<FileInsight | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<FileInsight>(`/api/graph/file-insight?file=${encodeURIComponent(c.file)}`, { signal: ctrl.signal })
      .then(setInsight)
      .catch(() => {});
    return () => ctrl.abort();
  }, [c.file]);

  return (
    <article className="rounded-lg border border-line bg-surface-1 p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex min-w-0 items-center gap-2 font-mono text-[12.5px]">
          <FileCode2 className="size-4 shrink-0 text-conflict" />
          <span className="cursor-help truncate text-fg" title={insightSummary(insight)}>{c.file}</span>
          <span className="rounded bg-surface-2 px-1.5 text-[10px] uppercase text-fg-3">{c.source === "import" ? "repo import" : "pushed commits"}</span>
        </div>
        <Button size="sm" variant="primary" onClick={onReview} disabled={r?.status === "loading"} className="gap-2">
          {r?.status === "loading" ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-accent-ink" />}
          {r?.status === "done" ? "Review again" : "Review with AI"}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Side branch={c.branchA} author={c.authorA} sha={c.commitShaA} message={c.messageA} tone="text-accent" />
        <Side branch={c.branchB} author={c.authorB} sha={c.commitShaB} message={c.messageB} tone="text-agent-b" />
      </div>

      <div className="mt-4 font-mono text-[11.5px] text-fg-2">
        {c.evidence === "overlapping_hunks" ? (
          <p>
            <span className="text-conflict">Overlapping edits:</span> {c.overlappingLines?.join(", ")}
          </p>
        ) : (
          <p className="text-fg-3">
            Line-level evidence unavailable{c.source === "import" ? " for imported branches" : " — connect GitHub with the repository to compare diffs"}.
          </p>
        )}
      </div>

      {(c.patchA || c.patchB) && (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {[c.patchA, c.patchB].map((patch, i) =>
            patch ? (
              <pre key={i} className="max-h-64 overflow-auto rounded border border-line bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-fg-2">
                {patch}
              </pre>
            ) : null,
          )}
        </div>
      )}

      <InsightPanel conflict={c} insight={insight} />

    {r?.status === "error" && <p className="mt-4 font-mono text-[12px] text-conflict">{r.message}</p>}
      {r?.status === "done" && (
        <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-4">
          <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-fg-3">
            <span className="text-accent">AI review · {r.review.model}</span>
            <span>{r.review.graphContextUsed ? "used graph context" : "no graph context found"}</span>
          </div>
          {r.review.rateLimited ? (
            <p className="text-[12.5px] text-risk">The AI provider rate-limited this request. Try again shortly.</p>
          ) : (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg">{r.review.suggestion}</p>
          )}
          <p className="mt-3 text-[11px] text-fg-3">Advice only — nothing was changed, merged, or tested.</p>
        </div>
      )}
    </article>
  );
}

function InsightPanel({ conflict: c, insight }: { conflict: Conflict; insight: FileInsight | null }) {
  if (!insight || (!insight.owners.length && !insight.issues.length && !insight.impact.length)) return null;
  const outsiders = outsideUsualArea(insight, [c.authorA, c.authorB]);
  return (
    <div className="mt-4 space-y-1.5 rounded-lg border border-line bg-surface-2/40 p-3 font-mono text-[11.5px] text-fg-2">
      <p className="text-[10.5px] uppercase tracking-wider text-fg-3">Graph context · FalkorDB</p>
      {outsiders.map((author) => (
        <p key={author} className="text-risk">
          {author} rarely works in this file; {insight.primaryOwner} usually does. Ask them to review that side.
        </p>
      ))}
      {insight.owners.length > 0 && <p>Owners: {insight.owners.map((o) => `${o.author} (${o.commits})`).join(", ")}</p>}
      {insight.issues.length > 0 && (
        <p>Linked issues: {insight.issues.map((i) => `${i.key}${i.title ? ` ${i.title}` : ""}${i.status ? ` [${i.status}]` : ""}`).join(" · ")}</p>
      )}
      {insight.impact.length > 0 && <p>Re-test callers: {insight.impact.map((i) => `${i.caller} (${i.file})`).join(", ")}</p>}
    </div>
  );
}

function Side({ branch, author, sha, message, tone }: { branch: string; author: string; sha: string; message: string; tone: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 p-4">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-line pb-2 font-mono text-[11px]">
        <span className={`flex min-w-0 items-center gap-1.5 ${tone}`}>
          <GitBranch className="size-3.5 shrink-0" />
          <span className="truncate">{branch || "unknown branch"}</span>
        </span>
        {sha && (
          <span className="flex shrink-0 items-center gap-1 text-fg-3">
            <GitCommit className="size-3" /> {sha}
          </span>
        )}
      </div>
      {author && <p className="font-mono text-[11px] text-fg-3">{author}</p>}
      {message && <p className="mt-1 text-[12.5px] text-fg">{message}</p>}
    </div>
  );
}
