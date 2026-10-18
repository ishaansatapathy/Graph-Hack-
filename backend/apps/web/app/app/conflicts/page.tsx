"use client";

import { useCallback, useEffect, useState } from "react";

import { trpc } from "~/lib/trpc";
import { useFingerprint } from "~/lib/fingerprint";

type Conflict = {
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
  status: "open";
  evidence?: "overlapping_hunks" | "diff_unavailable";
  overlappingLines?: string[];
  patchA?: string;
  patchB?: string;
};

type Resolution = {
  conflictId: string;
  suggestion: string;
  model: string;
  graphContextUsed: boolean;
};

export default function ConflictsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Map<string, Resolution>>(new Map());
  const [error, setError] = useState("");
  const fp = useFingerprint();

  useEffect(() => {
    void trpc.workspace.current.query({}).then((ws) => setWorkspaceId(ws.id)).catch(() => {});
  }, []);

  const loadConflicts = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const list = await trpc.graph.conflicts.scan.query({ workspaceId });
      setConflicts((list ?? []) as Conflict[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conflicts from graph engine");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadConflicts();
  }, [loadConflicts]);

  async function resolveConflict(c: Conflict) {
    if (!workspaceId) return;
    setResolving(c.id);
    setError("");
    try {
      const result = await trpc.graph.conflicts.resolve.mutate({
        workspaceId,
        conflictId: c.id,
        file: c.file,
        authorA: c.authorA,
        commitShaA: c.commitShaA,
        messageA: c.messageA,
        branchA: c.branchA,
        authorB: c.authorB,
        commitShaB: c.commitShaB,
        messageB: c.messageB,
        branchB: c.branchB,
        evidence: c.evidence,
        overlappingLines: c.overlappingLines,
        patchA: c.patchA,
        patchB: c.patchB,
        fp: fp ?? undefined,
      });
      setResolutions((prev) => {
        const next = new Map(prev);
        next.set(c.id, {
          conflictId: c.id,
          suggestion: result?.suggestion ?? "",
          model: result?.model ?? "",
          graphContextUsed: result?.graphContextUsed ?? false,
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed");
    } finally {
      setResolving(null);
    }
  }

  const openConflicts = conflicts.filter((c) => c.status === "open");

  if (!workspaceId) return <p className="app-muted">Loading workspace context…</p>;

  return (
    <section className="app-section app-section--flat">
      <div className="app-conflicts-header">
        <div>
          <h2 className="app-conflicts-title">
            <span className="app-conflict-icon">⚡</span>
            Branch Change Review
          </h2>
          <p className="app-muted">
            The graph flags files changed on more than one branch. That is a review candidate, not proof of overlapping lines or a Git merge conflict. AI suggestions use commit metadata and need review against the actual diff.
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="app-btn-ghost app-btn-small"
            disabled={loading}
            onClick={() => void loadConflicts()}
          >
            ↻ Scan Graph
          </button>

        </div>
      </div>

      {/* KPI Stats Row */}
      <div className="usage-stat-grid" style={{ marginBottom: "20px" }}>
        <div className="stat-card">
          <span className="stat-label">POTENTIAL OVERLAPS</span>
          <span className="stat-value" style={{ color: openConflicts.length > 0 ? "var(--accent-red, #f87171)" : "inherit" }}>
            {openConflicts.length}
          </span>
          <span className="stat-sub">Possible same-file branch edits</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">AI SUGGESTIONS</span>
          <span className="stat-value" style={{ color: "var(--accent-green, #34d399)" }}>
            {resolutions.size}
          </span>
          <span className="stat-sub">Generated this session; review required</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">EVIDENCE AVAILABLE</span>
          <span className="stat-value" style={{ fontSize: "1.2rem", color: "#60a5fa" }}>
            {conflicts.some((c) => c.evidence === "overlapping_hunks") ? "Diff hunks" : "Scan required"}
          </span>
          <span className="stat-sub">Check actual diffs before merging.</span>
        </div>
      </div>

      {error ? <p className="app-flash app-flash--err">{error}</p> : null}

      {loading ? (
        <div className="app-conflicts-empty">
          <div className="app-spinner" />
          <p className="app-muted">Traversing code graph & branch commits…</p>
        </div>
      ) : openConflicts.length === 0 ? (
        <div className="app-conflicts-empty">
          <span className="app-conflicts-empty-icon">✓</span>
          <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>No same-file branch changes found in the current graph.</p>
          <p className="app-muted">
            No overlapping diff hunks were confirmed. GitHub compare evidence may also be unavailable.
          </p>

        </div>
      ) : null}

      {openConflicts.length > 0 ? (
        <div className="app-conflicts-section">
          <h3 className="app-section-title">
            Potential Branch Overlaps
            <span className="app-badge app-badge--err">{openConflicts.length}</span>
          </h3>
          <div className="app-conflicts-list">
            {openConflicts.map((c) => (
              <ConflictCard
                key={c.id}
                conflict={c}
                resolution={resolutions.get(c.id)}
                resolving={resolving === c.id}
                onResolve={() => void resolveConflict(c)}
              />
            ))}
          </div>
        </div>
      ) : null}

    </section>
  );
}

function ConflictCard({
  conflict: c,
  resolution,
  resolving,
  onResolve,
}: {
  conflict: Conflict;
  resolution?: Resolution;
  resolving: boolean;
  onResolve: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <article className="app-conflict-card">
      <div className="app-conflict-card-head">
        <div className="app-conflict-file">
          <span className="conflict-tag-icon">⚡</span>
          <code>{c.file}</code>
          <span className="app-pill app-pill--err">POSSIBLE OVERLAP</span>
        </div>
        <div className="app-conflict-actions">
          <button
            type="button"
            className="app-btn-ghost app-btn-small"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide Details" : "Show Branches"}
          </button>
          {c.status === "open" ? (
            <button
              type="button"
              className="app-btn app-btn-small app-btn--ai"
              disabled={resolving}
              onClick={onResolve}
            >
              {resolving ? (
                <>
                  <span className="app-spinner-sm" /> Generating suggestion…
                </>
              ) : (
                "Generate AI suggestion"
              )}
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="app-conflict-diff">
          <div className="app-conflict-side app-conflict-side--a">
            <div className="app-conflict-side-header">
              <span className="app-conflict-branch">Branch: {c.branchA}</span>
              <span className="app-conflict-author">@{c.authorA}</span>
            </div>
            <code className="app-conflict-sha">commit {c.commitShaA}</code>
            <p className="app-conflict-msg">{c.messageA}</p>
          </div>
          <div className="app-conflict-vs">VS</div>
          <div className="app-conflict-side app-conflict-side--b">
            <div className="app-conflict-side-header">
              <span className="app-conflict-branch">Branch: {c.branchB}</span>
              <span className="app-conflict-author">@{c.authorB}</span>
            </div>
            <code className="app-conflict-sha">commit {c.commitShaB}</code>
            <p className="app-conflict-msg">{c.messageB}</p>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div>
          <p className="app-muted">{c.evidence === "overlapping_hunks"
            ? `Potentially overlapping base ranges: ${(c.overlappingLines ?? []).join(", ")}`
            : "GitHub diff evidence unavailable; this item was not confirmed as a line conflict."}</p>
          {c.patchA ? <><strong>Branch A diff excerpt</strong><pre className="app-cypher">{c.patchA}</pre></> : null}
          {c.patchB ? <><strong>Branch B diff excerpt</strong><pre className="app-cypher">{c.patchB}</pre></> : null}
        </div>
      ) : null}

      {resolution ? (
        <div className="app-conflict-resolution">
          <div className="app-conflict-resolution-header">
            <span className="app-pill app-pill--on">AI suggestion · review required</span>
            <span className="app-muted" style={{ fontSize: "0.75rem" }}>
              {resolution.model}
              {resolution.graphContextUsed ? " · Linked graph context used" : ""}
            </span>
          </div>
          <pre className="app-cypher">{resolution.suggestion}</pre>
        </div>
      ) : null}
    </article>
  );
}
