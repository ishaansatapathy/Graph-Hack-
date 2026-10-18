import { type NextRequest, NextResponse } from "next/server";

import { appendProxiedSetCookies } from "~/lib/proxied-set-cookie";

const API_BASE = process.env.API_INTERNAL_URL ?? "http://localhost:8000";

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email") || "ishaansatapathy09@gmail.com";
  const returnTo = request.nextUrl.searchParams.get("returnTo") || "/app";

  const upstream = `${API_BASE}/auth/dev-login?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnTo)}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      redirect: "manual",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
    });
  } catch {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set(
      "error",
      "Backend API is not running. Please start the backend dev server.",
    );
    return NextResponse.redirect(signInUrl);
  }

  const location = upstreamRes.headers.get("location") || returnTo;
  const redirectTarget = new URL(location, request.url);
  const response = NextResponse.redirect(redirectTarget);

  appendProxiedSetCookies(response.headers, upstreamRes.headers);

  return response;
}

export async function POST(request: NextRequest) {
  return GET(request);
}
