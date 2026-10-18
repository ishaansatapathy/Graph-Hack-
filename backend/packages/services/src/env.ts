import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

function loadRootEnv() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      // Deployment environment must take precedence over values in a local .env file.
      config({ path: envPath, override: false });
      return;
    }
    dir = path.dirname(dir);
  }
}

loadRootEnv();

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const envSchema = z.object({
  JWT_SECRET: z.string().min(16).default("dev-only-change-this-secret-key"),
  JWT_REFRESH_SECRET: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "production", "prod", "test"]).default("development"),
  JWT_COOKIE_SAMESITE: z.string().optional(),
  JWT_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(),
  DATABASE_PATH: z.string().optional(),
  API_PUBLIC_URL: z.string().optional(),
  FALKORDB_HOST: z.string().optional(),
  FALKORDB_PORT: z.string().optional(),
  FALKORDB_GRAPH: z.string().optional(),
  FALKORDB_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENROUTER_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  FP_SALT: z.preprocess(emptyToUndefined, z.string().optional()),
  ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  // Email
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  EMAIL_FROM: z.string().default("Stackfox <onboarding@resend.dev>"),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  const parsed = safeParseResult.data;
  const isNextProductionBuild = env.NEXT_PHASE === "phase-production-build";
  if ((parsed.NODE_ENV === "production" || parsed.NODE_ENV === "prod") && !isNextProductionBuild) {
    if (parsed.JWT_SECRET.length < 32 || parsed.JWT_SECRET === "dev-only-change-this-secret-key") {
      throw new Error("JWT_SECRET must be at least 32 characters in production.");
    }
    if (!parsed.ENCRYPTION_KEY) {
      throw new Error("ENCRYPTION_KEY (at least 32 characters) is required in production.");
    }
    if (!parsed.DATABASE_URL) {
      throw new Error("DATABASE_URL is required in production.");
    }
    if (!parsed.FALKORDB_HOST || !parsed.FALKORDB_PASSWORD) {
      throw new Error("FALKORDB_HOST and FALKORDB_PASSWORD are required in production.");
    }
    if (["localhost", "127.0.0.1", "::1"].includes(parsed.FALKORDB_HOST.toLowerCase())) {
      throw new Error("FALKORDB_HOST must point to the production graph service, not localhost.");
    }
    if (!parsed.FP_SALT || parsed.FP_SALT.length < 32 || parsed.FP_SALT === "stackfox-fp-v1-change-in-production") {
      throw new Error("FP_SALT (a unique random value of at least 32 characters) is required in production.");
    }
    if (!parsed.OPENAI_API_KEY && !parsed.OPENROUTER_API_KEY) {
      throw new Error("Configure OPENAI_API_KEY or OPENROUTER_API_KEY in production.");
    }
    for (const [name, value] of [["CLIENT_URL", parsed.CLIENT_URL], ["API_PUBLIC_URL", parsed.API_PUBLIC_URL]] as const) {
      if (!value) throw new Error(`${name} is required in production.`);
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`${name} must be a valid HTTPS URL in production.`);
      }
      if (url.protocol !== "https:" || url.username || url.password) {
        throw new Error(`${name} must be a valid HTTPS URL without credentials in production.`);
      }
    }
  }
  return parsed;
}

export const env = createEnv(process.env);

export function getGoogleOAuthConfig() {
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET?.trim(),
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI?.trim(),
  };
}

export function isGoogleOAuthConfigured() {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  return !!(clientId && clientSecret && redirectUri);
}

export function isResendConfigured() {
  return !!env.RESEND_API_KEY;
}
