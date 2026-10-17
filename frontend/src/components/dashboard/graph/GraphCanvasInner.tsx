"use client";

import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { glyphD } from "@/lib/glyphs";
import { alpha, readTokens, type Tokens } from "@/lib/tokens";
import { AGENT_STYLE } from "@/lib/agents";
import type { Agent, EvidencePath, GraphEdge, GraphNode, ProposedChange, TestRun } from "@/lib/types";
import { Minimap } from "./Minimap";

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  agents: Agent[];
  changes: ProposedChange[];
  evidence: EvidencePath | null;
  tests: TestRun[];
  pulses: Record<string, number>;
  focus: { nodeIds: string[]; at: number } | null;
  selectedAgentId: string | null;
  selectedNodeId: string | null;
  follow: boolean;
  /** evidence path resolved by a verified fix */
  resolved: boolean;
  onSelectNode: (id: string | null) => void;
}

type N = NodeObject<GraphNode & { r: number }>;
type L = LinkObject<GraphNode & { r: number }, GraphEdge>;
type FG = ForceGraphMethods<N, L>;

const HOP_MS = 650;
const PULSE_MS = 2200;
const MAX_FOLLOW_ZOOM = 2.6;
const REDUCED = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pathCache = new Map<string, Path2D>();
function shape(kind: GraphNode["kind"], r: number) {
  const key = `${kind}:${r.toFixed(1)}`;
  let p = pathCache.get(key);
  if (!p) pathCache.set(key, (p = new Path2D(glyphD(kind, r))));
  return p;
}

const endId = (v: unknown) => (typeof v === "object" && v ? (v as N).id : (v as string));

export default function GraphCanvasInner(props: GraphCanvasProps) {
  const fg = useRef<FG | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const tokens = useRef<Tokens | null>(null);
  const monoFont = useRef("monospace");
  const userMovedAt = useRef(0);
  const evStart = useRef<{ id: string; t: number } | null>(null);
  const didFit = useRef(false);

  // Latest props for canvas callbacks (they are bound once); synced after each render.
  const live = useRef({ ...props, hover });

  useEffect(() => {
    tokens.current = readTokens();
    const f = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
    if (f) monoFont.current = f;
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Stable node / link objects so the simulation keeps positions across updates.
  const [nodeObjs] = useState(() => new Map<string, N>());
  const [linkObjs] = useState(() => new Map<string, L>());
  const data = useMemo(() => {
    const nodes = props.nodes.map((n) => {
      const prev = nodeObjs.get(n.id);
      const r = n.kind === "change" ? 6.5 : 3 + n.centrality * 5;
      if (prev) return Object.assign(prev, n, { r });
      // new nodes spawn next to their first neighbour, so they grow out of context
      const nb = props.edges.find((e) => e.source === n.id || e.target === n.id);
      const anchor = nb && nodeObjs.get(nb.source === n.id ? nb.target : nb.source);
      const obj: N = { ...n, r, x: anchor?.x, y: anchor?.y };
      nodeObjs.set(n.id, obj);
      return obj;
    });
    const links = props.edges.map((e) => {
      const prev = linkObjs.get(e.id);
      if (prev) return prev;
      const obj: L = { ...e };
      linkObjs.set(e.id, obj);
      return obj;
    });
    return { nodes, links };
  }, [props.nodes, props.edges, nodeObjs, linkObjs]);

  // Forces
  useEffect(() => {
    const g = fg.current;
    if (!g) return;
    g.d3Force("charge")?.strength(-180);
    g.d3Force("link")?.distance((l: L) => (l.kind === "TESTS" ? 34 : l.kind === "SIMILAR_TO" || l.kind === "INVOLVED" ? 60 : 44));
  }, [size.w]);

  // Evidence trace start
  useEffect(() => {
    if (props.evidence && evStart.current?.id !== props.evidence.id) {
      evStart.current = { id: props.evidence.id, t: performance.now() };
    }
    if (!props.evidence) evStart.current = null;
  }, [props.evidence]);

  // Camera follows scenario focus unless the user is driving.
  // Fits the focused nodes, but never zooms in past MAX_FOLLOW_ZOOM.
  useEffect(() => {
    const g = fg.current;
    if (!g || !props.focus || !props.follow || !size.w) return;
    if (performance.now() - userMovedAt.current < 5000) return;
    const pts = props.focus.nodeIds.map((id) => nodeObjs.get(id)).filter((n): n is N => !!n && n.x != null);
    if (!pts.length) return;
    const xs = pts.map((n) => n.x!), ys = pts.map((n) => n.y!);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 120;
    const k = Math.min(MAX_FOLLOW_ZOOM, size.w / (x1 - x0 + pad), size.h / (y1 - y0 + pad));
    const ms = REDUCED ? 0 : 700;
    g.centerAt((x0 + x1) / 2, (y0 + y1) / 2, ms);
    g.zoom(k, ms);
  }, [props.focus, props.follow, size.w, size.h, nodeObjs]);

  // Selection helpers
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of props.edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [props.edges]);

  const agentSubgraph = useMemo(() => {
    if (!props.selectedAgentId) return null;
    const set = new Set<string>();
    for (const c of props.changes.filter((c) => c.agentId === props.selectedAgentId)) {
      set.add(c.nodeId);
      for (const t of c.touches) {
        set.add(t);
        neighbours.get(t)?.forEach((n) => set.add(n));
      }
    }
    return set;
  }, [props.selectedAgentId, props.changes, neighbours]);
  const sub = useRef(agentSubgraph);

  const agentSlot = useMemo(() => Object.fromEntries(props.agents.map((a) => [a.id, a.slot])), [props.agents]);
  const changeByNode = useMemo(() => Object.fromEntries(props.changes.map((c) => [c.nodeId, c])), [props.changes]);
  const testByNode = useMemo(() => {
    const m: Record<string, TestRun> = {};
    for (const t of props.tests) m[t.testNodeId] = t; // later runs (reverify) win
    return m;
  }, [props.tests]);
  const derived = useRef({ agentSlot, changeByNode, testByNode });

  useLayoutEffect(() => {
    live.current = { ...props, hover };
    sub.current = agentSubgraph;
    derived.current = { agentSlot, changeByNode, testByNode };
  });

  function evidenceProgress(now: number) {
    const ev = live.current.evidence;
    if (!ev || !evStart.current) return { reached: new Set<string>(), progress: 0 };
    const p = REDUCED ? ev.hops.length : (now - evStart.current.t) / HOP_MS;
    const reached = new Set(ev.hops.slice(0, Math.min(ev.hops.length, Math.floor(p) + 1)).map((h) => h.nodeId));
    return { reached, progress: p };
  }

  const drawNode = (node: N, ctx: CanvasRenderingContext2D, scale: number) => {
    const T = tokens.current;
    if (!T || node.x == null || node.y == null) return;
    const now = performance.now();
    const { selectedNodeId, hover } = live.current;
    const { agentSlot, changeByNode, testByNode } = derived.current;
    const dimmed = sub.current && !sub.current.has(node.id as string);
    const { reached } = evidenceProgress(now);
    const onPath = reached.has(node.id as string);
    const r = node.r;

    let stroke = T["fg-3"];
    let fill = T["surface-3"];
    let fillAlpha = 1;
    const agentColor = node.agentId ? T[AGENT_STYLE[agentSlot[node.agentId] ?? "a"].token] : null;

    if (node.kind === "change" && agentColor) {
      const c = changeByNode[node.id as string];
      fill = agentColor;
      fillAlpha = 0.9;
      stroke = c?.status === "conflict" ? T.conflict : c?.status === "verified" || c?.status === "adapted" ? T.pass : agentColor;
    } else if (node.kind === "test") {
      const t = testByNode[node.id as string];
      stroke = t?.status === "pass" ? T.pass : t?.status === "fail" ? T.conflict : t?.status === "running" ? T.risk : T["fg-3"];
    } else if (node.kind === "incident") {
      stroke = T.risk;
    } else if (agentColor) {
      stroke = agentColor;
    } else {
      stroke = T["fg-2"];
    }
    if (onPath) stroke = live.current.resolved ? T.pass : T.conflict;
    if (selectedNodeId === node.id) stroke = T.accent;

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.14 : 1;
    ctx.translate(node.x, node.y);

    // Risk ring — change nodes: rank_change_risk; others: centrality
    const change = changeByNode[node.id as string];
    const ringA = change?.risk != null ? change.risk : node.kind !== "change" ? Math.max(0, node.centrality - 0.45) * 0.9 : 0;
    if (ringA > 0.02) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 3.2, 0, Math.PI * 2);
      ctx.strokeStyle = alpha(change?.risk != null ? T.risk : T["fg-2"], ringA * 0.75);
      ctx.lineWidth = change?.risk != null ? 1.6 : 0.8;
      ctx.stroke();
    }

    // Pulse (recall / conflict / test result)
    const p0 = live.current.pulses[node.id as string];
    if (p0 && !REDUCED && now - p0 < PULSE_MS) {
      const k = ((now - p0) % (PULSE_MS / 2)) / (PULSE_MS / 2);
      ctx.beginPath();
      ctx.arc(0, 0, r + 2 + k * 14, 0, Math.PI * 2);
      ctx.strokeStyle = alpha(node.kind === "incident" ? T.risk : stroke, (1 - k) * 0.8);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    const path = shape(node.kind, r);
    ctx.fillStyle = alpha(fill, fillAlpha);
    ctx.fill(path);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = onPath || selectedNodeId === node.id ? 1.8 : 1.1;
    ctx.stroke(path);

    if (onPath) {
      ctx.shadowColor = stroke;
      ctx.shadowBlur = 12;
      ctx.stroke(path);
      ctx.shadowBlur = 0;
    }

    // Labels: always for key nodes, otherwise when zoomed in
    const important = node.kind === "change" || node.kind === "incident" || onPath || hover === node.id || selectedNodeId === node.id || node.centrality > 0.6;
    if (important || scale > 1.9) {
      const fs = Math.max(2.6, 10.5 / scale);
      ctx.font = `${fs}px ${monoFont.current}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineWidth = 3 / scale;
      ctx.strokeStyle = alpha(T.bg, 0.85);
      ctx.lineJoin = "round";
      ctx.strokeText(node.label, 0, r + 4.5);
      ctx.fillStyle = onPath ? T.fg : hover === node.id || selectedNodeId === node.id ? T.fg : T["fg-2"];
      ctx.fillText(node.label, 0, r + 4.5);
    }
    ctx.restore();
  };

  const drawEvidence = (ctx: CanvasRenderingContext2D, scale: number) => {
    const T = tokens.current;
    const ev = live.current.evidence;
    if (!T || !ev) return;
    const { progress } = evidenceProgress(performance.now());
    const color = live.current.resolved ? T.pass : T.conflict;
    const pts = ev.hops.map((h) => nodeObjs.get(h.nodeId)).filter(Boolean) as N[];
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const segs = Math.min(pts.length - 1, progress);
    const drawTo = (glow: boolean) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x!, pts[0].y!);
      for (let i = 1; i < pts.length; i++) {
        const k = Math.min(1, segs - (i - 1));
        if (k <= 0) break;
        const a = pts[i - 1], b = pts[i];
        ctx.lineTo(a.x! + (b.x! - a.x!) * k, a.y! + (b.y! - a.y!) * k);
      }
      ctx.strokeStyle = glow ? alpha(color, 0.24) : color;
      ctx.lineWidth = (glow ? 7 : 1.8) / Math.sqrt(scale);
      ctx.stroke();
    };
    drawTo(true);
    drawTo(false);

    // travelling head while tracing
    if (segs < pts.length - 1) {
      const i = Math.floor(segs);
      const k = segs - i;
      const a = pts[i], b = pts[i + 1];
      const x = a.x! + (b.x! - a.x!) * k, y = a.y! + (b.y! - a.y!) * k;
      ctx.beginPath();
      ctx.arc(x, y, 2.6 / Math.sqrt(scale), 0, Math.PI * 2);
      ctx.fillStyle = T.fg;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fill();
    }
    ctx.restore();
  };

  const linkColor = (l: L) => {
    const T = tokens.current;
    if (!T) return "transparent";
    const s = endId(l.source), t = endId(l.target);
    const dim = sub.current && !(sub.current.has(s) && sub.current.has(t));
    if (l.kind === "SIMILAR_TO" || l.kind === "INVOLVED") return alpha(T.risk, dim ? 0.08 : 0.5);
    if (l.kind === "MODIFIES" || l.kind === "INTRODUCES") {
      const n = nodeObjs.get(s);
      const slot = n?.agentId ? derived.current.agentSlot[n.agentId] : undefined;
      return alpha(slot ? T[AGENT_STYLE[slot].token] : T["fg-2"], dim ? 0.08 : 0.55);
    }
    return dim ? alpha(T["fg-3"], 0.12) : alpha(T["fg-2"], 0.32);
  };

  const zoomBy = (f: number) => {
    const g = fg.current;
    if (!g) return;
    userMovedAt.current = performance.now();
    g.zoom(g.zoom() * f, 300);
  };

  return (
    <div ref={box} className="absolute inset-0" onWheel={() => (userMovedAt.current = performance.now())} onPointerDown={() => (userMovedAt.current = performance.now())}>
      {size.w > 0 && (
        <ForceGraph2D<GraphNode & { r: number }, GraphEdge>
          ref={fg}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          autoPauseRedraw={false}
          nodeId="id"
          nodeRelSize={1}
          nodeVal={(n) => n.r * n.r}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, n.r + 3, 0, Math.PI * 2);
            ctx.fill();
          }}
          nodeLabel={() => ""}
          linkColor={linkColor}
          linkWidth={(l) => (l.kind === "MODIFIES" || l.kind === "INTRODUCES" ? 1.2 : 0.8)}
          linkLineDash={(l) => (l.kind === "SIMILAR_TO" || l.kind === "INVOLVED" ? [3, 3] : null)}
          linkDirectionalArrowLength={0}
          onRenderFramePost={drawEvidence}
          cooldownTicks={140}
          d3VelocityDecay={0.32}
          onEngineStop={() => {
            if (!didFit.current) {
              didFit.current = true;
              fg.current?.zoomToFit(REDUCED ? 0 : 600, 48);
            }
          }}
          onNodeHover={(n) => setHover((n?.id as string) ?? null)}
          onNodeClick={(n) => {
            userMovedAt.current = performance.now();
            props.onSelectNode(n.id as string);
            fg.current?.centerAt(n.x, n.y, REDUCED ? 0 : 600);
            fg.current?.zoom(Math.max(2.4, fg.current.zoom()), REDUCED ? 0 : 600);
          }}
          onBackgroundClick={() => props.onSelectNode(null)}
          enableNodeDrag
        />
      )}

      <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface-1/90">
        <IconBtn label="Zoom in" onClick={() => zoomBy(1.4)}><Plus size={14} strokeWidth={1.5} /></IconBtn>
        <IconBtn label="Zoom out" onClick={() => zoomBy(1 / 1.4)}><Minus size={14} strokeWidth={1.5} /></IconBtn>
        <IconBtn label="Fit graph" onClick={() => { userMovedAt.current = 0; fg.current?.zoomToFit(500, 48); }}><Maximize2 size={13} strokeWidth={1.5} /></IconBtn>
      </div>

      <Minimap fg={fg} nodes={nodeObjs} width={size.w} height={size.h} tokens={tokens} evidence={props.evidence} />
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 place-items-center text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line"
    >
      {children}
    </button>
  );
}
