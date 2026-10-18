"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type State = { s: "idle" } | { s: "pending"; method: "google" | "github" | "email" } | { s: "error"; message: string };

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.78-.07-1.53-.2-2.25H12v4.26h6.44c-.28 1.48-1.12 2.72-2.38 3.56l3.77 2.92C21.98 18.98 23.49 15.87 23.49 12.27z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#34A853"
        d="M12 23c3.24 0 5.95-1.08 7.93-2.95l-3.77-2.92c-1.08.72-2.45 1.16-4.16 1.16-2.86 0-5.29-1.93-6.16-4.53l-3.66 2.84C3.99 20.53 7.7 23 12 23z"
      />
    </svg>
  );
}

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

  async function signIn(method: "google" | "github" | "email") {
    if (method === "google") {
      setState({ s: "pending", method: "google" });
      window.location.assign("/api-auth/google");
      return;
    }

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
    <div className="mt-8 space-y-3">
      <Button size="lg" className="w-full flex items-center justify-center gap-2.5" disabled={pending} onClick={() => signIn("google")}>
        {pending && state.method === "google" ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon className="size-4" />}
        Continue with Google SSO
      </Button>

      <Button size="lg" variant="ghost" className="w-full border border-line flex items-center justify-center gap-2.5 text-fg-2 hover:text-fg" disabled={pending} onClick={() => signIn("github")}>
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
