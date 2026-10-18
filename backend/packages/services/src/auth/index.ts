import crypto from "node:crypto";
import type { Request, Response } from "express";

import { env, getGithubOAuthConfig, getGoogleOAuthConfig, isGoogleOAuthConfigured } from "../env";
import { getGoogleOAuth2Client } from "../clients/google-oauth";
import * as userDb from "../db";
import type { DbUser } from "../db";
import { sendWelcomeEmail } from "../email";
import { AuthError, toAuthError } from "./errors";
import {
  clearAuthCookies,
  issueAuthCookies,
  verifyAccessToken,
  verifyRefreshToken,
} from "./jwt";
import type { AuthUser, MessageOutput } from "./model";
import { sanitizeRedirectPath } from "./safe-redirect";

function sanitizeEmail(email: string) {
  return email.toLowerCase().trim();
}

function toPublicUser(user: DbUser): AuthUser {
  return {
    id: user.id,
    fullName: user.full_name,
    displayName: user.display_name,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    profileImageUrl: user.profile_image_url,
    twoFactorEnabled: false,
    role: user.role === "admin" ? "admin" : "user",
  };
}

function toTokenUser(user: DbUser) {
  return {
    id: user.id,
    emailVerified: Boolean(user.email_verified),
    role: user.role === "admin" ? "admin" : "user",
    tokenVersion: user.token_version ?? "0",
  } as const;
}

class AuthService {
  private async findUserByEmail(email: string) {
    return userDb.findUserByEmail(sanitizeEmail(email));
  }

  private async findUserById(userId: string) {
    return userDb.findUserById(userId);
  }

  private isRefreshTokenCurrent(user: DbUser, tokenVersion: string | undefined) {
    return (user.token_version ?? "0") === (tokenVersion ?? "0");
  }

  private async resolveTokenUserId(req: Request) {
    const accessToken = req.cookies?.jwt as string | undefined;
    const refreshToken = req.cookies?.jwt_refresh as string | undefined;

    try {
      if (accessToken) return verifyAccessToken(accessToken).userId;
    } catch {
      // expired access token
    }

    try {
      if (refreshToken) return verifyRefreshToken(refreshToken).userId;
    } catch {
      return null;
    }

    return null;
  }

  public async resolveSession(req: Request, res?: Response): Promise<AuthUser | null> {
    const accessToken = req.cookies?.jwt as string | undefined;
    const refreshToken = req.cookies?.jwt_refresh as string | undefined;

    const rejectUnverified = (user: DbUser | null) => {
      if (user && !user.email_verified) {
        if (res) clearAuthCookies(res);
        return null;
      }
      return user ? toPublicUser(user) : null;
    };

    if (accessToken) {
      try {
        const decoded = verifyAccessToken(accessToken);
        const user = await this.findUserById(decoded.userId);
        return rejectUnverified(user);
      } catch {
        // try refresh
      }
    }

    if (refreshToken && res) {
      try {
        const decoded = verifyRefreshToken(refreshToken);
        const user = await this.findUserById(decoded.userId);
        if (!user) return null;
        if (!this.isRefreshTokenCurrent(user, decoded.tokenVersion)) {
          clearAuthCookies(res);
          return null;
        }
        if (!user.email_verified) {
          clearAuthCookies(res);
          return null;
        }
        issueAuthCookies(res, toTokenUser(user));
        return toPublicUser(user);
      } catch {
        return null;
      }
    }

    return null;
  }

  public async logout(req: Request, res: Response): Promise<MessageOutput> {
    const userId = await this.resolveTokenUserId(req);
    if (userId) userDb.bumpTokenVersion(userId);
    clearAuthCookies(res);
    return { message: "Logged out successfully" };
  }

  public async handleGoogleCallback(
    code: string,
    res: Response,
    returnTo = "/",
    redirectUri?: string,
  ): Promise<string> {
    if (!isGoogleOAuthConfigured()) {
      throw new AuthError("INTERNAL", "Google OAuth is not configured");
    }

    const safeReturnTo = sanitizeRedirectPath(returnTo);
    const tokenRedirectUri = redirectUri?.trim() || getGoogleOAuthConfig().redirectUri;
    if (!tokenRedirectUri) {
      throw new AuthError("INTERNAL", "Google OAuth redirect URI is not configured");
    }

    try {
      const client = getGoogleOAuth2Client();
      const { tokens } = await client.getToken({ code, redirect_uri: tokenRedirectUri });
      client.setCredentials(tokens);

      if (!tokens.id_token) {
        throw new AuthError("UNAUTHORIZED", "Google sign-in did not return an ID token");
      }

      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: env.GOOGLE_OAUTH_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload?.email) {
        throw new AuthError("UNAUTHORIZED", "Google account email not available");
      }

      const sanitizedEmail = sanitizeEmail(payload.email);
      let user = await this.findUserByEmail(sanitizedEmail);

      if (!user) {
        user = await userDb.insertUser({
          id: crypto.randomUUID(),
          email: sanitizedEmail,
          fullName: payload.name?.trim() || sanitizedEmail.split("@")[0] || "User",
          displayName: payload.name?.trim() || sanitizedEmail.split("@")[0] || "User",
          profileImageUrl: payload.picture ?? null,
          provider: "google",
          providerId: payload.sub,
          emailVerified: Boolean(payload.email_verified ?? true),
        });
        // Fire-and-forget welcome email for new sign-ups
        void sendWelcomeEmail({ to: sanitizedEmail, name: user.full_name || sanitizedEmail });
      } else if (user.provider !== "google") {
        throw new AuthError(
          "CONFLICT",
          "An account with this email already exists. Sign in with your original method.",
        );
      } else {
        if (user.provider_id && user.provider_id !== payload.sub) {
          throw new AuthError("CONFLICT", "This email is linked to a different Google account.");
        }
        if (!user.provider_id || !user.email_verified) {
          await userDb.updateUserProvider(user.id, {
            providerId: payload.sub,
            profileImageUrl: payload.picture ?? user.profile_image_url,
            emailVerified: Boolean(payload.email_verified ?? true),
          });
          user = (await this.findUserById(user.id))!;
        }
      }

      if (!user) {
        throw new AuthError("INTERNAL", "Unable to sign in with Google");
      }

      if (!user.email_verified) {
        clearAuthCookies(res);
        return `${env.CLIENT_URL}/sign-in?error=${encodeURIComponent("Please verify your Google email and try again.")}`;
      }

      issueAuthCookies(res, toTokenUser(user));
      const destination = safeReturnTo;
      const separator = destination.includes("?") ? "&" : "?";
      return `${env.CLIENT_URL}${destination}${separator}hero=1`;
    } catch (error) {
      throw toAuthError(error, "Google sign-in failed. Please try again.");
    }
  }

  /** Exchanges a GitHub OAuth code, signs the user in by their verified primary email. */
  public async handleGithubCallback(code: string, res: Response, returnTo = "/app"): Promise<string> {
    const { clientId, clientSecret, redirectUri } = getGithubOAuthConfig();
    if (!clientId || !clientSecret) {
      throw new AuthError("INTERNAL", "GitHub OAuth is not configured");
    }

    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      const token = (await tokenRes.json()) as { access_token?: string; error_description?: string };
      if (!token.access_token) {
        throw new AuthError("UNAUTHORIZED", token.error_description ?? "GitHub did not return an access token");
      }

      const gh = (path: string) =>
        fetch(`https://api.github.com${path}`, {
          headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "stackfox" },
        });
      const profile = (await (await gh("/user")).json()) as { id: number; login: string; name?: string | null; avatar_url?: string };
      const emails = (await (await gh("/user/emails")).json()) as { email: string; primary: boolean; verified: boolean }[];
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : undefined;
      if (!profile?.id || !primary) {
        throw new AuthError("UNAUTHORIZED", "Your GitHub account needs a verified primary email");
      }

      const email = sanitizeEmail(primary.email);
      const providerId = String(profile.id);
      const name = profile.name?.trim() || profile.login;
      let user = await this.findUserByEmail(email);

      if (!user) {
        user = await userDb.insertUser({
          id: crypto.randomUUID(),
          email,
          fullName: name,
          displayName: profile.login,
          profileImageUrl: profile.avatar_url ?? null,
          provider: "github",
          providerId,
          emailVerified: true,
        });
        void sendWelcomeEmail({ to: email, name });
      } else if (user.provider === "github") {
        if (user.provider_id && user.provider_id !== providerId) {
          throw new AuthError("CONFLICT", "This email is linked to a different GitHub account.");
        }
      } else if (user.provider === "dev") {
        // Dev logins prove nothing about the email; a verified GitHub email takes the account over.
        await userDb.updateUserProvider(user.id, {
          provider: "github",
          providerId,
          profileImageUrl: profile.avatar_url ?? user.profile_image_url,
          emailVerified: true,
        });
        user = (await this.findUserById(user.id))!;
      } else {
        throw new AuthError("CONFLICT", "An account with this email already exists. Sign in with your original method.");
      }

      issueAuthCookies(res, toTokenUser(user));
      return `${env.CLIENT_URL}${sanitizeRedirectPath(returnTo)}`;
    } catch (error) {
      throw toAuthError(error, "GitHub sign-in failed. Please try again.");
    }
  }

  public async handleDevLogin(
    email: string,
    res: Response,
    returnTo = "/app",
  ): Promise<string> {
    const sanitizedEmail = sanitizeEmail(email || "ishaansatapathy09@gmail.com");
    let user = await this.findUserByEmail(sanitizedEmail);

    if (!user) {
      user = await userDb.insertUser({
        id: crypto.randomUUID(),
        email: sanitizedEmail,
        fullName: sanitizedEmail === "ishaansatapathy09@gmail.com" ? "Ishaan Satapathy" : (sanitizedEmail.split("@")[0] || "User"),
        displayName: sanitizedEmail === "ishaansatapathy09@gmail.com" ? "Ishaan" : (sanitizedEmail.split("@")[0] || "User"),
        profileImageUrl: null,
        provider: "dev",
        providerId: "dev-" + crypto.randomUUID(),
        emailVerified: true,
      });
    }

    issueAuthCookies(res, toTokenUser(user));
    const destination = sanitizeRedirectPath(returnTo);
    return `${env.CLIENT_URL}${destination}`;
  }
}

export default AuthService;
