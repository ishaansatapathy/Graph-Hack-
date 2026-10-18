import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { BACKEND } from "./source";

/** Cookies must land on this origin, so drop any Domain the backend set. */
function sanitizeProxiedSetCookie(setCookie: string): string {
  return setCookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^domain=/i.test(part))
    .join("; ");
}

/**
 * Runs one step of a backend OAuth flow on behalf of the browser and relays the
 * redirect and Set-Cookie headers, so state and session cookies are first-party here.
 */
export async function relayAuthStep(request: NextRequest, backendPath: string): Promise<NextResponse> {
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}${backendPath}${request.nextUrl.search}`, {
      redirect: "manual",
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
  } catch {
    const signIn = new URL("/signin", request.url);
    signIn.searchParams.set("error", "Sign-in service is not reachable. Try again in a minute.");
    return NextResponse.redirect(signIn);
  }

  const location = upstream.headers.get("location");
  const response = location
    ? NextResponse.redirect(new URL(location, request.url))
    : new NextResponse(upstream.body, { status: upstream.status });
  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", sanitizeProxiedSetCookie(cookie));
  }
  return response;
}
