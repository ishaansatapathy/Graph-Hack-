/**
 * Agent memory: sliding-window conversation history — Neon/PostgreSQL.
 *
 * Each "thread" (workspace + user) keeps the last N turns so the AI agent
 * has cross-request context without blowing a token limit.
 *
 * All functions are now async (Drizzle/Neon instead of SQLite).
 */

import crypto from "node:crypto";

import { and, asc, desc, eq, notInArray } from "drizzle-orm";

import { db, schema } from "../db/client";
import { redactSecrets } from "./redact";

/** Maximum message pairs (user+assistant) retained per thread. */
const MAX_TURNS = 20;
/** Maximum bytes stored per single message content field. */
const MAX_CONTENT_BYTES = 8000;

export type MemoryRole = "user" | "assistant" | "system";

export type MemoryMessage = {
  id: string;
  role: MemoryRole;
  content: string;
  createdAt: string;
};

// ── Write ─────────────────────────────────────────────────────────────────────

export async function appendMessage(
  workspaceId: string,
  userId: string,
  role: MemoryRole,
  content: string,
): Promise<MemoryMessage> {
  const id = crypto.randomUUID();
  const truncated = redactSecrets(content).slice(0, MAX_CONTENT_BYTES);

  await db.insert(schema.agentMemory).values({
    id,
    workspaceId,
    userId,
    role,
    content: truncated,
  });

  // Prune beyond window (non-blocking)
  void pruneThread(workspaceId, userId);

  return { id, role, content: truncated, createdAt: new Date().toISOString() };
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getThread(workspaceId: string, userId: string): Promise<MemoryMessage[]> {
  const rows = await db.select()
    .from(schema.agentMemory)
    .where(and(eq(schema.agentMemory.workspaceId, workspaceId), eq(schema.agentMemory.userId, userId)))
    .orderBy(asc(schema.agentMemory.createdAt))
    .limit(MAX_TURNS * 2 + 2);

  return rows.map((r) => ({
    id: r.id,
    role: r.role as MemoryRole,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function clearThread(workspaceId: string, userId: string): Promise<number> {
  const deleted = await db.delete(schema.agentMemory)
    .where(and(eq(schema.agentMemory.workspaceId, workspaceId), eq(schema.agentMemory.userId, userId)))
    .returning({ id: schema.agentMemory.id });
  return deleted.length;
}

// ── Prune ─────────────────────────────────────────────────────────────────────

async function pruneThread(workspaceId: string, userId: string): Promise<void> {
  const keep = MAX_TURNS * 2;

  // Get IDs to keep (most recent N)
  const keepers = await db.select({ id: schema.agentMemory.id })
    .from(schema.agentMemory)
    .where(and(eq(schema.agentMemory.workspaceId, workspaceId), eq(schema.agentMemory.userId, userId)))
    .orderBy(desc(schema.agentMemory.createdAt))
    .limit(keep);

  if (keepers.length < keep) return; // Nothing to prune

  const keepIds = keepers.map((r) => r.id);
  await db.delete(schema.agentMemory)
    .where(and(
      eq(schema.agentMemory.workspaceId, workspaceId),
      eq(schema.agentMemory.userId, userId),
      notInArray(schema.agentMemory.id, keepIds),
    ));
}
