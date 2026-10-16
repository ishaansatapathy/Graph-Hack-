import crypto from "node:crypto";

import * as workspaceDb from "./db";

const { sqlite } = workspaceDb;

export function recordAudit(
  workspaceId: string,
  actorUserId: string,
  action: string,
  toolId: string | null = null,
  detail = "",
) {
  sqlite
    .prepare(
      `INSERT INTO audit_events (id, workspace_id, actor_user_id, action, tool_id, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(crypto.randomUUID(), workspaceId, actorUserId, action, toolId, detail.slice(0, 500), new Date().toISOString());
}
