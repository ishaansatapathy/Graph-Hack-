"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { trpc } from "~/lib/trpc";

type Invite = {
  workspaceName: string;
  inviterName: string;
  role: "owner" | "admin" | "member";
  email: string;
  expiresAt: string;
};

type Phase = "loading" | "ready" | "invalid" | "accepting" | "done";

function messageOf(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message.replace(/^\[[^\]]+\]\s*/, "") : fallback;
}

export function InviteAccept() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  const [phase, setPhase] = useState<Phase>("loading");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("This invite link is incomplete.");
      setPhase("invalid");
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const details = await trpc.workspace.members.inviteDetails.query({ token });
        if (cancelled) return;
        setInvite(details as Invite);

        // Session is optional here — unauthenticated visitors get a sign-in CTA
        try {
          const me = await trpc.auth.me.query({});
          if (!cancelled) setViewerEmail(me.email);
        } catch {
          if (!cancelled) setViewerEmail(null);
        }
        if (!cancelled) setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setError(messageOf(err, "This invite is invalid, expired, or already used."));
        setPhase("invalid");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    setPhase("accepting");
    setError("");
    try {
      await trpc.workspace.members.acceptInvite.mutate({ token });
      setPhase("done");
      setTimeout(() => router.push("/app"), 900);
    } catch (err) {
      setError(messageOf(err, "Could not accept the invite. Please try again."));
      setPhase("ready");
    }
  }

  if (phase === "loading") {
    return <div className="invite-card invite-skeleton" aria-busy="true" aria-label="Loading invitation" />;
  }

  if (phase === "invalid" || !invite) {
    return (
      <section className="invite-card" id="invite-invalid">
        <div className="invite-icon invite-icon-error" aria-hidden>!</div>
        <h1 className="invite-title">Invitation unavailable</h1>
        <p className="invite-text">{error || "This invite is invalid, expired, or already used."}</p>
        <p className="invite-hint">Ask your teammate to send you a fresh invite.</p>
        <a className="invite-secondary" href="/app">Go to Stackfox</a>
      </section>
    );
  }

  const nextPath = `/invite/accept?token=${encodeURIComponent(token)}`;
  const signInHref = `/sign-in?next=${encodeURIComponent(nextPath)}`;
  const mismatch = viewerEmail !== null && viewerEmail.toLowerCase() !== invite.email.toLowerCase();

  return (
    <section className="invite-card" id="invite-card">
      <div className="invite-logo">Stackfox</div>

      {phase === "done" ? (
        <>
          <div className="invite-icon invite-icon-ok" aria-hidden>✓</div>
          <h1 className="invite-title">You&apos;re in!</h1>
          <p className="invite-text">Taking you to <strong>{invite.workspaceName}</strong>…</p>
        </>
      ) : (
        <>
          <div className="invite-avatar" aria-hidden>
            {invite.workspaceName.slice(0, 1).toUpperCase()}
          </div>
          <h1 className="invite-title">Join {invite.workspaceName}</h1>
          <p className="invite-text">
            <strong>{invite.inviterName}</strong> invited you to collaborate as{" "}
            <span className="invite-badge">{invite.role}</span>
          </p>
          <p className="invite-meta">
            Invite for <strong>{invite.email}</strong>
          </p>

          {error ? <p className="thread-auth-error" role="alert">{error}</p> : null}

          {viewerEmail === null ? (
            <a id="invite-signin" className="invite-primary" href={signInHref}>
              Sign in with Google to accept
            </a>
          ) : mismatch ? (
            <>
              <p className="invite-warn">
                You&apos;re signed in as <strong>{viewerEmail}</strong>, but this invite is for{" "}
                <strong>{invite.email}</strong>.
              </p>
              <a id="invite-switch" className="invite-primary" href={signInHref}>
                Sign in with {invite.email}
              </a>
            </>
          ) : (
            <button
              id="invite-accept"
              type="button"
              className="invite-primary"
              onClick={() => void accept()}
              disabled={phase === "accepting"}
            >
              {phase === "accepting" ? "Joining…" : "Accept & join workspace"}
            </button>
          )}

          <p className="invite-hint">
            Expires {new Date(invite.expiresAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </p>
        </>
      )}
    </section>
  );
}
