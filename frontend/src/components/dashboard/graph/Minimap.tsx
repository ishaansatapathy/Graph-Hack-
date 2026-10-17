"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";
import { alpha, type Tokens } from "@/lib/tokens";
import type { EvidencePath, GraphEdge, GraphNode } from "@/lib/types";

type N = NodeObject<GraphNode & { r: number }>;
type FG = ForceGraphMethods<N, LinkObject<GraphNode & { r: number }, GraphEdge>>;

const W = 152;
const H = 96;

/** Overview of the whole graph with the current viewport. Click to recentre. */
export function Minimap({
  fg,
  nodes,
  width,
  height,
  tokens,
  evidence,
}: {
  fg: React.RefObject<FG | undefined>;
  nodes: Map<string, N>;
  width: number;
  height: number;
  tokens: React.RefObject<Tokens | null>;
  evidence: EvidencePath | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ minX: 0, minY: 0, s: 1, ox: 0, oy: 0 });
  const ev = useRef(evidence);
  useLayoutEffect(() => {
    ev.current = evidence;
  });

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const draw = () => {
      const T = tokens.current;
      const g = fg.current;
      const list = [...nodes.values()].filter((n) => n.x != null);
      ctx.clearRect(0, 0, W, H);
      if (!T || !g || !list.length) return;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of list) {
        minX = Math.min(minX, n.x!); maxX = Math.max(maxX, n.x!);
        minY = Math.min(minY, n.y!); maxY = Math.max(maxY, n.y!);
      }
      const pad = 30;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const s = Math.min(W / (maxX - minX), H / (maxY - minY));
      const ox = (W - (maxX - minX) * s) / 2;
      const oy = (H - (maxY - minY) * s) / 2;
      view.current = { minX, minY, s, ox, oy };
      const tx = (x: number) => ox + (x - minX) * s;
      const ty = (y: number) => oy + (y - minY) * s;

      const onPath = new Set(ev.current?.hops.map((h) => h.nodeId));
      for (const n of list) {
        ctx.fillStyle = onPath.has(n.id as string) ? T.conflict : alpha(T["fg-2"], 0.55);
        ctx.fillRect(tx(n.x!) - 1, ty(n.y!) - 1, 2, 2);
      }

      const a = g.screen2GraphCoords(0, 0);
      const b = g.screen2GraphCoords(width, height);
      ctx.strokeStyle = alpha(T.accent, 0.7);
      ctx.lineWidth = 1;
      ctx.strokeRect(tx(a.x) + 0.5, ty(a.y) + 0.5, (b.x - a.x) * s, (b.y - a.y) * s);
    };

    const id = window.setInterval(draw, 120);
    draw();
    return () => window.clearInterval(id);
  }, [fg, nodes, tokens, width, height]);

  return (
    <canvas
      ref={canvas}
      aria-label="Graph minimap — click to recentre"
      role="img"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const { minX, minY, s, ox, oy } = view.current;
        const x = (e.clientX - r.left - ox) / s + minX;
        const y = (e.clientY - r.top - oy) / s + minY;
        fg.current?.centerAt(x, y, 400);
      }}
      style={{ width: W, height: H }}
      className="absolute bottom-3 right-3 cursor-crosshair rounded-[var(--radius-control)] border border-line bg-surface-1/90"
    />
  );
}
