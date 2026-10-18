const BACKEND = (process.env.STACKFOX_BACKEND_URL ?? process.env.SYNK_BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");
const DEMO_AUTH_ENABLED = process.env.NODE_ENV !== "production" && process.env.STACKFOX_DEMO_AUTH_ENABLED === "true";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { method?: string; email?: string } | null;
  if (body?.method === "google") {
    return Response.json({ redirect: "/api-auth/google" });
  }
  if (body?.method !== "email") {
    return Response.json({ error: "Unknown sign-in method" }, { status: 400 });
  }

  if (!DEMO_AUTH_ENABLED) {
    return Response.json({ error: "Sign-in is not configured for this application." }, { status: 503 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid work email." }, { status: 400 });
  }

  try {
    const checkBackend = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (checkBackend && checkBackend.ok) {
      return Response.json({
        redirect: `${BACKEND}/auth/dev-login?email=${encodeURIComponent(email)}&returnTo=/app`,
      });
    }
  } catch {
    // Return a service error instead of creating a client-only session.
  }

  return Response.json({ error: "Authentication service is unavailable." }, { status: 503 });
}
