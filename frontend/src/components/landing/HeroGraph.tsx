"use client";

import { useEffect, useRef } from "react";
import { alpha, readTokens } from "@/lib/tokens";
import { REDUCED_QUERY } from "./gsap";

/** Slow, low-opacity live graph behind the hero: nodes drift, and signals
    travel along edges — the shape of agents sharing one code graph. */
export function HeroGraph() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const T = readTokens();
    const reduced = window.matchMedia(REDUCED_QUERY).matches;
    const agentHues = [T["agent-a"], T["agent-b"], T["agent-c"]];
    let w = 0, h = 0, raf = 0, visible = true;

    // seeded PRNG so the composition is stable between loads
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    type P = { x: number; y: number; vx: number; vy: number; r: number; hue: string | null };
    let pts: P[] = [];
    let edges: [number, number][] = [];
    const pulses: { e: number; t: number; color: string }[] = [];

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed = 7;
      const n = Math.round(Math.min(64, (w * h) / 26000));
      pts = Array.from({ length: n }, (_, i) => ({
        x: rnd() * w,
        y: rnd() * h,
        vx: (rnd() - 0.5) * 0.12,
        vy: (rnd() - 0.5) * 0.12,
        r: 1.2 + rnd() * 2.2,
        hue: i % 9 === 0 ? agentHues[(i / 9) % 3] : null,
      }));
      edges = [];
      pts.forEach((p, i) => {
        const near = pts
          .map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 }))
          .filter((o) => o.j !== i)
          .sort((a, b) => a.d - b.d)
          .slice(0, 2);
        near.forEach((o) => i < o.j && edges.push([i, o.j]));
      });
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < -20 || p.x > w + 20) p.vx *= -1;
          if (p.y < -20 || p.y > h + 20) p.vy *= -1;
        }
      }
      ctx.lineWidth = 1;
      for (const [a, b] of edges) {
        const p = pts[a], q = pts[b];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        const o = Math.max(0, 1 - d / 260) * 0.35;
        if (o <= 0) continue;
        ctx.strokeStyle = alpha(T["fg-2"], o);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }
      // signals: each originates at an agent-coloured node
      if (!reduced && pulses.length < 6 && Math.random() < 0.02 && edges.length) {
        const e = Math.floor(Math.random() * edges.length);
        const src = pts[edges[e][0]].hue ?? pts[edges[e][1]].hue;
        pulses.push({ e, t: now, color: src ?? T.accent });
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pu = pulses[i];
        const k = (now - pu.t) / 1800;
        if (k >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const [a, b] = edges[pu.e];
        const p = pts[a], q = pts[b];
        const x = p.x + (q.x - p.x) * k, y = p.y + (q.y - p.y) * k;
        ctx.fillStyle = alpha(pu.color, Math.sin(k * Math.PI) * 0.9);
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const p of pts) {
        ctx.fillStyle = p.hue ? alpha(p.hue, 0.8) : alpha(T["fg-2"], 0.55);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced && visible) raf = requestAnimationFrame(draw);
    };

    build();
    raf = requestAnimationFrame(draw);

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      build();
      if (reduced) draw(performance.now());
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 size-full opacity-60" />;
}
