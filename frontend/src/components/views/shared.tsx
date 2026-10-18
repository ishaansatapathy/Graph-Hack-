"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/state";

/** Error from a dashboard API route: the backend's message plus HTTP status and code. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    signal: init.signal,
    cache: "no-store",
    ...(init.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as ({ error?: string; code?: string } & T) | null;
  if (!res.ok) throw new ApiError(json?.error ?? `Request failed (${res.status})`, res.status, json?.code);
  return json as T;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Resource<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiError };

/** Loads `path` on mount and on `reload()`; state only changes in async callbacks. */
export function useResource<T>(path: string) {
  const [state, setState] = useState<Resource<T>>({ status: "loading" });
  const [nonce, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<T>(path, { signal: ctrl.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((error) => {
        if (!ctrl.signal.aborted) setState({ status: "error", error: error instanceof ApiError ? error : new ApiError(errorMessage(error), 0) });
      });
    return () => ctrl.abort();
  }, [path, nonce]);

  /** Refetch; `quiet` keeps the current data on screen while it loads. */
  const reload = useCallback((quiet = true) => {
    if (!quiet) setState({ status: "loading" });
    bump();
  }, []);

  return { state, reload };
}

export function ViewLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-bg font-mono text-[12px] text-fg-3">
      <RefreshCw className="mr-2 size-4 animate-spin text-accent" /> {label}
    </div>
  );
}

/** Full-view state for a failed load: sign-in prompt on 401, otherwise the error with Retry. */
export function ViewError({ error, onRetry, title }: { error: ApiError; onRetry: () => void; title: string }) {
  if (error.status === 401) {
    return (
      <div className="h-full bg-bg">
        <EmptyState
          title="Sign in to use this workspace"
          body="This view reads and changes your workspace on the Stackfox backend."
          action={
            <Link href="/signin">
              <Button size="sm" variant="primary">Sign in</Button>
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="h-full bg-bg">
      <ErrorState title={title} message={error.message} onRetry={onRetry} />
    </div>
  );
}

/** Inline result line for an action: green on success, red on failure. */
export type Notice = { tone: "ok" | "error"; text: string } | null;

export function NoticeBar({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  if (!notice) return null;
  const ok = notice.tone === "ok";
  return (
    <div
      role={ok ? "status" : "alert"}
      className={`mb-6 flex items-center justify-between gap-4 rounded-md border px-4 py-2.5 font-mono text-[12px] ${
        ok ? "border-pass/30 bg-pass/10 text-pass" : "border-conflict/30 bg-conflict/10 text-conflict"
      }`}
    >
      <span>{notice.text}</span>
      <button onClick={onDismiss} className="shrink-0 hover:underline">
        dismiss
      </button>
    </div>
  );
}

/** Lets a view send the user to another dashboard tab, e.g. to connect GitHub. */
export type OpenTab = (tab: "studio" | "ide" | "vault" | "integrations" | "workspace" | "conflicts") => void;
