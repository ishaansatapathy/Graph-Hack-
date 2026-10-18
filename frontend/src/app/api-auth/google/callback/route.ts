import { type NextRequest, NextResponse } from "next/server";

const BACKEND = (process.env.STACKFOX_BACKEND_URL ?? process.env.SYNK_BACKEND_URL ?? "http://localhost:8000").replace(/\/$/, "");

function sanitizeProxiedSetCookie(setCookie: string): string {
  return setCookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^domain=/i.test(part))
    .join("; ");
}

export async function GET(request: NextRequest) {
  const upstream = `${BACKEND}/auth/google/callback${request.nextUrl.search}`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      redirect: "manual",
      headers: {
        cookie: request.headers.get("cookie") ?? "",
      },
    });
  } catch {
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set(
      "error",
      "Backend API is not reachable. Ensure the backend is running on port 8000.",
    );
    return NextResponse.redirect(signInUrl);
  }

  const location = upstreamRes.headers.get("location");
  const response = location
    ? NextResponse.redirect(new URL(location, request.url))
    : new NextResponse(upstreamRes.body, { status: upstreamRes.status });

  const setCookies =
    typeof upstreamRes.headers.getSetCookie === "function" ? upstreamRes.headers.getSetCookie() : [];

  if (setCookies.length > 0) {
    for (const sc of setCookies) {
      response.headers.append("set-cookie", sanitizeProxiedSetCookie(sc));
    }
  } else {
    const single = upstreamRes.headers.get("set-cookie");
    if (single) {
      response.headers.set("set-cookie", sanitizeProxiedSetCookie(single));
    }
  }

  return response;
}
