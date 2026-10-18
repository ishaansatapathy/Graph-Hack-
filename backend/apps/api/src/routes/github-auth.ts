import crypto from "node:crypto";
import { Router } from "express";
import { AuthService, getGithubOAuthConfig, isGithubOAuthConfigured, sanitizeRedirectPath, toAuthError } from "@stackfox/services";

import { env } from "../env";

const authService = new AuthService();

export const githubAuthRouter = Router();

const STATE_COOKIE = "stackfox_github_state";
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production" || env.NODE_ENV === "prod",
  path: "/",
};

const signInError = (message: string) => `${env.CLIENT_URL}/signin?error=${encodeURIComponent(message)}`;

/** Starts GitHub OAuth: remembers a nonce + returnTo in a cookie, then redirects to GitHub. */
githubAuthRouter.get("/github", (req, res) => {
  if (!isGithubOAuthConfigured()) {
    return res.redirect(signInError("GitHub sign-in isn't configured on the server yet."));
  }
  const { clientId, redirectUri } = getGithubOAuthConfig();
  const nonce = crypto.randomBytes(16).toString("hex");
  const returnTo = sanitizeRedirectPath(typeof req.query.returnTo === "string" ? req.query.returnTo : "/app");
  res.cookie(STATE_COOKIE, JSON.stringify({ nonce, returnTo }), { ...cookieOptions, maxAge: 10 * 60 * 1000 });

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", nonce);
  url.searchParams.set("allow_signup", "true");
  return res.redirect(url.toString());
});

githubAuthRouter.get("/github/callback", async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query as Record<string, string | undefined>;
  const raw = req.cookies?.[STATE_COOKIE] as string | undefined;
  res.clearCookie(STATE_COOKIE, cookieOptions);

  if (error) return res.redirect(signInError(errorDescription || error.replace(/_/g, " ")));

  let saved: { nonce?: string; returnTo?: string } = {};
  try {
    saved = raw ? JSON.parse(raw) : {};
  } catch {
    // treated as expired below
  }
  if (!code || !state || !saved.nonce || saved.nonce !== state) {
    return res.redirect(signInError("GitHub sign-in session expired. Please try again."));
  }

  try {
    return res.redirect(await authService.handleGithubCallback(code, res, saved.returnTo ?? "/app"));
  } catch (err) {
    const authError = toAuthError(err, "GitHub sign-in failed. Please try again.");
    console.error("GitHub OAuth callback failed", authError.message);
    return res.redirect(signInError(authError.message));
  }
});
