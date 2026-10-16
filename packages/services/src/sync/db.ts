import crypto from "node:crypto";

import { sqlite } from "../workspace/db";

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    items INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
`);

export type SyncRun = {
  id: string;
  provider: string;
  status: "running" | "ok" | "error";
  items: number;
  message: string;
  startedAt: string;
  finishedAt: string | null;
};

type Row = {
  id: string;
  provider: string;
  status: SyncRun["status"];
  items: number;
  message: string;
  started_at: string;
  finished_at: string | null;
};

const toRun = (r: Row): SyncRun => ({
  id: r.id,
  provider: r.provider,
  status: r.status,
  items: r.items,
  message: r.message,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export function startRun(workspaceId: string, provider: string) {
  const id = crypto.randomUUID();
  sqlite
    .prepare("INSERT INTO sync_runs (id, workspace_id, provider, status, started_at) VALUES (?, ?, ?, 'running', ?)")
    .run(id, workspaceId, provider, new Date().toISOString());
  return id;
}

export function finishRun(id: string, status: "ok" | "error", items: number, message: string) {
  sqlite
    .prepare("UPDATE sync_runs SET status = ?, items = ?, message = ?, finished_at = ? WHERE id = ?")
    .run(status, items, message.slice(0, 400), new Date().toISOString(), id);
}

export function isRunning(workspaceId: string, provider: string) {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const row = sqlite
    .prepare("SELECT 1 FROM sync_runs WHERE workspace_id = ? AND provider = ? AND status = 'running' AND started_at > ?")
    .get(workspaceId, provider, cutoff);
  return Boolean(row);
}

export function listRuns(workspaceId: string, limit = 15): SyncRun[] {
  return (
    sqlite
      .prepare("SELECT * FROM sync_runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(workspaceId, limit) as Row[]
  ).map(toRun);
}
