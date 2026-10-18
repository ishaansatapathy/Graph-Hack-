import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-bg/70 backdrop-blur-md">
      <nav className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-6 md:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="Stackfox home">
          <Logo className="size-[18px] text-accent" />
          <span className="text-[13px] font-semibold tracking-[0.12em]">STACKFOX</span>
        </Link>
        <div className="hidden items-center gap-7 text-[13px] text-fg-2 md:flex">
          <a href="#problem" className="transition-colors hover:text-fg">Problem</a>
          <a href="#how" className="transition-colors hover:text-fg">How it works</a>
          <a href="#features" className="transition-colors hover:text-fg">Features</a>
        </div>
        <div className="flex items-center gap-2">
        <Link href="/signin" className="inline-flex h-8 items-center px-3 text-[13px] text-fg-2 transition-colors hover:text-fg">
          Sign in
        </Link>
        <Link
          href="/signin"
          className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-line-strong bg-surface-1 px-3 text-[13px] text-fg shadow-[inset_0_1px_0_0_var(--highlight)] transition-colors hover:bg-surface-2"
        >
          Start
        </Link>
        </div>
      </nav>
    </header>
  );
}
