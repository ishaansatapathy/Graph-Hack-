import crypto from "node:crypto";
import type { Request, Response } from "express";

import { env, getGoogleOAuthConfig, isGoogleOAuthConfigured } from "../env";
import { getGoogleOAuth2Client } from "../clients/google-oauth";
import * as userDb from "../db";
import type { DbUser } from "../db";
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
        const id = crypto.randomUUID();
        const newUser: DbUser = {
          id,
          full_name: payload.name?.trim() || sanitizedEmail.split("@")[0] || "User",
          display_name: null,
          email: sanitizedEmail,
          email_verified: 1,
          auth_provider: "google",
          provider_id: payload.sub,
          profile_image_url: payload.picture ?? null,
          token_version: "0",
          role: "user",
        };
        userDb.insertUser(newUser);
        user = newUser;
      } else if (user.auth_provider !== "google") {
        throw new AuthError(
          "CONFLICT",
          "An account with this email already exists. Sign in with your original method.",
        );
      } else {
        if (user.provider_id && user.provider_id !== payload.sub) {
          throw new AuthError("CONFLICT", "This email is linked to a different Google account.");
        }
        if (!user.provider_id) {
          userDb.updateUserProvider(
            user.id,
            payload.sub,
            payload.picture ?? null,
            payload.email_verified ?? false,
          );
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
}

export default AuthService;
