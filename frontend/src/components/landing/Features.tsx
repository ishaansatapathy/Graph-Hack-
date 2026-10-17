"use client";

import { useRef } from "react";
import { BrainCircuit, Code2, FlaskConical, Network, ShieldCheck, Workflow } from "lucide-react";
import { Glyph } from "@/components/ui/glyph";
import { cn } from "@/lib/cn";
import { EASE_OUT, MOTION_QUERY, gsap, useGSAP } from "./gsap";
import { useArmed } from "./useArmed";

/* Spotlight card: a soft light follows the pointer (transform only). */
function Tile({ className, icon, kicker, title, body, children }: { className?: string; icon: React.ReactNode; kicker: string; title: string; body: string; children: React.ReactNode }) {
  const light = useRef<HTMLSpanElement>(null);
  return (
    <article
      data-tile
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (light.current) light.current.style.transform = `translate(${e.clientX - r.left - 200}px, ${e.clientY - r.top - 200}px)`;
      }}
      className={cn("surface group relative flex flex-col overflow-hidden p-6", className)}
    >
      <span ref={light} aria-hidden className="pointer-events-none absolute left-0 top-0 size-[400px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--fg)_6%,transparent),transparent_65%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative flex items-center gap-2 text-fg-3">
        {icon}
        <span className="eyebrow">{kicker}</span>
      </div>
      <h3 className="relative mt-3 text-[20px] font-medium tracking-[-0.02em] text-fg">{title}</h3>
      <p className="relative mt-1.5 max-w-[46ch] text-[15px] leading-[1.6] text-fg-2">{body}</p>
      <div className="relative mt-6 flex-1">{children}</div>
    </article>
  );
}

const TOOLS = ["find_consumers", "impact_of_change", "tests_for_path", "pending_changes_by_others", "evidence_path", "rank_change_risk", "blast_radius"];

export function Features() {
  const root = useRef<HTMLElement>(null);

  const armed = useArmed();

  useGSAP(
    () => {
      if (!armed) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_QUERY, () => {
        gsap.from("[data-tile]", {
          opacity: 0,
          y: 24,
          duration: 0.8,
          ease: EASE_OUT,
          stagger: 0.06,
          scrollTrigger: { trigger: "[data-bento]", start: "top 78%" },
        });

        // Each loop only runs while its tile is on screen.
        const loop = (sel: string, build: (tl: gsap.core.Timeline) => void) => {
          const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.8, paused: true });
          build(tl);
          gsap.timeline({ scrollTrigger: { trigger: sel, start: "top bottom", end: "bottom top", onToggle: (s) => (s.isActive ? tl.play() : tl.pause()) } });
        };

        // MCP: a call goes out, a result comes back — per tool
        loop("[data-f='mcp']", (tl) => {
          gsap.utils.toArray<HTMLElement>("[data-f='mcp'] [data-call]").forEach((row, i) => {
            tl.fromTo(row, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.35, ease: "quart.out" }, i * 0.9);
            tl.fromTo(row.querySelector("[data-res]"), { opacity: 0 }, { opacity: 1, duration: 0.25 }, i * 0.9 + 0.45);
          });
          tl.to("[data-f='mcp'] [data-call]", { opacity: 0, duration: 0.4 }, "+=1.4");
        });

        // Drift pipeline: each stage lights in order, fail → fix → pass
        loop("[data-f='drift']", (tl) => {
          tl.set("[data-f='drift'] [data-lit]", { opacity: 0 });
          gsap.utils.toArray<HTMLElement>("[data-f='drift'] [data-stage]").forEach((s, i) => {
            tl.to(s.querySelector("[data-lit]"), { opacity: 1, duration: 0.3 }, i * 0.55);
            tl.fromTo(s.querySelector("[data-bar]"), { scaleX: 0 }, { scaleX: 1, transformOrigin: "0% 50%", duration: 0.5, ease: "none" }, i * 0.55);
          });
          tl.to({}, { duration: 1 });
        });

        // Prevention: query → amber risk → green adapted
        loop("[data-f='prevent']", (tl) => {
          tl.set("[data-f='prevent'] [data-q], [data-f='prevent'] [data-amber], [data-f='prevent'] [data-green]", { opacity: 0 });
          tl.to("[data-f='prevent'] [data-q]", { opacity: 1, duration: 0.3 })
            .to("[data-f='prevent'] [data-amber]", { opacity: 1, duration: 0.3 }, "+=0.4")
            .to("[data-f='prevent'] [data-amber]", { opacity: 0, duration: 0.4 }, "+=0.8")
            .to("[data-f='prevent'] [data-green]", { opacity: 1, duration: 0.4 }, "<")
            .to({}, { duration: 1.2 });
        });

        // Graph: evidence segments trace, nodes sized by centrality
        loop("[data-f='graph']", (tl) => {
          tl.set("[data-f='graph'] [data-seg]", { scaleX: 0, transformOrigin: "0% 50%" });
          tl.to("[data-f='graph'] [data-seg]", { scaleX: 1, duration: 0.4, ease: "none", stagger: 0.4 });
          tl.to({}, { duration: 1.2 });
          tl.to("[data-f='graph'] [data-seg]", { opacity: 0, duration: 0.3 });
          tl.set("[data-f='graph'] [data-seg]", { opacity: 1, scaleX: 0 });
        });

        // Memory: a new session starts, the old incident lights up
        loop("[data-f='memory']", (tl) => {
          tl.set("[data-f='memory'] [data-recall], [data-f='memory'] [data-recall-text]", { opacity: 0 });
          tl.fromTo("[data-f='memory'] [data-session]", { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.4 })
            .to("[data-f='memory'] [data-recall]", { opacity: 1, duration: 0.3 }, "+=0.5")
            .fromTo("[data-f='memory'] [data-ring]", { scale: 0.6, opacity: 0.9 }, { scale: 2.2, opacity: 0, duration: 1.1, ease: "quart.out" }, "<")
            .to("[data-f='memory'] [data-recall-text]", { opacity: 1, duration: 0.3 }, "<0.2")
            .to({}, { duration: 1.4 });
        });

        // Code: a node chip is clicked → the linked line is flagged
        loop("[data-f='code']", (tl) => {
          tl.set("[data-f='code'] [data-flag]", { opacity: 0 });
          tl.to("[data-f='code'] [data-chip]", { opacity: 1, duration: 0.2 })
            .fromTo("[data-f='code'] [data-chip-ring]", { opacity: 0 }, { opacity: 1, duration: 0.2 }, "+=0.4")
            .to("[data-f='code'] [data-flag]", { opacity: 1, duration: 0.35 }, "+=0.1")
            .to("[data-f='code'] [data-chip-ring]", { opacity: 0, duration: 0.3 }, "+=1.4")
            .to("[data-f='code'] [data-flag]", { opacity: 0, duration: 0.3 }, "<");
        });
      });
    },
    { scope: root, dependencies: [armed] },
  );

  return (
    <section id="features" ref={root} className="relative py-32 md:py-40">
      <div className="mx-auto max-w-[1200px] px-6 md:px-10">
        <p className="eyebrow">What Stackfox does</p>
        <h2 className="mt-4 max-w-[20ch] text-[clamp(32px,4vw,56px)] font-semibold leading-[1.02] tracking-[-0.04em]">
          Read the graph before you write.
        </h2>

        <div data-bento className="mt-14 grid gap-3 md:grid-cols-3">
          <Tile
            className="md:col-span-2"
            icon={<Network size={14} strokeWidth={1.5} />}
            kicker="01 · Shared graph + MCP"
            title="One graph, shared as MCP tools."
            body="Every agent queries the same FalkorDB graph."
          >
            <div data-f="mcp" className="rounded-[var(--radius-control)] border border-line bg-surface-2 p-3 font-mono text-[12px] leading-[22px]">
              {[
                ["agent-a", "text-agent-a", "impact_of_change", "PC-A1", "2 nodes · 1 endpoint"],
                ["agent-c", "text-agent-c", "pending_changes_by_others", "notify.ts", "1 overlapping"],
                ["stackfox", "text-accent", "evidence_path", "PC-A1 → PC-B1", "6 hops"],
              ].map(([who, cls, tool, arg, res]) => (
                <div key={tool} data-call className="flex gap-3 whitespace-nowrap">
                  <span className={cn("w-14 shrink-0", cls)}>{who}</span>
                  <span className="truncate">
                    <span className="text-fg-3">→ </span>
                    <span className="text-accent">{tool}</span>
                    <span className="text-fg-3">(</span>
                    <span className="text-fg-2">{arg}</span>
                    <span className="text-fg-3">)</span>
                    <span data-res className="text-fg-3"> ← <span className="text-fg">{res}</span></span>
                  </span>
                </div>
              ))}
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                {TOOLS.map((t) => (
                  <span key={t} className="rounded-[4px] border border-line px-1.5 text-[10.5px] leading-[18px] text-fg-3">{t}</span>
                ))}
              </div>
            </div>
          </Tile>

          <Tile icon={<FlaskConical size={14} strokeWidth={1.5} />} kicker="02 · Contract drift" title="Detect, trace, fix, verify." body="Only the tests that matter run.">
            <div data-f="drift" className="space-y-2">
              {[
                ["Drift detected", "bg-conflict"],
                ["Targeted tests", "bg-risk"],
                ["Failure traced", "bg-conflict"],
                ["Fix proposed", "bg-accent"],
                ["Re-verified", "bg-pass"],
              ].map(([label, color]) => (
                <div key={label} data-stage className="flex items-center gap-3">
                  <span className="relative size-2">
                    <span className="absolute inset-0 rounded-full bg-surface-4" />
                    <span data-lit className={cn("absolute inset-0 rounded-full", color)} />
                  </span>
                  <span className="w-28 text-[12.5px] text-fg-2">{label}</span>
                  <span className="relative h-px flex-1 bg-line">
                    <span data-bar className={cn("absolute inset-0", color)} style={{ opacity: 0.6 }} />
                  </span>
                </div>
              ))}
            </div>
          </Tile>

          <Tile icon={<ShieldCheck size={14} strokeWidth={1.5} />} kicker="03 · Prevention" title="Prevent, not just detect." body="Agents see pending changes before writing.">
            <div data-f="prevent" className="space-y-2 font-mono text-[12px]">
              <p data-q className="text-fg-2"><span className="text-agent-c">agent-c</span> → pending_changes_by_others</p>
              <div className="relative h-9">
                <div data-amber className="absolute inset-0 flex items-center gap-2 rounded-[var(--radius-control)] border border-risk/30 bg-risk/10 px-3 text-risk">PC-A1 renames User.email</div>
                <div data-green className="absolute inset-0 flex items-center gap-2 rounded-[var(--radius-control)] border border-pass/30 bg-pass/10 px-3 text-pass">Prevented · reads primaryEmail</div>
              </div>
            </div>
          </Tile>

          <Tile className="md:col-span-2" icon={<Workflow size={14} strokeWidth={1.5} />} kicker="04 · Graph view" title="The evidence path." body="Shortest path explains. Centrality ranks risk.">
            <div data-f="graph" className="relative h-[120px]">
              <svg viewBox="0 0 600 120" className="absolute inset-0 size-full" aria-hidden>
                {[
                  [40, 60, 150, 30],
                  [150, 30, 270, 70],
                  [270, 70, 390, 35],
                  [390, 35, 480, 80],
                  [480, 80, 560, 50],
                ].map(([x1, y1, x2, y2], i) => {
                  const len = Math.round(Math.hypot(x2 - x1, y2 - y1) * 1000) / 1000;
                  const ang = Math.round((Math.atan2(y2 - y1, x2 - x1) * 180000) / Math.PI) / 1000;
                  return (
                    <g key={i} transform={`translate(${x1} ${y1}) rotate(${ang})`}>
                      <line x2={len} stroke="var(--line-strong)" />
                      <line data-seg x2={len} stroke="var(--conflict)" strokeWidth={1.6} />
                    </g>
                  );
                })}
                {[
                  [40, 60, 6, "var(--agent-a)"],
                  [150, 30, 11, "var(--fg-2)"],
                  [270, 70, 9, "var(--fg-2)"],
                  [390, 35, 10, "var(--fg-2)"],
                  [480, 80, 7, "var(--fg-2)"],
                  [560, 50, 6, "var(--agent-b)"],
                  [220, 105, 4, "var(--fg-3)"],
                  [440, 110, 4, "var(--fg-3)"],
                ].map(([x, y, r, c], i) => (
                  <g key={i}>
                    {Number(r) > 8 && <circle cx={x} cy={y} r={Number(r) + 5} fill="none" stroke="var(--risk)" strokeOpacity={0.45} />}
                    <circle cx={x} cy={y} r={r} fill="var(--surface-3)" stroke={String(c)} strokeWidth={1.4} />
                  </g>
                ))}
              </svg>
            </div>
          </Tile>

          <Tile icon={<BrainCircuit size={14} strokeWidth={1.5} />} kicker="05 · Memory" title="It remembers." body="Past incidents resurface in new sessions.">
            <div data-f="memory" className="space-y-3 font-mono text-[12px]">
              <p data-session className="text-fg-3">session S-0917 · rank_change_risk</p>
              <div className="flex items-center gap-3">
                <span className="relative grid size-5 place-items-center">
                  <span data-ring className="absolute inset-0 rounded-full border border-risk opacity-0" />
                  <Glyph kind="incident" size={16} className="text-fg-3" />
                  <span data-recall className="absolute inset-0 grid place-items-center text-risk">
                    <Glyph kind="incident" size={16} filled />
                  </span>
                </span>
                <span className="text-fg-2">INC-0412</span>
              </div>
              <p data-recall-text className="text-risk">Recalled: field rename broke iOS client</p>
            </div>
          </Tile>

          <Tile className="md:col-span-2" icon={<Code2 size={14} strokeWidth={1.5} />} kicker="06 · Code viewer" title="Node to line." body="Click a node, land on the exact diff line.">
            <div data-f="code" className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <span data-chip className="relative inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 font-mono text-[11.5px] text-fg">
                <Glyph kind="function" size={11} className="text-fg-2" /> sendReceipt()
                <span data-chip-ring className="absolute -inset-[3px] rounded-full border border-accent opacity-0" />
              </span>
              <div className="min-w-0 flex-1 overflow-hidden rounded-[var(--radius-control)] border border-line bg-surface-2 py-1.5 font-mono text-[12px] leading-[20px]">
                {[
                  ["5", "export async function sendReceipt(order: Order) {"],
                  ["6", "  const user = await fetchUser(order.userId);"],
                  ["7", "  const to = user.email.toLowerCase();"],
                  ["8", "  await mailer.send({ to, template: \"receipt\" });"],
                ].map(([n, t]) => (
                  <div key={n} className="relative grid grid-cols-[32px_1fr] whitespace-pre text-fg-2">
                    {n === "7" && <span data-flag aria-hidden className="absolute inset-0 border-l-2 border-risk bg-risk/10" />}
                    <span className="relative pr-3 text-right text-fg-3">{n}</span>
                    <span className="relative truncate">{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </Tile>
        </div>
      </div>
    </section>
  );
}
