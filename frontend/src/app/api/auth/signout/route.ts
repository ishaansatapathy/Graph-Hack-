import { BACKEND } from "@/server/source";

const SESSION_COOKIES = ["jwt", "jwt_refresh"];

/** Ends the session: asks the backend to invalidate the tokens, then expires the
    session cookies on this origin (they are set here by the OAuth callback proxy). */
export async function POST(req: Request) {
  const cookie = req.headers.get("cookie");
  if (cookie) {
    // Best effort — the cookies are cleared below even if the backend is asleep or unreachable.
    await fetch(`${BACKEND}/trpc/auth.logout`, {
      method: "POST",
      headers: { cookie },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    }).catch(() => null);
  }

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const name of SESSION_COOKIES) {
    headers.append("Set-Cookie", `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`);
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
