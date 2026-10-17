import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in — SYNK" };

export default function SignInPage() {
  return (
    <div className="grain relative flex min-h-dvh flex-col bg-bg">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,var(--line)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_50%_50%_at_50%_45%,black,transparent)]" />
      <header className="relative flex h-14 items-center px-6 md:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="SYNK home">
          <Logo className="size-[18px] text-accent" />
          <span className="text-[13px] font-semibold tracking-[0.12em]">SYNK</span>
        </Link>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 pb-20">
        <div className="w-full max-w-[380px]">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Sign in to SYNK</h1>
          <p className="mt-2 text-[15px] text-fg-2">Coordinate your agents on one graph.</p>
          <SignInForm />
          <p className="mt-8 text-[13px] text-fg-3">
            Just looking?{" "}
            <Link href="/app?autorun=1" className="text-fg-2 underline decoration-line-strong underline-offset-4 hover:text-fg">
              Open the demo
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
