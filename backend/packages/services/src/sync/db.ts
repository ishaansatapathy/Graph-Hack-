/**
 * Sync run tracking — Neon/PostgreSQL via Drizzle.
 * Replaces the old SQLite sync_runs table.
 * Public API is identical so callers don't change.
 */

import crypto from "node:crypto";

import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db, schema } from "../db/client";
import { UserError } from "../errors";

export type SyncRun = {
  id: string;
  provider: string;
  status: "queued" | "running" | "ok" | "error";
  items: number;
  message: string;
  startedAt: string;
  finishedAt: string | null;
};

function rowToSyncRun(r: typeof schema.syncRuns.$inferSelect): SyncRun {
  return {
    id: r.id,
    provider: r.provider,
    status: r.status as SyncRun["status"],
    items: r.items,
    message: r.message,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

// ── Async API ─────────────────────────────────────────────────────────────────

export async function startRunAsync(workspaceId: string, provider: string): Promise<string> {
  const id = crypto.randomUUID();
  await recoverExpiredRunsAsync();
  try {
    await db.insert(schema.syncRuns).values({ id, workspaceId, provider, status: "queued" });
  } catch (error) {
    const dbError = error as { code?: string; cause?: { code?: string } };
    if (dbError.code === "23505" || dbError.cause?.code === "23505") {
      throw new UserError(`A ${provider} sync is already queued or running. Please wait for it to finish.`, "CONFLICT");
    }
    throw error;
  }
  return id;
}

export async function finishRunAsync(
  id: string,
  attempt: number,
  status: "ok" | "error",
  items: number,
  message: string,
): Promise<boolean> {
  const rows = await db.update(schema.syncRuns)
    .set({ status, items, message: message.slice(0, 400), finishedAt: new Date() })
    .where(and(
      eq(schema.syncRuns.id, id),
      eq(schema.syncRuns.status, "running"),
      eq(schema.syncRuns.attempts, attempt),
    )).returning({ id: schema.syncRuns.id });
  return rows.length > 0;
}

export async function heartbeatRunAsync(id: string, attempt: number): Promise<boolean> {
  const rows = await db.update(schema.syncRuns)
    .set({ heartbeatAt: new Date() })
    .where(and(
      eq(schema.syncRuns.id, id),
      eq(schema.syncRuns.status, "running"),
      eq(schema.syncRuns.attempts, attempt),
    )).returning({ id: schema.syncRuns.id });
  return rows.length > 0;
}

export async function recoverExpiredRunsAsync(leaseMs = 120_000, maxAttempts = 3): Promise<number> {
  const cutoff = new Date(Date.now() - leaseMs);
  await db.update(schema.syncRuns)
    .set({ status: "error", message: "Sync worker lease expired after maximum retry attempts", finishedAt: new Date() })
    .where(and(
      eq(schema.syncRuns.status, "running"),
      lt(schema.syncRuns.heartbeatAt, cutoff),
      gte(schema.syncRuns.attempts, maxAttempts),
    ));
  const requeued = await db.update(schema.syncRuns)
    .set({ status: "queued", heartbeatAt: null, message: "Requeued after worker lease expired" })
    .where(and(
      eq(schema.syncRuns.status, "running"),
      lt(schema.syncRuns.heartbeatAt, cutoff),
      lt(schema.syncRuns.attempts, maxAttempts),
    )).returning({ id: schema.syncRuns.id });
  return requeued.length;
}

export async function claimNextRunAsync(): Promise<{ id: string; workspaceId: string; provider: string; attempt: number } | null> {
  return await db.transaction(async (tx) => {
    const [queued] = await tx.select({
      id: schema.syncRuns.id,
      workspaceId: schema.syncRuns.workspaceId,
      provider: schema.syncRuns.provider,
    }).from(schema.syncRuns)
      .where(eq(schema.syncRuns.status, "queued"))
      .orderBy(schema.syncRuns.startedAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!queued) return null;

    const [claimed] = await tx.update(schema.syncRuns)
      .set({
        status: "running",
        startedAt: new Date(),
        heartbeatAt: new Date(),
        attempts: sql`${schema.syncRuns.attempts} + 1`,
        message: "Sync worker claimed job",
      })
      .where(and(eq(schema.syncRuns.id, queued.id), eq(schema.syncRuns.status, "queued")))
      .returning({
        id: schema.syncRuns.id,
        workspaceId: schema.syncRuns.workspaceId,
        provider: schema.syncRuns.provider,
        attempt: schema.syncRuns.attempts,
      });
    return claimed ?? null;
  });
}

export async function isRunningAsync(workspaceId: string, provider: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.syncRuns.id })
    .from(schema.syncRuns)
    .where(and(
      eq(schema.syncRuns.workspaceId, workspaceId),
      eq(schema.syncRuns.provider, provider),
      inArray(schema.syncRuns.status, ["queued", "running"]),
    ))
    .limit(1);
  return Boolean(row);
}

export async function listRunsAsync(workspaceId: string, limit = 15): Promise<SyncRun[]> {
  const rows = await db.select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.workspaceId, workspaceId))
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(limit);
  return rows.map(rowToSyncRun);
}

// ── Sync-compat object (same shape as old syncDb export) ─────────────────────

export const syncDb = {
  startRun: startRunAsync,
  finishRun: finishRunAsync,
  heartbeatRun: heartbeatRunAsync,
  recoverExpiredRuns: recoverExpiredRunsAsync,
  isRunning: isRunningAsync,
  claimNextRun: claimNextRunAsync,
  listRuns: listRunsAsync,
};
