import crypto from "node:crypto";

import { db, schema } from "../db/client";
import { childLogger } from "../logger";

const log = childLogger("audit");

export function recordAudit(
  workspaceId: string,
  actorUserId: string,
  action: string,
  toolId: string | null = null,
  detail = "",
): void {
  // Fire-and-forget — audit logging should never block a user action
  db.insert(schema.auditEvents).values({
    id: crypto.randomUUID(),
    workspaceId,
    actorUserId,
    action,
    toolId: toolId ?? undefined,
    detail: detail.slice(0, 500),
  }).catch((err: unknown) => {
    log.warn({ err, action, workspaceId }, "Audit log insert failed (non-fatal)");
  });
}
