import Link from "next/link";
import { Fragment } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { HeroGraph } from "./HeroGraph";

const LINES: { text: string; tone: string }[] = [
  { text: "Git merged it.", tone: "text-fg-2" },
  { text: "CI passed.", tone: "text-fg-2" },
  { text: "Production would have broken.", tone: "text-fg" },
  { text: "Stackfox caught it.", tone: "text-fg" },
];

/* Word-by-word reveal timed in CSS so the headline paints without waiting
   for hydration. Each sentence is a beat: cause, cause, effect, resolution. */
const STAGGER = 40;
const BEAT_GAP = [0, 160, 160, 300];
const timing = (() => {
  let t = 0;
  return LINES.map((l, i) => {
    t += BEAT_GAP[i];
    const words = l.text.split(" ").map((_, j) => t + j * STAGGER);
    t = words[words.length - 1];
    return words;
  });
})();
const STRIKE_AT = timing[2][timing[2].length - 1] + 350;
const FADE_AT = timing[3][timing[3].length - 1] + 200;

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden pt-20">
      <HeroGraph />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_30%_50%,transparent,var(--bg)_85%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-bg" />

      <div className="relative z-[2] mx-auto w-full max-w-[1200px] px-6 md:px-10">
        <p className="hero-fade eyebrow mb-8" style={{ animationDelay: "60ms" }}>
          Coordination for AI coding agents
        </p>
        <h1 className="text-[clamp(40px,5.6vw,84px)] font-semibold leading-[1.02] tracking-[-0.045em]">
          {LINES.map((l, i) => (
            <span key={i} className={cn("block", l.tone)}>
              {l.text.split(" ").map((w, j) => (
                <Fragment key={j}>
                  {j > 0 && " "}
                  <span className="relative inline-block overflow-hidden pb-[0.08em] align-top">
                    <span className="hero-word inline-block" style={{ animationDelay: `${timing[i][j]}ms` }}>
                      {i === 3 && j === 0 ? <span className="text-accent">{w}</span> : w}
                    </span>
                    {i === 2 && w === "broken." && (
                      <span aria-hidden className="strike absolute inset-x-0 top-[50%] h-[0.055em] bg-conflict" style={{ animationDelay: `${STRIKE_AT}ms` }} />
                    )}
                  </span>
                </Fragment>
              ))}
            </span>
          ))}
        </h1>
        <p className="hero-fade mt-10 max-w-[56ch] text-[17px] leading-[1.65] text-fg-2" style={{ animationDelay: `${FADE_AT}ms` }}>
          Every branch green. Combined, broken. Stackfox sees every agent&apos;s change as one graph — and catches it before merge.
        </p>
        <div className="hero-fade mt-10 flex flex-wrap items-center gap-3" style={{ animationDelay: `${FADE_AT + 80}ms` }}>
          <Link
            href="/signin"
            className="group inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-5 text-[14px] font-medium text-accent-ink shadow-[inset_0_1px_0_0_var(--highlight)] transition-opacity hover:opacity-90"
          >
            Get started
            <ArrowRight size={15} strokeWidth={2} className="transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#how"
            className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface-1 px-5 text-[14px] text-fg shadow-[inset_0_1px_0_0_var(--highlight)] transition-colors hover:bg-surface-2"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
