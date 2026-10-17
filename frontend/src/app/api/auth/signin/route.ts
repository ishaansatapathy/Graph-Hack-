const BACKEND = (process.env.STACKFOX_BACKEND_URL ?? process.env.SYNK_BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { method?: string; email?: string } | null;
  if (body?.method !== "github" && body?.method !== "email") {
    return Response.json({ error: "Unknown sign-in method" }, { status: 400 });
  }

  const email = body.method === "email" && body.email
    ? body.email.trim()
    : "ishaansatapathy09@gmail.com";

  try {
    // Attempt backend dev-login to issue auth cookies and session
    const checkBackend = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (checkBackend && checkBackend.ok) {
      return Response.json({
        redirect: `${BACKEND}/auth/dev-login?email=${encodeURIComponent(email)}&returnTo=/app`,
      });
    }
  } catch {
    // fallback below
  }

  // Resilient fallback: direct access to the dashboard
  return Response.json({ redirect: `/app?user=${encodeURIComponent(email)}` });
}
