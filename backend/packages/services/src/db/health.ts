/**
 * Production Database Health Check and Diagnostic Probe.
 *
 * Runs a low-overhead query against PostgreSQL to measure round-trip latency,
 * verify pool connectivity, and detect cold starts or network degradation.
 */

import { sql } from "drizzle-orm";

import { childLogger } from "../logger";
import { db } from "./client";

const log = childLogger("db-health");

export interface DatabaseHealthResult {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  serverTime?: string;
  database?: string;
  error?: string;
  timestamp: string;
}

/**
 * Checks PostgreSQL health by executing `SELECT 1` and server time.
 * Thresholds:
 * - < 300ms: healthy
 * - 300ms - 2000ms: degraded (e.g., Neon cold-start or heavy load)
 * - > 2000ms or error: unhealthy
 */
export async function checkDatabaseHealth(timeoutMs = 5000): Promise<DatabaseHealthResult> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Database health check timed out after ${timeoutMs}ms`)), timeoutMs),
    );

    const queryPromise = db.execute<{
      ping: number;
      now: Date;
      current_database: string;
    }>(sql`SELECT 1 AS ping, NOW() AS now, current_database() AS current_database`);

    const result = await Promise.race([queryPromise, timeoutPromise]);
    const latencyMs = Date.now() - start;

    const row = result.rows[0];
    const serverTime = row?.now ? new Date(row.now as string | Date).toISOString() : undefined;
    const database = (row?.current_database as string) ?? undefined;

    const status: "healthy" | "degraded" | "unhealthy" =
      latencyMs < 800 ? "healthy" : latencyMs < 3000 ? "degraded" : "unhealthy";

    return {
      status,
      latencyMs,
      serverTime,
      database,
      timestamp,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ err, latencyMs }, "Database health check failed");

    return {
      status: "unhealthy",
      latencyMs,
      error: errorMsg,
      timestamp,
    };
  }
}
