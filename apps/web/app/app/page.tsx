"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { trpc } from "~/lib/trpc";

type GNode = { id: string; label: string; title: string; properties: Record<string, unknown> };
type GEdge = { source: string; target: string; type: string };
type Stats = { nodeCount: number; relCount: number; labels: { label: string; count: number }[] };

const COLORS: Record<string, string> = {
  Repository: "#a78bfa",
  File: "#60a5fa",
  Function: "#34d399",
  Test: "#fbbf24",
  Commit: "#f472b6",
  Issue: "#fb923c",
  Discussion: "#22d3ee",
  Decision: "#c084fc",
  Conflict: "#f87171",
};

const W = 900;
const H = 520;

/** Group-by-label ring layout: each label gets an angular sector. */
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [graph, setGraph] = useState<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<GNode | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [question, setQuestion] = useState("What is the context around verifyToken?");
  const [answer, setAnswer] = useState("");
  const [cypher, setCypher] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);

  const [rawCypher, setRawCypher] = useState("MATCH (c:Commit)-[:REFERENCES]->(i:Issue) RETURN c.sha, i.key");
  const [rawOut, setRawOut] = useState("");

  const refresh = useCallback(async () => {
    try {
      setError("");
      const [s, g] = await Promise.all([trpc.graph.stats.query(), trpc.graph.subgraph.query({ limit: 200 })]);
      setStats(s as Stats);
      setGraph(g as { nodes: GNode[]; edges: GEdge[] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach FalkorDB — run `npm run db:up`");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const positions = useMemo(() => layout(graph.nodes), [graph.nodes]);

  async function seed() {
    setBusy(true);
    try {
      await trpc.graph.seedDemo.mutate();
      setSelected(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAnswer("");
    setCypher([]);
    try {
      const result = await trpc.graph.ask.mutate({ question: question.trim() });
      setAnswer(result.answer);
      setCypher(result.cypher);
    } catch (err) {
      setAnswer(err instanceof Error ? err.message : "Request failed");
    } finally {
      setAsking(false);
    }
  }

  async function runRaw() {
    try {
      const res = await trpc.graph.query.mutate({ cypher: rawCypher });
      setRawOut(`// ${res.cypher}\n${JSON.stringify(res.rows, null, 2)}`);
    } catch (err) {
      setRawOut(err instanceof Error ? err.message : "Query failed");
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

  return (
    <section className="app-section app-section--flat">
      <div className="app-graph-toolbar">
        <div className="app-graph-stats">
          <span className="app-pill app-pill--on">FalkorDB</span>
          <span>{stats ? `${stats.nodeCount} nodes · ${stats.relCount} relationships` : "…"}</span>
        </div>
        <button type="button" className="app-btn app-btn-small" disabled={busy} onClick={() => void seed()}>
          {busy ? "Loading…" : "Load demo graph"}
        </button>
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
              Graph is empty — click “Load demo graph”
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

      <form onSubmit={(e) => void onAsk(e)} className="app-ask-form">
        <input
          className="app-input"
          placeholder="Ask about a function, e.g. verifyToken…"
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
          <pre className="app-cypher">{answer}</pre>
          {cypher.length > 0 ? (
            <>
              <strong>Cypher executed on FalkorDB</strong>
              <pre className="app-cypher">{cypher.join("\n\n")}</pre>
            </>
          ) : null}
        </div>
      ) : null}

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
