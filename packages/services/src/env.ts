import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

function loadRootEnv() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      config({ path: envPath, override: true });
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
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  return safeParseResult.data;
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
