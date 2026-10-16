import crypto from "node:crypto";

import { findUserByEmail, findUserById } from "../db";
import { recordAudit } from "./audit";
import * as workspaceDb from "./db";

const { sqlite } = workspaceDb;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS workspace_invites (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    invited_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    accepted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS user_active_workspace (
    user_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL
  );
`);

export type MemberRole = "owner" | "admin" | "member";

function roleOf(workspaceId: string, userId: string): MemberRole {
  const role = workspaceDb.getMemberRole(workspaceId, userId);
  if (!role) throw new Error("Workspace not found or access denied");
  return role === "owner" || role === "admin" ? role : "member";
}

function assertAdmin(workspaceId: string, userId: string) {
  const role = roleOf(workspaceId, userId);
  if (role === "member") throw new Error("Only workspace owners and admins can do this");
  return role;
}

export function listMembers(workspaceId: string, userId: string) {
  roleOf(workspaceId, userId);
  const rows = sqlite
    .prepare("SELECT user_id, role, created_at FROM workspace_members WHERE workspace_id = ? ORDER BY created_at ASC")
    .all(workspaceId) as { user_id: string; role: string; created_at: string }[];

  const members = rows.map((r) => {
    const user = findUserById(r.user_id);
    return {
      userId: r.user_id,
      name: user?.display_name || user?.full_name || "Unknown",
      email: user?.email ?? "",
      role: (r.role === "owner" || r.role === "admin" ? r.role : "member") as MemberRole,
      joinedAt: r.created_at,
    };
  });

  const invites = sqlite
    .prepare(
      "SELECT id, email, role, created_at FROM workspace_invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC",
    )
    .all(workspaceId) as { id: string; email: string; role: string; created_at: string }[];

  return {
    members,
    invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at })),
  };
}

export function inviteMember(workspaceId: string, actorId: string, emailRaw: string, role: "admin" | "member") {
  assertAdmin(workspaceId, actorId);
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Enter a valid email");

  const user = findUserByEmail(email);
  if (user) {
    if (workspaceDb.getMemberRole(workspaceId, user.id)) throw new Error("Already a member of this workspace");
    workspaceDb.insertWorkspaceMember({ workspace_id: workspaceId, user_id: user.id, role });
    recordAudit(workspaceId, actorId, "member.added", null, `${email} as ${role}`);
    return { status: "added" as const, message: `${email} added as ${role}` };
  }

  const existing = sqlite
    .prepare("SELECT id FROM workspace_invites WHERE workspace_id = ? AND email = ? AND accepted_at IS NULL")
    .get(workspaceId, email);
  if (existing) throw new Error("An invite is already pending for this email");

  sqlite
    .prepare(
      "INSERT INTO workspace_invites (id, workspace_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(crypto.randomUUID(), workspaceId, email, role, actorId, new Date().toISOString());
  recordAudit(workspaceId, actorId, "member.invited", null, `${email} as ${role}`);
  return { status: "invited" as const, message: `Invite saved — ${email} joins when they sign in` };
}

export function cancelInvite(workspaceId: string, actorId: string, inviteId: string) {
  assertAdmin(workspaceId, actorId);
  sqlite.prepare("DELETE FROM workspace_invites WHERE id = ? AND workspace_id = ?").run(inviteId, workspaceId);
  recordAudit(workspaceId, actorId, "member.invite_cancelled", null, inviteId);
  return { ok: true };
}

/** Called on sign-in: turns pending email invites into memberships and lands the user in that workspace. */
export function acceptPendingInvites(userId: string, email: string) {
  const invites = sqlite
    .prepare("SELECT id, workspace_id, role FROM workspace_invites WHERE lower(email) = ? AND accepted_at IS NULL")
    .all(email.toLowerCase()) as { id: string; workspace_id: string; role: string }[];

  for (const inv of invites) {
    if (!workspaceDb.getMemberRole(inv.workspace_id, userId)) {
      workspaceDb.insertWorkspaceMember({ workspace_id: inv.workspace_id, user_id: userId, role: inv.role });
    }
    sqlite.prepare("UPDATE workspace_invites SET accepted_at = ? WHERE id = ?").run(new Date().toISOString(), inv.id);
    setActiveWorkspace(userId, inv.workspace_id);
    recordAudit(inv.workspace_id, userId, "member.joined", null, email);
  }
}

export function setMemberRole(workspaceId: string, actorId: string, targetUserId: string, role: "admin" | "member") {
  const actorRole = assertAdmin(workspaceId, actorId);
  const targetRole = roleOf(workspaceId, targetUserId);
  if (targetRole === "owner") throw new Error("The owner's role cannot be changed");
  if (actorRole !== "owner") throw new Error("Only the owner can change roles");
  sqlite
    .prepare("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?")
    .run(role, workspaceId, targetUserId);
  recordAudit(workspaceId, actorId, "member.role_changed", null, `${targetUserId} -> ${role}`);
  return { ok: true };
}

export function removeMember(workspaceId: string, actorId: string, targetUserId: string) {
  const targetRole = roleOf(workspaceId, targetUserId);
  if (targetRole === "owner") throw new Error("The owner cannot be removed");
  if (targetUserId !== actorId) assertAdmin(workspaceId, actorId);
  sqlite.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?").run(workspaceId, targetUserId);
  sqlite
    .prepare("DELETE FROM user_active_workspace WHERE user_id = ? AND workspace_id = ?")
    .run(targetUserId, workspaceId);
  recordAudit(workspaceId, actorId, "member.removed", null, targetUserId);
  return { ok: true };
}

export function listWorkspacesForUser(userId: string) {
  return sqlite
    .prepare(
      `SELECT w.id, w.name, w.slug, m.role FROM workspaces w
       INNER JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ? ORDER BY w.created_at ASC`,
    )
    .all(userId) as { id: string; name: string; slug: string; role: string }[];
}

export function setActiveWorkspace(userId: string, workspaceId: string) {
  roleOf(workspaceId, userId);
  sqlite
    .prepare(
      `INSERT INTO user_active_workspace (user_id, workspace_id) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET workspace_id = excluded.workspace_id`,
    )
    .run(userId, workspaceId);
}

export function resolveActiveWorkspaceId(userId: string): string | null {
  const row = sqlite.prepare("SELECT workspace_id FROM user_active_workspace WHERE user_id = ?").get(userId) as
    | { workspace_id: string }
    | undefined;
  if (!row) return null;
  return workspaceDb.getMemberRole(row.workspace_id, userId) ? row.workspace_id : null;
}
