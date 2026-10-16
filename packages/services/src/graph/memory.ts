/**
 * Agent memory: sliding-window conversation history stored in SQLite.
 *
 * Each "thread" (workspace + user) keeps the last N turns so the AI agent
 * has cross-request context without blowing a token limit.
 */

import crypto from "node:crypto";

import { sqlite } from "../workspace/db";

/** Maximum message pairs (user+assistant) retained per thread. */
const MAX_TURNS = 20;
/** Maximum bytes stored per single message content field. */
const MAX_CONTENT_BYTES = 8000;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS agent_memory (
    id          TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS agent_memory_thread
    ON agent_memory (workspace_id, user_id, created_at);
`);

export type MemoryRole = "user" | "assistant" | "system";

export type MemoryMessage = {
  id: string;
  role: MemoryRole;
  content: string;
  createdAt: string;
};

type Row = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

// ---------------------------------------------------------------------------

export function appendMessage(
  workspaceId: string,
  userId: string,
  role: MemoryRole,
  content: string,
): MemoryMessage {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const truncated = content.slice(0, MAX_CONTENT_BYTES);

  sqlite
    .prepare(
      `INSERT INTO agent_memory (id, workspace_id, user_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, userId, role, truncated, createdAt);

  // Prune old messages beyond the window
  pruneThread(workspaceId, userId);

  return { id, role, content: truncated, createdAt };
}

export function getThread(workspaceId: string, userId: string): MemoryMessage[] {
  const rows = sqlite
    .prepare(
      `SELECT id, role, content, created_at
       FROM agent_memory
       WHERE workspace_id = ? AND user_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(workspaceId, userId, MAX_TURNS * 2 + 2) as Row[];

  return rows.map((r) => ({
    id: r.id,
    role: r.role as MemoryRole,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export function clearThread(workspaceId: string, userId: string): number {
  const info = sqlite
    .prepare("DELETE FROM agent_memory WHERE workspace_id = ? AND user_id = ?")
    .run(workspaceId, userId);
  return info.changes;
}

// Keep only the latest MAX_TURNS * 2 rows for this thread
function pruneThread(workspaceId: string, userId: string) {
  const keep = MAX_TURNS * 2;
  sqlite
    .prepare(
      `DELETE FROM agent_memory
       WHERE workspace_id = ? AND user_id = ?
         AND id NOT IN (
           SELECT id FROM agent_memory
           WHERE workspace_id = ? AND user_id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )`,
    )
    .run(workspaceId, userId, workspaceId, userId, keep);
}
