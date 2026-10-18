import "server-only";

/** Every dashboard request is proxied to the Stackfox backend, carrying the
    browser's session cookie. There is no local data source. */
const BACKEND = (process.env.STACKFOX_BACKEND_URL ?? process.env.SYNK_BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");

const unreachable = (err: unknown) =>
  `Stackfox backend not reachable at ${BACKEND}. (${err instanceof Error ? err.message : String(err)})`;

function forwardHeaders(req: Request, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  return headers;
}

/** Relays a backend JSON response, including any refreshed session cookies. */
async function relay(res: Response) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
  return new Response(await res.text(), { status: res.status, headers });
}

const fail = (message: string, status = 502) => Response.json({ error: message }, { status });

export async function proxyJson(req: Request, path: string, init: { method?: string; body?: string } = {}) {
  try {
    const res = await fetch(`${BACKEND}${path}`, {
      method: init.method ?? "GET",
      body: init.body,
      headers: forwardHeaders(req, init.body ? { "Content-Type": "application/json" } : {}),
      cache: "no-store",
    });
    return relay(res);
  } catch (err) {
    return fail(unreachable(err));
  }
}

const encoder = new TextEncoder();

/** Proxies the backend's Server-Sent Events stream for the signed-in workspace. */
export function streamEvents(req: Request): ReadableStream<Uint8Array> {
  const signal = req.signal;
  return new ReadableStream({
    async start(controller) {
      const error = (message: string) => {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
        controller.close();
      };
      let res: Response;
      try {
        res = await fetch(`${BACKEND}/live/events`, { signal, headers: forwardHeaders(req), cache: "no-store" });
      } catch (err) {
        if (!signal.aborted) error(unreachable(err));
        return;
      }
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        return error(body?.error ?? `backend /live/events ${res.status}`);
      }
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
        controller.close();
      } catch {
        if (!signal.aborted) controller.close();
      }
    },
  });
}

export { BACKEND };
