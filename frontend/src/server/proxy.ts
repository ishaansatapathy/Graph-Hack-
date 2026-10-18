import "server-only";
import { BACKEND } from "./source";

/** Forwards a dashboard API request to the same path on the backend, carrying
    the browser's session cookie and query string, and relays refreshed cookies. */
export async function proxyToBackend(req: Request, path: string): Promise<Response> {
  const url = `${BACKEND}${path.startsWith("/") ? path : `/${path}`}${new URL(req.url).search}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  if (hasBody) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? await req.text() : undefined,
      cache: "no-store",
    });
    const out = new Headers({ "Content-Type": res.headers.get("content-type") ?? "application/json" });
    for (const c of res.headers.getSetCookie()) out.append("Set-Cookie", c);
    return new Response(await res.text(), { status: res.status, headers: out });
  } catch (err) {
    return Response.json(
      { error: `Stackfox backend not reachable at ${BACKEND} (${err instanceof Error ? err.message : String(err)})`, code: "UNAVAILABLE" },
      { status: 502 },
    );
  }
}

type SlugProps = { params: Promise<{ slug?: string[] }> };

/** Route handlers for `app/api/<prefix>/[[...slug]]` — every method maps to the backend path. */
export function proxyRoutes(prefix: string) {
  const handler = async (req: Request, props: SlugProps) => {
    const { slug = [] } = await props.params;
    return proxyToBackend(req, `/api/${prefix}${slug.length ? `/${slug.map(encodeURIComponent).join("/")}` : ""}`);
  };
  return { GET: handler, POST: handler, DELETE: handler };
}
