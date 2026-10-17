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
  status: "open" | "resolved";
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
      const list = await trpc.graph.conflicts.list.query({ workspaceId });
      setConflicts((list ?? []) as Conflict[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conflicts");
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
      // Mark as resolved in local state
      setConflicts((prev) => prev.map((x) => x.id === c.id ? { ...x, status: "resolved" as const } : x));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolution failed");
    } finally {
      setResolving(null);
    }
  }

  const openConflicts = conflicts.filter((c) => c.status === "open");
  const resolvedConflicts = conflicts.filter((c) => c.status === "resolved");

  if (!workspaceId) return <p className="app-muted">Loading workspace…</p>;

  return (
    <section className="app-section app-section--flat">
      <div className="app-conflicts-header">
        <div>
          <h2 className="app-conflicts-title">
            <span className="app-conflict-icon">⚡</span>
            Conflict Detector
          </h2>
          <p className="app-muted">
            FalkorDB detects when teammates modify the same files on different branches. Click{" "}
            <strong>Resolve with AI</strong> to get an evidence-backed suggestion using your graph context.
          </p>
        </div>
        <button
          type="button"
          className="app-btn-ghost app-btn-small"
          onClick={() => void loadConflicts()}
        >
          ↻ Refresh
        </button>
      </div>

      {error ? <p className="app-flash app-flash--err">{error}</p> : null}

      {loading ? (
        <div className="app-conflicts-empty">
          <div className="app-spinner" />
          <p className="app-muted">Querying FalkorDB…</p>
        </div>
      ) : openConflicts.length === 0 && resolvedConflicts.length === 0 ? (
        <div className="app-conflicts-empty">
          <span className="app-conflicts-empty-icon">✓</span>
          <p>No conflicts detected in the graph.</p>
          <p className="app-muted">Load the demo graph or push commits to see conflicts.</p>
        </div>
      ) : null}

      {openConflicts.length > 0 ? (
        <div className="app-conflicts-section">
          <h3 className="app-section-title">
            Open conflicts
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

      {resolvedConflicts.length > 0 ? (
        <div className="app-conflicts-section">
          <h3 className="app-section-title">
            Resolved
            <span className="app-badge app-badge--ok">{resolvedConflicts.length}</span>
          </h3>
          <div className="app-conflicts-list">
            {resolvedConflicts.map((c) => (
              <ConflictCard
                key={c.id}
                conflict={c}
                resolution={resolutions.get(c.id)}
                resolving={false}
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
  const [expanded, setExpanded] = useState(false);

  return (
    <article className={`app-conflict-card ${c.status === "resolved" ? "app-conflict-card--resolved" : ""}`}>
      <div className="app-conflict-card-head">
        <div className="app-conflict-file">
          <code>{c.file}</code>
          <span className={`app-pill ${c.status === "resolved" ? "app-pill--on" : "app-pill--err"}`}>
            {c.status}
          </span>
        </div>
        <div className="app-conflict-actions">
          <button
            type="button"
            className="app-btn-ghost app-btn-small"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Collapse" : "Details"}
          </button>
          {c.status === "open" ? (
            <button
              type="button"
              className="app-btn app-btn-small app-btn--ai"
              disabled={resolving}
              onClick={onResolve}
            >
              {resolving ? (
                <><span className="app-spinner-sm" /> Resolving…</>
              ) : (
                "✨ Resolve with AI"
              )}
            </button>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="app-conflict-diff">
          <div className="app-conflict-side app-conflict-side--a">
            <span className="app-conflict-branch">{c.branchA}</span>
            <span className="app-conflict-author">@{c.authorA}</span>
            <code className="app-conflict-sha">{c.commitShaA}</code>
            <p>{c.messageA}</p>
          </div>
          <div className="app-conflict-vs">VS</div>
          <div className="app-conflict-side app-conflict-side--b">
            <span className="app-conflict-branch">{c.branchB}</span>
            <span className="app-conflict-author">@{c.authorB}</span>
            <code className="app-conflict-sha">{c.commitShaB}</code>
            <p>{c.messageB}</p>
          </div>
        </div>
      ) : null}

      {resolution ? (
        <div className="app-conflict-resolution">
          <div className="app-conflict-resolution-header">
            <span className="app-pill app-pill--on">AI Resolution</span>
            <span className="app-muted" style={{ fontSize: "0.7rem" }}>
              {resolution.model}
              {resolution.graphContextUsed ? " · graph context used" : ""}
            </span>
          </div>
          <pre className="app-cypher">{resolution.suggestion}</pre>
        </div>
      ) : null}
    </article>
  );
}
