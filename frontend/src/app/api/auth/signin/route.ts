import { BACKEND } from "@/server/source";

/** Passwordless email login is a development convenience and must be opted into. */
const DEMO_AUTH_ENABLED = process.env.NODE_ENV !== "production" && process.env.STACKFOX_DEMO_AUTH_ENABLED === "true";

/** Sign-in goes through the backend, which sets the session cookie and redirects
    back to /app. Google and GitHub use OAuth; email uses the backend's dev login. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { method?: string; email?: string } | null;
  if (body?.method === "google") {
    return Response.json({ redirect: "/api-auth/google" });
  }
  if (body?.method !== "github" && body?.method !== "email") {
    return Response.json({ error: "Unknown sign-in method" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (body.method === "email") {
    if (!DEMO_AUTH_ENABLED) {
      return Response.json({ error: "Email sign-in is disabled. Continue with GitHub or Google." }, { status: 503 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Enter a valid work email." }, { status: 400 });
    }
  }

  const health = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(3000), cache: "no-store" }).catch(() => null);
  if (!health?.ok) {
    return Response.json({ error: `Stackfox backend isn't reachable at ${BACKEND}` }, { status: 503 });
  }
  if (body.method === "github") {
    return Response.json({ redirect: "/api-auth/github?returnTo=/app" });
  }
  return Response.json({ redirect: `${BACKEND}/auth/dev-login?email=${encodeURIComponent(email)}&returnTo=/app` });
}
