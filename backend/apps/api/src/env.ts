import { z } from "zod";

function normalizeEnvUrl(value: string) {
  return value.trim().replace(/^["']+|["']+$/g, "").replace(/\/$/, "");
}

const envSchema = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.enum(["development", "prod", "production", "test"]).default("development"),
  CLIENT_URL: z.string().default("http://localhost:3000"),
});

function createEnv(env: NodeJS.ProcessEnv) {
  const safeParseResult = envSchema.safeParse(env);
  if (!safeParseResult.success) throw new Error(safeParseResult.error.message);
  const data = safeParseResult.data;
  return {
    ...data,
    CLIENT_URL: normalizeEnvUrl(data.CLIENT_URL),
  };
}

export const env = createEnv(process.env);
