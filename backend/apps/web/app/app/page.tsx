"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useFingerprint } from "~/lib/fingerprint";
import { trpc } from "~/lib/trpc";

type GNode = { id: string; label: string; title: string; properties: Record<string, unknown> };
type GEdge = { source: string; target: string; type: string };
type Stats = { nodeCount: number; relCount: number; labels: { label: string; count: number }[] };
type MemoryMsg = { id: string; role: string; content: string; createdAt: string };

const COLORS: Record<string, string> = {
  Repository:   "#a78bfa",
  File:         "#60a5fa",
  Function:     "#34d399",
  Test:         "#fbbf24",
  Commit:       "#f472b6",
  Issue:        "#fb923c",
  Discussion:   "#22d3ee",
  Decision:     "#c084fc",
  Conflict:     "#f87171",
  SlackMessage: "#4ade80",
  SlackChannel: "#2dd4bf",
  Person:       "#e879f9",
  Label:        "#facc15",
};

const W = 900;
const H = 520;

function layout(nodes: GNode[]) {
  const groups = [...new Set(nodes.map((n) => n.label))];
  const pos = new Map<string, { x: number; y: number }>();
  groups.forEach((g, gi) => {
    const members = nodes.filter((n) => n.label === g);
    const baseAngle = (gi / groups.length) * Math.PI * 2;
    const cx = W / 2 + Math.cos(baseAngle) * 270;
    const cy = H / 2 + Math.sin(baseAngle) * 170;
    members.forEach((n, i) => {
      const a = (i / Math.max(members.length, 1)) * Math.PI * 2;
      const r = members.length === 1 ? 0 : 38 + members.length * 6;
      pos.set(n.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    });
  });
  return pos;
}

export default function GraphAgentPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [graph, setGraph] = useState<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<GNode | null>(null);
  const [error, setError] = useState("");

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [answerMeta, setAnswerMeta] = useState<{ model: string; complexity: string; chunkCount: number } | null>(null);
  const [cypher, setCypher] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const fp = useFingerprint();

  const [rawCypher, setRawCypher] = useState("MATCH (c:Commit)-[:REFERENCES]->(i:Issue) RETURN c.sha, i.key");
  const [rawOut, setRawOut] = useState("");

  const [memory, setMemory] = useState<MemoryMsg[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);

  // Resolve workspace on mount
  useEffect(() => {
    void trpc.workspace.current.query({}).then((ws) => setWorkspaceId(ws.id)).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setError("");
      const [s, g] = await Promise.all([
        trpc.graph.stats.query({ workspaceId }),
        trpc.graph.subgraph.query({ workspaceId, limit: 200 }),
      ]);
      setStats(s as Stats);
      setGraph(g as { nodes: GNode[]; edges: GEdge[] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach FalkorDB — run `npm run db:up`");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMemory = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const msgs = await trpc.graph.memory.list.query({ workspaceId });
      setMemory((msgs ?? []) as MemoryMsg[]);
    } catch { /* ignore */ }
  }, [workspaceId]);

  const positions = useMemo(() => layout(graph.nodes), [graph.nodes]);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !workspaceId) return;
    setAsking(true);
    setAnswer("");
    setAnswerMeta(null);
    setCypher([]);
    setEvidenceCount(0);
    try {
      const result = await trpc.graph.ask.mutate({
        workspaceId,
        question: question.trim(),
        fp: fp ?? undefined,
      });
      setAnswer(result?.answer ?? "");
      setCypher(result?.cypher ?? []);
      setEvidenceCount(result?.evidenceCount ?? 0);
      setAnswerMeta({
        model: result?.model ?? "",
        complexity: result?.complexity ?? "",
        chunkCount: result?.chunkCount ?? 0,
      });
      void loadMemory();
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "Request failed");
    } finally {
      setAsking(false);
    }
  }

  async function runRaw() {
    if (!workspaceId) return;
    try {
      const res = await trpc.graph.query.mutate({ workspaceId, cypher: rawCypher });
      setRawOut(`// ${res?.cypher ?? rawCypher}\n${JSON.stringify(res?.rows, null, 2)}`);
    } catch (err) {
      setRawOut(err instanceof Error ? err.message : "Query failed");
    }
  }

  async function clearMemory() {
    if (!workspaceId) return;
    setClearingMemory(true);
    try {
      await trpc.graph.memory.clear.mutate({ workspaceId });
      setMemory([]);
      setAnswer("");
      setCypher([]);
    } catch { /* ignore */ } finally {
      setClearingMemory(false);
    }
  }

  const highlighted = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>([selected.id]);
    for (const e of graph.edges) {
      if (e.source === selected.id) ids.add(e.target);
      if (e.target === selected.id) ids.add(e.source);
    }
    return ids;
  }, [selected, graph.edges]);

  if (!workspaceId) {
    return <p className="app-muted">Loading workspace…</p>;
  }

  return (
    <section className="app-section app-section--flat">
      <div className="app-graph-toolbar">
        <div className="app-graph-stats">
          <span className="app-pill app-pill--on">FalkorDB</span>
          <span>{stats ? `${stats.nodeCount} nodes · ${stats.relCount} relationships` : "…"}</span>
          {stats && stats.labels.length > 0 ? (
            <span className="app-muted" style={{ fontSize: "0.75rem" }}>
              {stats.labels.slice(0, 4).map((l) => `${l.label}(${l.count})`).join(" · ")}
            </span>
          ) : null}
        </div>
        <button type="button" className="app-btn-ghost app-btn-small" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>
      {error ? <p className="app-flash app-flash--err">{error}</p> : null}

      <div className="app-graph-canvas-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="app-graph-canvas" role="img" aria-label="FalkorDB graph">
          {graph.edges.map((e, i) => {
            const a = positions.get(e.source);
            const b = positions.get(e.target);
            if (!a || !b) return null;
            const active = !selected || (highlighted.has(e.source) && highlighted.has(e.target));
            return (
              <g key={i} opacity={active ? 0.9 : 0.12}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#475569" strokeWidth={1.2} />
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={8} fill="#64748b" textAnchor="middle">
                  {e.type}
                </text>
              </g>
            );
          })}
          {graph.nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const active = !selected || highlighted.has(n.id);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                opacity={active ? 1 : 0.18}
                className="app-graph-node"
                onClick={() => setSelected(selected?.id === n.id ? null : n)}
              >
                <circle r={selected?.id === n.id ? 15 : 11} fill={COLORS[n.label] ?? "#94a3b8"} />
                <text y={26} fontSize={10} fill="#e5e7eb" textAnchor="middle">
                  {n.title.length > 22 ? `${n.title.slice(0, 21)}…` : n.title}
                </text>
              </g>
            );
          })}
          {graph.nodes.length === 0 ? (
            <text x={W / 2} y={H / 2} textAnchor="middle" fill="#6b7280" fontSize={14}>
              Graph is empty. Connect an integration and sync workspace data.
            </text>
          ) : null}
        </svg>
        <div className="app-graph-side">
          <div className="app-graph-legend">
            {Object.entries(COLORS).map(([label, color]) => (
              <span key={label}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
          {selected ? (
            <div className="app-graph-detail">
              <strong>{selected.label}</strong>
              <pre>{JSON.stringify(selected.properties, null, 2)}</pre>
            </div>
          ) : (
            <p className="app-muted">Click a node to inspect it and highlight its neighbours.</p>
          )}
        </div>
      </div>

      {/* ── GraphRAG ask ──────────────────────────────────────────────── */}
      <form onSubmit={(e) => void onAsk(e)} className="app-ask-form">
        <input
          className="app-input"
          placeholder="Ask about this workspace code, commits, issues or discussions"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="app-btn" disabled={asking}>
          {asking ? "Thinking…" : "Ask graph"}
        </button>
      </form>

      {answer ? (
        <div className="app-answer">
          <strong>GraphRAG context</strong>
          {evidenceCount > 0 ? (
            <span className="app-pill app-pill--on" style={{ marginLeft: "0.5rem", fontSize: "0.7rem" }}>
              {evidenceCount} evidence nodes
            </span>
          ) : null}
          {answerMeta ? (
            <span className="app-muted" style={{ fontSize: "0.7rem", marginLeft: "0.5rem" }}>
              {answerMeta.model} · {answerMeta.complexity}
              {answerMeta.chunkCount > 0 ? ` · ${answerMeta.chunkCount} chunks` : ""}
            </span>
          ) : null}
          <pre className="app-cypher">{answer}</pre>
          {cypher.length > 0 ? (
            <>
              <strong>Cypher executed on FalkorDB</strong>
              <pre className="app-cypher">{cypher.join("\n\n")}</pre>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ── Agent memory ──────────────────────────────────────────────── */}
      <div className="app-memory-bar">
        <button
          type="button"
          className="app-btn-ghost app-btn-small"
          onClick={() => { setShowMemory((v) => !v); if (!showMemory) void loadMemory(); }}
        >
          {showMemory ? "Hide memory" : `Agent memory (${memory.length} msgs)`}
        </button>
        {memory.length > 0 ? (
          <button
            type="button"
            className="app-btn-ghost app-btn-small"
            disabled={clearingMemory}
            onClick={() => void clearMemory()}
          >
            {clearingMemory ? "Clearing…" : "Clear memory"}
          </button>
        ) : null}
      </div>

      {showMemory && memory.length > 0 ? (
        <div className="app-memory-thread">
          {memory.map((m) => (
            <div key={m.id} className={`app-memory-msg app-memory-msg--${m.role}`}>
              <span className="app-memory-role">{m.role}</span>
              <pre className="app-memory-content">{m.content.slice(0, 300)}{m.content.length > 300 ? "…" : ""}</pre>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Cypher console ───────────────────────────────────────────── */}
      <h3 className="app-section-title">Cypher console (read-only)</h3>
      <div className="app-ask-form">
        <input className="app-input" value={rawCypher} onChange={(e) => setRawCypher(e.target.value)} />
        <button type="button" className="app-btn" onClick={() => void runRaw()}>
          Run
        </button>
      </div>
      {rawOut ? <pre className="app-cypher">{rawOut}</pre> : null}
    </section>
  );
}
