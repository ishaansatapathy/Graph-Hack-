/**
 * Sync run tracking — Neon/PostgreSQL via Drizzle.
 * Replaces the old SQLite sync_runs table.
 * Public API is identical so callers don't change.
 */

import crypto from "node:crypto";

import { and, desc, eq, gt, sql } from "drizzle-orm";

import { db, schema } from "../db/client";

export type SyncRun = {
  id: string;
  provider: string;
  status: "running" | "ok" | "error";
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
  await db.insert(schema.syncRuns).values({ id, workspaceId, provider, status: "running" });
  return id;
}

export async function finishRunAsync(id: string, status: "ok" | "error", items: number, message: string): Promise<void> {
  await db.update(schema.syncRuns)
    .set({ status, items, message: message.slice(0, 400), finishedAt: new Date() })
    .where(eq(schema.syncRuns.id, id));
}

export async function isRunningAsync(workspaceId: string, provider: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const [row] = await db.select({ id: schema.syncRuns.id })
    .from(schema.syncRuns)
    .where(and(
      eq(schema.syncRuns.workspaceId, workspaceId),
      eq(schema.syncRuns.provider, provider),
      eq(schema.syncRuns.status, "running"),
      gt(schema.syncRuns.startedAt, cutoff),
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
  isRunning: isRunningAsync,
  listRuns: listRunsAsync,
};
