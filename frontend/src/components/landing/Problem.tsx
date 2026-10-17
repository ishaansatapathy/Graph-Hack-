"use client";

import { useRef } from "react";
import { Check, GitMerge } from "lucide-react";
import { AGENT_STYLE } from "@/lib/agents";
import { cn } from "@/lib/cn";
import type { AgentSlot } from "@/lib/types";
import { EASE_OUT, MOTION_QUERY, REDUCED_QUERY, gsap, useGSAP } from "./gsap";
import { useArmed } from "./useArmed";

const BRANCHES: { slot: AgentSlot; name: string; branch: string; change: string }[] = [
  { slot: "a", name: "Agent A", branch: "agent-a/rename-user-email", change: "Renames User.email → primaryEmail" },
  { slot: "b", name: "Agent B", branch: "agent-b/receipt-emails", change: "Sends receipts to user.email" },
  { slot: "c", name: "Agent C", branch: "agent-c/notify-prefs", change: "Routes notifications by channel" },
];

/* Git graph geometry (px): rows are ROW_H tall, main row MAIN_H. */
const ROW_H = 76;
const MAIN_H = 60;
const LANE_X = [30, 38, 46];
const TRUNK_X = 14;
const GRAPH_H = ROW_H * 3 + MAIN_H;
const MAIN_Y = ROW_H * 3 + MAIN_H / 2;

const CAPTIONS = [
  { k: "01", title: "Three agents. Three branches.", body: "Each opens its own pull request." },
  { k: "02", title: "Agent A goes green.", body: "Renames a field. Its tests pass." },
  { k: "03", title: "Agent B goes green.", body: "Reads that field. Mocked tests pass." },
  { k: "04", title: "Agent C goes green.", body: "Unrelated change. Passing." },
  { k: "05", title: "Git merges cleanly.", body: "No textual conflicts. CI is green." },
  { k: "06", title: "Production breaks.", body: "Nothing in the pipeline could see it." },
];

const CLIP_L = "polygon(0 0, 53% 0, 48% 28%, 55% 47%, 46% 69%, 52% 100%, 0 100%)";
const CLIP_R = "polygon(53% 0, 100% 0, 100% 100%, 52% 100%, 46% 69%, 55% 47%, 48% 28%)";

function ProdPanel() {
  return (
    <div className="surface-2 absolute inset-0 px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[12px] text-fg-2">checkout-service · production</span>
        <span className="relative flex items-center gap-1.5 text-[12px]">
          <span data-ok className="flex items-center gap-1.5 text-pass"><span className="size-1.5 rounded-full bg-pass" />healthy</span>
          <span data-bad className="absolute right-0 flex items-center gap-1.5 whitespace-nowrap text-conflict opacity-0"><span className="size-1.5 rounded-full bg-conflict" />failing</span>
        </span>
      </div>
      <div className="relative mt-3 font-mono text-[12.5px] leading-[21px]">
        <div data-ok>
          <p className="text-fg-2">POST /api/checkout <span className="text-pass">200</span></p>
          <p className="text-fg-2">GET  /api/users/:id <span className="text-pass">200</span></p>
          <p className="text-fg-2">POST /api/checkout <span className="text-pass">200</span></p>
        </div>
        <div data-bad className="absolute inset-0 opacity-0">
          <p className="text-fg-2">POST /api/checkout <span className="text-conflict">500</span></p>
          <p className="text-conflict/90">TypeError: reading &apos;toLowerCase&apos; of undefined</p>
          <p className="text-fg-2">  at sendReceipt (billing/receipts.ts:7)</p>
        </div>
      </div>
    </div>
  );
}

export function Problem() {
  const root = useRef<HTMLElement>(null);

  const armed = useArmed();

  useGSAP(
    () => {
      if (!armed) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERY, () => {
        const tl = gsap.timeline({
          defaults: { ease: EASE_OUT, duration: 0.6 },
          scrollTrigger: { trigger: "[data-pin]", start: "top top", end: "+=420%", pin: true, scrub: 0.6 },
        });
        const caption = (i: number) => {
          tl.to("[data-caption]", { opacity: 0, y: -8, duration: 0.3 }, "<")
            .fromTo(`[data-caption="${i}"]`, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 }, "<0.15");
        };
        tl.set(`[data-caption="0"]`, { opacity: 1, y: 0 });
        tl.to({}, { duration: 0.4 });

        // 1–3: each branch goes green, one by one
        [0, 1, 2].forEach((i) => {
          tl.addLabel(`b${i}`);
          caption(i + 1);
          tl.to(`[data-card="${i}"] [data-pending]`, { opacity: 0, duration: 0.25 }, `b${i}`)
            .to(`[data-card="${i}"] [data-pass]`, { opacity: 1, duration: 0.3 }, `b${i}+=0.1`)
            .fromTo(`[data-card="${i}"] [data-check]`, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45 }, `b${i}+=0.1`)
            .to(`[data-card="${i}"] [data-ring]`, { opacity: 1, duration: 0.4 }, `b${i}+=0.1`)
            .to(`[data-lane-dot="${i}"]`, { opacity: 1, duration: 0.3 }, `b${i}+=0.1`)
            .to({}, { duration: 0.35 });
        });

        // 4: merge — connectors flow into main, badge lands
        tl.addLabel("merge");
        caption(4);
        tl.fromTo("[data-connector]", { scaleY: 0 }, { scaleY: 1, transformOrigin: "50% 0%", stagger: 0.08, duration: 0.6 }, "merge")
          .to("[data-main-dot]", { opacity: 1, duration: 0.3 }, "merge+=0.5")
          .fromTo("[data-merged]", { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.5 }, "merge+=0.45")
          .fromTo("[data-down]", { scaleY: 0 }, { scaleY: 1, transformOrigin: "50% 0%", duration: 0.4 }, "merge+=0.6")
          .to({}, { duration: 0.5 });

        // 5: the crack — production splits, red shows through the gap
        tl.addLabel("crack");
        caption(5);
        tl.to("[data-half='l']", { x: -9, rotate: -0.8, duration: 0.6, ease: "quart.out" }, "crack")
          .to("[data-half='r']", { x: 9, rotate: 0.8, duration: 0.6, ease: "quart.out" }, "crack")
          .to("[data-glow]", { opacity: 1, duration: 0.5 }, "crack")
          .to("[data-ok]", { opacity: 0, duration: 0.2 }, "crack")
          .to("[data-bad]", { opacity: 1, duration: 0.3 }, "crack+=0.1")
          .to("[data-vignette]", { opacity: 1, duration: 0.6 }, "crack")
          .to("[data-merged-ok]", { opacity: 0, duration: 0.2 }, "crack")
          .to("[data-main-bad]", { opacity: 1, duration: 0.3 }, "crack")
          .to("[data-merged-bad]", { opacity: 1, duration: 0.3 }, "crack+=0.1")
          .to({}, { duration: 0.6 });
      });
      mm.add(REDUCED_QUERY, () => {
        // Final state, revealed with a simple fade.
        gsap.set("[data-caption]", { opacity: 1, y: 0 });
        gsap.set("[data-pending]", { opacity: 0 });
        gsap.set("[data-pass], [data-check], [data-ring], [data-merged], [data-bad], [data-glow], [data-merged-bad], [data-lane-dot], [data-main-dot], [data-main-bad]", { opacity: 1, scale: 1 });
        gsap.set("[data-connector], [data-down]", { scaleY: 1 });
        gsap.set("[data-ok], [data-merged-ok]", { opacity: 0 });
        gsap.from("[data-stage]", { opacity: 0, duration: 0.6, scrollTrigger: { trigger: "[data-stage]", start: "top 80%" } });
      });
    },
    { scope: root, dependencies: [armed] },
  );

  return (
    <section id="problem" ref={root} className="relative">
      <div data-pin className="relative flex min-h-[100svh] items-center overflow-hidden">
        <div data-vignette aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_75%,color-mix(in_srgb,var(--conflict)_14%,transparent),transparent_70%)] opacity-0" />
        <div className="relative mx-auto grid w-full max-w-[1200px] items-center gap-16 px-6 md:px-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
          <div>
            <p className="eyebrow">The problem</p>
            <div className="relative mt-6 min-h-[180px] motion-reduce:min-h-0 motion-reduce:space-y-6">
              {CAPTIONS.map((c, i) => (
                <div key={c.k} data-caption={i} className="absolute inset-x-0 top-0 opacity-0 motion-reduce:relative">
                  <p className="font-mono text-[12px] tabular text-fg-3">{c.k} / 06</p>
                  <h2 className={cn("mt-3 text-[clamp(30px,3.4vw,46px)] font-semibold leading-[1.05] tracking-[-0.035em]", i === 5 && "text-conflict")}>{c.title}</h2>
                  <p className="mt-4 max-w-[36ch] text-[17px] leading-[1.6] text-fg-2">{c.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div data-stage className="relative mx-auto w-full max-w-[640px]">
            {/* pull requests, drawn as a git graph */}
            <div className="surface overflow-hidden">
              <div className="flex h-11 items-center justify-between border-b border-line px-5">
                <span className="font-mono text-[12.5px] text-fg-2">acme/checkout-service</span>
                <span className="text-[12.5px] text-fg-3">3 pull requests</span>
              </div>
              <div className="relative">
                <svg aria-hidden width={60} height={GRAPH_H} className="absolute left-0 top-0">
                  <line x1={TRUNK_X} y1={0} x2={TRUNK_X} y2={GRAPH_H} stroke="var(--line-strong)" strokeWidth={1.5} />
                  {BRANCHES.map((b, i) => {
                    const cy = ROW_H * i + ROW_H / 2;
                    const x = LANE_X[i];
                    const color = `var(--${AGENT_STYLE[b.slot].token})`;
                    return (
                      <g key={b.slot}>
                        <g data-connector>
                          <path
                            d={`M${x} ${cy} V${MAIN_Y - 22} C${x} ${MAIN_Y - 6} ${TRUNK_X} ${MAIN_Y - 14} ${TRUNK_X} ${MAIN_Y}`}
                            fill="none"
                            stroke={color}
                            strokeOpacity={0.7}
                            strokeWidth={1.5}
                          />
                        </g>
                        <circle cx={x} cy={cy} r={4.5} fill="var(--surface-1)" stroke={color} strokeWidth={1.5} />
                        <circle data-lane-dot={i} cx={x} cy={cy} r={2.25} fill={color} opacity={0} />
                      </g>
                    );
                  })}
                  <circle cx={TRUNK_X} cy={MAIN_Y} r={5} fill="var(--surface-2)" stroke="var(--fg-2)" strokeWidth={1.5} />
                  <circle data-main-dot cx={TRUNK_X} cy={MAIN_Y} r={2.5} fill="var(--pass)" opacity={0} />
                  <circle data-main-bad cx={TRUNK_X} cy={MAIN_Y} r={2.5} fill="var(--conflict)" opacity={0} />
                </svg>

                {BRANCHES.map((b, i) => (
                  <div key={b.slot} data-card={i} className="relative flex items-center gap-4 border-b border-line pl-[68px] pr-5" style={{ height: ROW_H }}>
                    <span data-ring aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--pass)_7%,transparent),transparent_65%)] opacity-0" />
                    <div className="relative min-w-0 flex-1">
                      <div className="flex items-baseline gap-2.5">
                        <span className={cn("shrink-0 text-[12.5px] font-medium", AGENT_STYLE[b.slot].text)}>{b.name}</span>
                        <span className="truncate font-mono text-[13px] text-fg">{b.branch}</span>
                      </div>
                      <p className="mt-1 truncate text-[14px] text-fg-2">{b.change}</p>
                    </div>
                    <div className="relative h-7 w-[136px] shrink-0 text-[13px]">
                      <span data-pending className="absolute inset-0 flex items-center justify-end gap-2 text-fg-3">
                        <span className="size-2 rounded-full border border-fg-3" /> Checks running
                      </span>
                      <span data-pass className="absolute inset-0 flex items-center justify-end gap-2 text-pass opacity-0">
                        <span data-check className="grid size-[18px] place-items-center rounded-full border border-pass/40 bg-pass/10 opacity-0">
                          <Check size={11} strokeWidth={2.5} />
                        </span>
                        Checks passed
                      </span>
                    </div>
                  </div>
                ))}

                <div className="relative flex items-center gap-3 bg-surface-2 pl-[68px] pr-5" style={{ height: MAIN_H }}>
                  <GitMerge size={15} strokeWidth={1.5} className="text-fg-2" />
                  <span className="font-mono text-[13px] text-fg">main</span>
                  <span data-merged className="relative ml-auto text-[13px] opacity-0">
                    <span data-merged-ok className="text-pass">Merged cleanly · CI green</span>
                    <span data-merged-bad className="absolute right-0 top-0 whitespace-nowrap text-conflict opacity-0">Merged · production failing</span>
                  </span>
                </div>
              </div>
            </div>

            <span data-down aria-hidden className="ml-[14px] block h-8 w-px origin-top bg-line-strong" />

            {/* production — splits along a crack */}
            <div className="relative h-[132px]">
              <div data-glow aria-hidden className="absolute inset-y-2 left-1/2 w-24 -translate-x-1/2 rounded-full bg-conflict opacity-0 blur-2xl" />
              <div data-half="l" className="absolute inset-0" style={{ clipPath: CLIP_L }}>
                <ProdPanel />
              </div>
              <div data-half="r" className="absolute inset-0" style={{ clipPath: CLIP_R }}>
                <ProdPanel />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
