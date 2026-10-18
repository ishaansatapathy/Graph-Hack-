import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./packages/services/src/db/schema.ts",
  out: "./packages/services/src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: false,
});
