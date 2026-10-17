"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Glyph } from "@/components/ui/glyph";
import { AGENT_STYLE } from "@/lib/agents";
import { cn } from "@/lib/cn";
import type { AgentSlot, NodeKind } from "@/lib/types";
import { EASE_OUT, Flip, MOTION_QUERY, REDUCED_QUERY, gsap, useGSAP } from "./gsap";
import { useArmed } from "./useArmed";

const VW = 1000;
const VH = 560;

type SNode = { id: string; kind: NodeKind; label: string; x: number; y: number; slot?: AgentSlot };

const NODES: SNode[] = [
  { id: "pc:a", kind: "change", label: "PC-A1", x: 110, y: 120, slot: "a" },
  { id: "pc:b", kind: "change", label: "PC-B1", x: 890, y: 450, slot: "b" },
  { id: "pc:c", kind: "change", label: "PC-C1", x: 130, y: 440, slot: "c" },
  { id: "f:email", kind: "field", label: "User.email", x: 290, y: 110 },
  { id: "sc:user", kind: "schema", label: "UserSchema", x: 470, y: 190 },
  { id: "ep:user", kind: "endpoint", label: "GET /api/users/:id", x: 660, y: 110 },
  { id: "fn:fetch", kind: "function", label: "fetchUser()", x: 760, y: 280 },
  { id: "fn:receipt", kind: "function", label: "sendReceipt()", x: 700, y: 450 },
  { id: "fn:notify", kind: "function", label: "notifyUser()", x: 360, y: 400 },
  { id: "fn:serialize", kind: "function", label: "serializeUser()", x: 330, y: 270 },
  { id: "t:contract", kind: "test", label: "receipts.contract.test", x: 530, y: 500 },
];

const EDGES: [string, string][] = [
  ["pc:a", "f:email"],
  ["f:email", "sc:user"],
  ["sc:user", "ep:user"],
  ["ep:user", "fn:fetch"],
  ["fn:fetch", "fn:receipt"],
  ["fn:receipt", "pc:b"],
  ["pc:a", "fn:serialize"],
  ["fn:serialize", "f:email"],
  ["pc:c", "fn:notify"],
  ["fn:notify", "fn:fetch"],
  ["t:contract", "fn:receipt"],
];

const PATH = ["pc:a", "f:email", "sc:user", "ep:user", "fn:fetch", "fn:receipt", "pc:b"];

/* Pull-request rows, stacked in the middle of the stage before they morph. */
const ROW = { x: 270, w: 460, h: 66, top: 166, gap: 10 };
const CARDS: { slot: AgentSlot; name: string; branch: string; node: string }[] = [
  { slot: "a", name: "Agent A", branch: "agent-a/rename-user-email", node: "pc:a" },
  { slot: "b", name: "Agent B", branch: "agent-b/receipt-emails", node: "pc:b" },
  { slot: "c", name: "Agent C", branch: "agent-c/notify-prefs", node: "pc:c" },
];

const CAPTIONS = [
  { title: "Same three branches.", body: "Each becomes a node in FalkorDB." },
  { title: "Wired into the code graph.", body: "Endpoints, schemas, functions, tests." },
  { title: "One path explains it.", body: "PC-A1 renames what PC-B1 still reads." },
  { title: "Agent C never collided.", body: "It checked first, and adapted." },
];

const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
const edgeKey = (a: string, b: string) => `${a}>${b}`;

export function HowItSees() {
  const root = useRef<HTMLElement>(null);
  const [rev, setRev] = useState(0);

  // Flip.fit measures real layout, so rebuild the timeline after resizes.
  useEffect(() => {
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setRev((r) => r + 1), 250);
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const armed = useArmed();

  useGSAP(
    () => {
      if (!armed) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERY, () => {
        const tl = gsap.timeline({
          defaults: { ease: EASE_OUT, duration: 0.6 },
          scrollTrigger: { trigger: "[data-hpin]", start: "top top", end: "+=360%", pin: true, scrub: 0.6 },
        });
        const caption = (i: number, at: string) =>
          tl.to("[data-hcap]", { opacity: 0, y: -8, duration: 0.3 }, at).fromTo(`[data-hcap="${i}"]`, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 }, `${at}+=0.15`);

        tl.set(`[data-hcap="0"]`, { opacity: 1, y: 0 });
        tl.to({}, { duration: 0.3 });

        // 1. cards morph into change nodes (Flip)
        tl.addLabel("morph");
        tl.to("[data-card-body]", { opacity: 0, duration: 0.25 }, "morph");
        CARDS.forEach((c, i) => {
          const card = root.current!.querySelector<HTMLElement>(`[data-hcard="${c.slot}"]`)!;
          const slot = root.current!.querySelector<HTMLElement>(`[data-slot="${c.node}"]`)!;
          tl.add(Flip.fit(card, slot, { scale: true, duration: 0.9, ease: "expo.inOut" }) as gsap.core.Tween, `morph+=${i * 0.06}`);
        });
        tl.to(`[data-node-face][data-kind="change"]`, { opacity: 1, duration: 0.2 }, "morph+=0.85");
        tl.to("[data-hcard]", { opacity: 0, duration: 0.15 }, "morph+=0.9");

        // 2. the rest of the graph appears, edges draw
        caption(1, "morph+=0.9");
        tl.fromTo(`[data-node-face]:not([data-kind="change"])`, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, stagger: 0.05, duration: 0.5 }, "morph+=1.0");
        tl.fromTo("[data-edge]", { scaleX: 0 }, { scaleX: 1, transformOrigin: "0% 50%", stagger: 0.04, duration: 0.5 }, "morph+=1.2");
        tl.to({}, { duration: 0.4 });

        // 3. evidence path traced hop by hop
        tl.addLabel("trace");
        caption(2, "trace");
        PATH.slice(1).forEach((id, i) => {
          tl.fromTo(`[data-trace="${i}"]`, { scaleX: 0 }, { scaleX: 1, transformOrigin: "0% 50%", duration: 0.35, ease: "none" }, `trace+=${0.2 + i * 0.35}`);
          tl.to(`[data-hot="${id}"]`, { opacity: 1, duration: 0.15 }, `trace+=${0.2 + (i + 1) * 0.35}`);
        });
        tl.to(`[data-hot="pc:a"]`, { opacity: 1, duration: 0.15 }, "trace+=0.1");
        tl.to("[data-dimmable]", { opacity: 0.35, duration: 0.4 }, "trace+=0.2");
        tl.to({}, { duration: 0.5 });

        // 4. prevention: C adapted
        tl.addLabel("prevent");
        caption(3, "prevent");
        tl.to(`[data-safe="pc:c"]`, { opacity: 1, duration: 0.4 }, "prevent+=0.2");
        tl.fromTo("[data-adapted]", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4 }, "prevent+=0.3");
        tl.to({}, { duration: 0.5 });
      });
      mm.add(REDUCED_QUERY, () => {
        gsap.set("[data-hcard]", { opacity: 0 });
        gsap.set("[data-node-face], [data-hot], [data-safe], [data-adapted], [data-hcap]", { opacity: 1, y: 0 });
        gsap.set("[data-edge], [data-trace]", { scaleX: 1 });
        gsap.from("[data-hstage]", { opacity: 0, duration: 0.6, scrollTrigger: { trigger: "[data-hstage]", start: "top 80%" } });
      });
    },
    { scope: root, dependencies: [rev, armed], revertOnUpdate: true },
  );

  return (
    <section id="how" ref={root} className="relative">
      <div data-hpin className="relative flex min-h-[100svh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 px-6 md:px-10 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            <p className="eyebrow">How SYNK sees it</p>
            <div className="relative mt-5 min-h-[170px] motion-reduce:min-h-0 motion-reduce:space-y-5">
              {CAPTIONS.map((c, i) => (
                <div key={i} data-hcap={i} className="absolute inset-x-0 top-0 opacity-0 motion-reduce:relative">
                  <p className="font-mono text-[12px] tabular text-fg-3">0{i + 1} / 04</p>
                  <h2 className="mt-3 text-[clamp(26px,2.6vw,38px)] font-semibold leading-[1.08] tracking-[-0.035em]">{c.title}</h2>
                  <p className="mt-3 text-[17px] leading-[1.6] text-fg-2">{c.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div data-hstage className="surface grain relative overflow-hidden" style={{ aspectRatio: `${VW} / ${VH}` }}>
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle,var(--line)_1px,transparent_1px)] [background-size:24px_24px]" />

            {/* edges */}
            <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
              {EDGES.map(([a, b]) => {
                const p = byId[a], q = byId[b];
                const len = Math.round(Math.hypot(q.x - p.x, q.y - p.y) * 1000) / 1000;
                const ang = Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180000) / Math.PI) / 1000;
                const onPath = PATH.some((id, i) => i > 0 && ((PATH[i - 1] === a && id === b) || (PATH[i - 1] === b && id === a)));
                return (
                  <g key={edgeKey(a, b)} transform={`translate(${p.x} ${p.y}) rotate(${ang})`} data-dimmable={onPath ? undefined : ""}>
                    <line data-edge x1={0} y1={0} x2={len} y2={0} stroke="var(--fg-3)" strokeOpacity={0.55} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
              {PATH.slice(1).map((id, i) => {
                const p = byId[PATH[i]], q = byId[id];
                const len = Math.round(Math.hypot(q.x - p.x, q.y - p.y) * 1000) / 1000;
                const ang = Math.round((Math.atan2(q.y - p.y, q.x - p.x) * 180000) / Math.PI) / 1000;
                return (
                  <g key={id} transform={`translate(${p.x} ${p.y}) rotate(${ang})`}>
                    <line data-trace={i} x1={0} y1={0} x2={len} y2={0} stroke="var(--conflict)" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  </g>
                );
              })}
            </svg>

            {/* nodes: static positioned wrappers, animated faces */}
            {NODES.map((n) => {
              const color = n.slot ? AGENT_STYLE[n.slot].text : "text-fg-2";
              return (
                <div
                  key={n.id}
                  data-slot={n.id}
                  className={cn("absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center", n.kind === "change" ? "h-[34px] w-[92px]" : "size-8")}
                  style={{ left: `${(n.x / VW) * 100}%`, top: `${(n.y / VH) * 100}%` }}
                >
                  <div data-node-face data-kind={n.kind} data-dimmable={PATH.includes(n.id) || n.id === "pc:c" ? undefined : ""} className="relative flex size-full items-center justify-center opacity-0">
                    {n.kind === "change" ? (
                      <span
                        className={cn("relative flex size-full items-center justify-center rounded-full border font-mono text-[12.5px] font-medium", AGENT_STYLE[n.slot!].border, color)}
                        style={{ background: `color-mix(in srgb, var(--${AGENT_STYLE[n.slot!].token}) 14%, var(--surface-2))` }}
                      >
                        {n.label}
                        <span data-hot={n.id} className="absolute -inset-[3px] rounded-full border border-conflict opacity-0 shadow-[0_0_16px_-2px_var(--conflict)]" />
                        <span data-safe={n.id} className="absolute -inset-[3px] rounded-full border border-pass opacity-0" />
                      </span>
                    ) : (
                      <span className="relative grid size-8 place-items-center rounded-full border border-line-strong bg-surface-2">
                        <Glyph kind={n.kind} size={16} className="text-fg" />
                        <span data-hot={n.id} className="absolute -inset-px grid place-items-center rounded-full border border-conflict bg-surface-2 text-conflict opacity-0 shadow-[0_0_14px_-2px_var(--conflict)]">
                          <Glyph kind={n.kind} size={16} />
                        </span>
                      </span>
                    )}
                    <span className={cn("pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[4px] bg-surface-1/90 px-1.5 font-mono text-[12px] text-fg-2", n.kind === "change" && "hidden")}>
                      {n.label}
                    </span>
                    {n.id === "pc:c" && (
                      <span data-adapted className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-pass/30 bg-pass/10 px-2.5 py-0.5 font-mono text-[11.5px] text-pass opacity-0">
                        adapted before write
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* the three pull requests that morph into change nodes */}
            {CARDS.map((c, i) => {
              const a = AGENT_STYLE[c.slot];
              return (
                <div
                  key={c.slot}
                  data-hcard={c.slot}
                  className="surface-2 absolute overflow-hidden"
                  style={{
                    left: `${(ROW.x / VW) * 100}%`,
                    top: `${((ROW.top + i * (ROW.h + ROW.gap)) / VH) * 100}%`,
                    width: `${(ROW.w / VW) * 100}%`,
                    height: `${(ROW.h / VH) * 100}%`,
                  }}
                >
                  <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[2px]", a.dot)} />
                  <div data-card-body className="flex h-full items-center gap-3 pl-5 pr-4">
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-[12px] font-medium", a.text)}>{c.name}</p>
                      <p className="mt-0.5 truncate font-mono text-[13px] text-fg">{c.branch}</p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-pass">
                      <span className="grid size-[18px] place-items-center rounded-full border border-pass/40 bg-pass/10">
                        <Check size={11} strokeWidth={2.5} />
                      </span>
                      Passed
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
