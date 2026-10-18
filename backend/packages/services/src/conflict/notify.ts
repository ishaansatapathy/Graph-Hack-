/**
 * Conflict email notifications.
 *
 * After new activity is ingested we re-run conflict detection and email
 * workspace owners/admins about conflicts we have not notified about before.
 * The (workspace_id, conflict_key) primary key in `conflict_notifications`
 * guarantees each conflict is announced exactly once, even under concurrency.
 */

import { eq } from "drizzle-orm";

import { db, schema } from "../db/client";
import { sendConflictNotificationEmail } from "../email";
import { isResendConfigured } from "../env";
import { childLogger } from "../logger";
import { detectConflicts } from "./detect";

const log = childLogger("conflict-notify");

const MAX_EMAILS_PER_RUN = 5;

export async function notifyNewConflicts(workspaceId: string, detectedBy: string): Promise<number> {
  if (!isResendConfigured()) return 0;

  try {
    const conflicts = (await detectConflicts(workspaceId)).filter((c) => c.status === "open");
    if (conflicts.length === 0) return 0;

    const [workspace] = await db
      .select({ name: schema.workspaces.name })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) return 0;

    const recipients = await db
      .select({
        email: schema.users.email,
        name: schema.users.displayName,
        fullName: schema.users.fullName,
        role: schema.workspaceMembers.role,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId));

    const admins = recipients.filter((r) => r.role === "owner" || r.role === "admin");
    if (admins.length === 0) return 0;

    let sent = 0;
    for (const c of conflicts) {
      if (sent >= MAX_EMAILS_PER_RUN) break;

      const key = `${c.file}::${c.commitShaA}::${c.commitShaB}`;
      const inserted = await db
        .insert(schema.conflictNotifications)
        .values({ workspaceId, conflictKey: key })
        .onConflictDoNothing()
        .returning({ key: schema.conflictNotifications.conflictKey });
      if (inserted.length === 0) continue; // already notified

      await Promise.all(
        admins.map((a) =>
          sendConflictNotificationEmail({
            to: a.email,
            recipientName: a.name || a.fullName || a.email,
            file: c.file,
            workspaceName: workspace.name,
            workspaceId,
            detectedBy: detectedBy || c.authorB || c.authorA || "a teammate",
          }),
        ),
      );
      sent++;
    }

    if (sent > 0) log.info({ workspaceId, sent }, "Conflict notifications sent");
    return sent;
  } catch (err) {
    log.error({ err, workspaceId }, "notifyNewConflicts failed");
    return 0;
  }
}
