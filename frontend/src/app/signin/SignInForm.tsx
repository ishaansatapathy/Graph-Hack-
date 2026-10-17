"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type State = { s: "idle" } | { s: "pending"; method: "github" | "email" } | { s: "error"; message: string };

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function SignInForm() {
  const [state, setState] = useState<State>({ s: "idle" });
  const [email, setEmail] = useState("");

  async function signIn(method: "github" | "email") {
    setState({ s: "pending", method });
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "email" ? { method, email } : { method }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; redirect?: string };
      if (res.ok && body.redirect) {
        window.location.assign(body.redirect);
        return;
      }
      setState({ s: "error", message: body.error ?? `Sign-in failed (${res.status})` });
    } catch {
      setState({ s: "error", message: "Couldn't reach the server. Try again." });
    }
  }

  const pending = state.s === "pending";

  return (
    <div className="mt-8">
      <Button size="lg" className="w-full" disabled={pending} onClick={() => signIn("github")}>
        {pending && state.method === "github" ? <Loader2 size={16} className="animate-spin" /> : <GitHubMark className="size-4" />}
        Continue with GitHub
      </Button>

      <div className="my-6 flex items-center gap-3 text-[12px] text-fg-3">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          signIn("email");
        }}
      >
        <label htmlFor="email" className="text-[13px] text-fg-2">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={cn(
            "mt-2 h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-1 px-3.5 text-[15px] text-fg shadow-[inset_0_1px_0_0_var(--highlight)] outline-none transition-colors placeholder:text-fg-3 focus:border-accent/60",
          )}
        />
        <Button type="submit" variant="primary" size="lg" className="mt-3 w-full" disabled={pending}>
          {pending && state.method === "email" ? <Loader2 size={16} className="animate-spin" /> : null}
          Continue with email
          {!(pending && state.method === "email") && <ArrowRight size={15} strokeWidth={2} />}
        </Button>
      </form>

      {state.s === "error" && (
        <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-[var(--radius-control)] border border-risk/30 bg-risk/[0.07] px-3.5 py-3 text-[13px] text-fg-2">
          <AlertTriangle size={15} strokeWidth={1.5} className="mt-px shrink-0 text-risk" />
          {state.message}
        </div>
      )}
    </div>
  );
}
