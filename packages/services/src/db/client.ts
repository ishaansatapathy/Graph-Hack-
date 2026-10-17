/**
 * Drizzle + Neon PostgreSQL client with connection pooling, interactive transactions,
 * exponential backoff retry for transient network dropouts, and health monitoring.
 *
 * Uses @neondatabase/serverless with WebSockets for true ACID transactions
 * and sub-millisecond query reuse across requests.
 *
 * Usage:
 *   import { db, withDbRetry } from "./client";
 *   const rows = await db.select().from(users).where(eq(users.email, "..."));
 *   await db.transaction(async (tx) => { ... });
 */

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { childLogger } from "../logger";
import { classifyDbError } from "./errors";
import { checkDatabaseHealth } from "./health";
import * as schema from "./schema";

const log = childLogger("db-client");

// Configure WebSocket transport for Node.js environments
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

// Lazy singletons
let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 20,                          // Connection pool cap for serverless compute
      idleTimeoutMillis: 30000,         // Close idle clients after 30s
      connectionTimeoutMillis: 10000,   // Neon cold-start connection timeout
    });

    _pool.on("error", (err: unknown) => {
      log.error({ err }, "Unexpected error on idle PostgreSQL pool client");
    });
  }
  return _pool;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) {
    const pool = getPool();
    _db = drizzle(pool, {
      schema,
      logger: process.env.NODE_ENV === "development" && process.env.DEBUG_SQL === "true",
    });
  }
  return _db;
}

/** Shorthand Drizzle client proxy — use this in all service files */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * Executes a database operation with exponential backoff retry for transient network
 * glitches or Neon cold-start connection drops. Non-transient errors fail immediately.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; initialDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 150;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err) {
      attempt++;
      const classified = classifyDbError(err);
      if (!classified.isTransient || attempt >= maxRetries) {
        throw err;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
      log.warn({ attempt, delay, err }, "Transient DB error encountered — retrying");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Gracefully drain and close the connection pool upon process termination.
 */
export async function closeDbPool(): Promise<void> {
  if (_pool) {
    try {
      await _pool.end();
      log.info("Database connection pool closed cleanly");
    } catch (err) {
      log.warn({ err }, "Error closing database connection pool");
    } finally {
      _pool = null;
      _db = null;
    }
  }
}

// Hook into Node.js process signals for clean shutdown
if (typeof process !== "undefined" && typeof process.once === "function") {
  process.once("SIGTERM", () => { void closeDbPool(); });
  process.once("SIGINT", () => { void closeDbPool(); });
}

export { schema, checkDatabaseHealth };
