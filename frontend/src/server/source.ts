import "server-only";
import type { ScenarioSnapshot } from "@/lib/types";
import { script, snapshot } from "./fixture";

/** When set, the API routes proxy to the SYNK backend (FalkorDB-backed).
    Otherwise the built-in demo scenario is served. */
const BACKEND = process.env.SYNK_BACKEND_URL?.replace(/\/$/, "");

const unreachable = (err: unknown) =>
  new Error(
    `SYNK backend not reachable at ${BACKEND}. ` +
      `(${err instanceof Error ? err.message : String(err)})`,
  );

async function backendError(res: Response, path: string) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `backend ${path} ${res.status}`);
}

export async function getScenario(): Promise<ScenarioSnapshot> {
  if (!BACKEND) return snapshot;
  let res: Response;
  try {
    res = await fetch(`${BACKEND}/scenario`, { cache: "no-store" });
  } catch (err) {
    throw unreachable(err);
  }
  if (!res.ok) throw await backendError(res, "/scenario");
  return res.json();
}

const encoder = new TextEncoder();

/** Proxies the backend's Server-Sent Events stream of a scenario run. */
export function streamEvents(signal: AbortSignal, speed = 1): ReadableStream<Uint8Array> {
  if (!BACKEND) return demoStream(signal, speed);
  return new ReadableStream({
    async start(controller) {
      const fail = (message: string) => {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
        controller.close();
      };
      let res: Response;
      try {
        res = await fetch(`${BACKEND}/events?speed=${speed}`, { signal, cache: "no-store" });
      } catch (err) {
        if (!signal.aborted) fail(unreachable(err).message);
        return;
      }
      if (!res.ok || !res.body) return fail((await backendError(res, "/events")).message);
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch {
        if (!signal.aborted) controller.close();
      }
    },
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Replays the built-in demo scenario as Server-Sent Events. */
function demoStream(signal: AbortSignal, speed: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      let last = 0;
      controller.enqueue(encoder.encode("retry: 600000\n\n"));
      for (const ev of script) {
        await sleep((ev.at - last) / speed, signal);
        if (signal.aborted) break;
        last = ev.at;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      }
      if (!signal.aborted) {
        controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
        controller.close();
      }
    },
  });
}
