/**
 * Production Database Housekeeping & Data Retention Policy.
 *
 * Runs scheduled or on-demand cleanups to:
 * 1. Prune expired device rate-limit quota buckets.
 * 2. Prune expired, unaccepted workspace invitation tokens.
 * 3. Mark stale sync runs (>15 minutes in "running" status) as timed out.
 * 4. Archive or clean up old transient audit/debug data.
 */

import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { childLogger } from "../logger";
import { db } from "./client";
import { deviceQuota, githubWebhookDeliveries, syncRuns, workspaceInvites } from "./schema";

const log = childLogger("db-housekeeping");

export interface HousekeepingReport {
  timestamp: string;
  durationMs: number;
  prunedDeviceQuotas: number;
  prunedExpiredInvites: number;
  reapedStaleSyncRuns: number;
  prunedGithubWebhookDeliveries: number;
  success: boolean;
  error?: string;
}

/**
 * 1. Prune device quota records older than `daysToKeep` (default: 7 days).
 */
export async function pruneExpiredDeviceQuotas(daysToKeep = 7): Promise<number> {
  const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

  const deleted = await db
    .delete(deviceQuota)
    .where(sql`${deviceQuota.windowStart} < ${cutoffStr}`)
    .returning({ fpHash: deviceQuota.fpHash });

  return deleted.length;
}

/**
 * 2. Prune workspace invites that were never accepted and expired > `daysExpired` ago (default: 14 days).
 */
export async function pruneExpiredInvites(daysExpired = 14): Promise<number> {
  const cutoff = new Date(Date.now() - daysExpired * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(workspaceInvites)
    .where(and(
      isNull(workspaceInvites.acceptedAt),
      lt(workspaceInvites.expiresAt, cutoff),
    ))
    .returning({ id: workspaceInvites.id });

  return deleted.length;
}

/**
 * 3. Reap stale sync runs that have been stuck in "running" status for > `maxAgeMinutes` (default: 15 minutes).
 * This handles worker crashes, network aborts, or server restarts.
 */
export async function reapStaleSyncRuns(maxAgeMinutes = 3): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  const updated = await db
    .update(syncRuns)
    .set({
      status: "error",
      message: "Sync timed out or worker process aborted",
      finishedAt: new Date(),
    })
    .where(and(
      eq(syncRuns.status, "running"),
      lt(syncRuns.heartbeatAt, cutoff),
    ))
    .returning({ id: syncRuns.id });

  return updated.length;
}

export async function pruneOldGithubWebhookDeliveries(daysToKeep = 30): Promise<number> {
  const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
  const removed = await db.delete(githubWebhookDeliveries)
    .where(lt(githubWebhookDeliveries.startedAt, cutoff))
    .returning({ deliveryId: githubWebhookDeliveries.deliveryId });
  return removed.length;
}

/**
 * Master housekeeping runner — runs all retention routines and logs structured summary.
 */
export async function runDatabaseHousekeeping(): Promise<HousekeepingReport> {
  const start = Date.now();
  const timestamp = new Date().toISOString();

  try {
    const [prunedDeviceQuotas, prunedExpiredInvites, reapedStaleSyncRuns, prunedGithubWebhookDeliveries] = await Promise.all([
      pruneExpiredDeviceQuotas(7),
      pruneExpiredInvites(14),
      reapStaleSyncRuns(3),
      pruneOldGithubWebhookDeliveries(30),
    ]);

    const durationMs = Date.now() - start;
    const report: HousekeepingReport = {
      timestamp,
      durationMs,
      prunedDeviceQuotas,
      prunedExpiredInvites,
      reapedStaleSyncRuns,
      prunedGithubWebhookDeliveries,
      success: true,
    };

    log.info(report, "Database housekeeping completed successfully");
    return report;
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    const report: HousekeepingReport = {
      timestamp,
      durationMs,
      prunedDeviceQuotas: 0,
      prunedExpiredInvites: 0,
      reapedStaleSyncRuns: 0,
      prunedGithubWebhookDeliveries: 0,
      success: false,
      error,
    };

    log.error({ err, report }, "Database housekeeping encountered an error");
    return report;
  }
}
