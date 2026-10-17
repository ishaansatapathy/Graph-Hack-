import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";

export function Footer() {
  return (
    <footer className="relative border-t border-line">
      <div className="mx-auto max-w-[1200px] px-6 py-28 md:px-10 md:py-36">
        <h2 className="max-w-[22ch] text-[clamp(36px,5.2vw,76px)] font-semibold leading-[1] tracking-[-0.045em]">
          Catch it before <span className="text-fg-3">main</span> does.
        </h2>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/signin"
            className="group inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-5 text-[14px] font-medium text-accent-ink shadow-[inset_0_1px_0_0_var(--highlight)] transition-opacity hover:opacity-90"
          >
            Get started
            <ArrowRight size={15} strokeWidth={2} className="transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 px-6 py-6 text-[12.5px] text-fg-3 md:px-10">
          <span className="flex items-center gap-2">
            <Logo className="size-4 text-fg-2" />
            <span className="font-semibold tracking-[0.12em] text-fg-2">SYNK</span>
          </span>
          <span>Built for Graph Hacks with FalkorDB</span>
        </div>
      </div>
    </footer>
  );
}
