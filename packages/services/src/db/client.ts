/**
 * Drizzle + Neon PostgreSQL client.
 *
 * Uses @neondatabase/serverless (HTTP-based, works in Node + Edge).
 * Falls back to a local Postgres URL for development.
 *
 * Usage:
 *   import { db } from "./client";
 *   const rows = await db.select().from(users).where(eq(users.email, "..."));
 */

import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import ws from "ws";

import * as schema from "./schema";

// Required for Neon in Node.js environments (not needed in Edge)
neonConfig.webSocketConstructor = ws;

function getDatabaseUrl(): string {
  const url =
    process.env.DATABASE_URL ??
    process.env.NEON_DATABASE_URL ??
    process.env.POSTGRES_URL;

  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to your .env file.\n" +
      "Get it from: https://console.neon.tech → Connection Details → Connection string",
    );
  }

  return url;
}

// Lazy singleton — only connects when first used
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const sql = neon(getDatabaseUrl());
    _db = drizzle(sql, { schema, logger: process.env.NODE_ENV === "development" });
  }
  return _db;
}

/** Shorthand — use this in all service files */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export { schema };
