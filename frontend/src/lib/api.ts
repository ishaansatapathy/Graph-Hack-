import type { ApiError, ImportResult, ScenarioSnapshot, StreamEvent } from "./types";

/** Single client for every Stackfox endpoint the UI talks to. */

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new ApiRequestError(body?.error ?? `${res.status} ${res.statusText}`, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  scenario: (signal?: AbortSignal) => request<ScenarioSnapshot>("/api/scenario", { signal }),

  importRepo: (repo: string) =>
    request<ImportResult>("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo }),
    }),

  /** Subscribe to live workspace events. Returns an unsubscribe fn. */
  events(handlers: {
    onEvent: (ev: StreamEvent) => void;
    onOpen?: () => void;
    onEnd?: () => void;
    onError?: (message: string) => void;
  }): () => void {
    const es = new EventSource(`/api/events?t=${Date.now()}`);
    let ended = false;
    es.onopen = () => handlers.onOpen?.();
    es.onmessage = (m) => handlers.onEvent(JSON.parse(m.data) as StreamEvent);
    es.addEventListener("end", () => {
      ended = true;
      es.close();
      handlers.onEnd?.();
    });
    es.addEventListener("error", (m) => {
      if (ended) return;
      const data = (m as MessageEvent).data;
      es.close();
      handlers.onError?.(data ? (JSON.parse(data) as ApiError).error : "Event stream disconnected");
    });
    return () => {
      ended = true;
      es.close();
    };
  },
};
