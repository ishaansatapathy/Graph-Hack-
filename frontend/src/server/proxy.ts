import "server-only";

const BACKEND = (process.env.STACKFOX_BACKEND_URL ?? process.env.SYNK_BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function proxyToBackend(path: string, options?: RequestInit): Promise<Response> {
  const url = `${BACKEND}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options?.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => null);
    return Response.json(data, { status: res.status });
  } catch (err) {
    return Response.json(
      { error: `Backend proxy error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
