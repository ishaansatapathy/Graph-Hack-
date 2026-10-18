import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const signInUrl = new URL("/signin", request.url);

  if (!clientId) {
    signInUrl.searchParams.set("error", "Google sign-in is not configured. Missing GOOGLE_OAUTH_CLIENT_ID.");
    return NextResponse.redirect(signInUrl);
  }

  try {
    const nonce = crypto.randomUUID();
    const returnTo = request.nextUrl.searchParams.get("returnTo") ?? "/app";
    const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ?? new URL("/api-auth/google/callback", request.url).toString());

    const state = Buffer.from(
      JSON.stringify({ nonce, returnTo, redirectUri }),
      "utf8",
    ).toString("base64url");

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      access_type: "online",
      prompt: "select_account",
      state,
    });

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    const response = NextResponse.redirect(googleAuthUrl);

    response.cookies.set("stackfox_oauth_state", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });

    return response;
  } catch (err) {
    signInUrl.searchParams.set("error", `Failed to start Google sign-in: ${(err as Error).message}`);
    return NextResponse.redirect(signInUrl);
  }
}
