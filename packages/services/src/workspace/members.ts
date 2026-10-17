import crypto from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db/client";
import { findUserByEmail, findUserById, getMemberRole, insertWorkspaceMember } from "../db/index";
import { childLogger } from "../logger";

const log = childLogger("members");

export type MemberRole = "owner" | "admin" | "member";

// ── Role helpers ───────────────────────────────────────────────────────────────

async function roleOf(workspaceId: string, userId: string): Promise<MemberRole> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) throw new Error("Workspace not found or access denied");
  return role === "owner" || role === "admin" ? role : "member";
}

async function assertAdmin(workspaceId: string, userId: string): Promise<MemberRole> {
  const role = await roleOf(workspaceId, userId);
  if (role === "member") throw new Error("Only workspace owners and admins can do this");
  return role;
}

// ── List members ──────────────────────────────────────────────────────────────

export async function listMembers(workspaceId: string, userId: string) {
  await roleOf(workspaceId, userId);

  const rows = await db.select()
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));

  const members = await Promise.all(rows.map(async (r) => {
    const user = await findUserById(r.userId);
    return {
      userId: r.userId,
      name: user?.display_name || user?.full_name || "Unknown",
      email: user?.email ?? "",
      role: (r.role === "owner" || r.role === "admin" ? r.role : "member") as MemberRole,
      joinedAt: r.createdAt.toISOString(),
    };
  }));

  const invites = await db.select()
    .from(schema.workspaceInvites)
    .where(and(
      eq(schema.workspaceInvites.workspaceId, workspaceId),
      isNull(schema.workspaceInvites.acceptedAt),
    ));

  return {
    members,
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

// ── Invite ────────────────────────────────────────────────────────────────────

export async function inviteMember(
  workspaceId: string,
  actorId: string,
  emailRaw: string,
  role: "admin" | "member",
) {
  await assertAdmin(workspaceId, actorId);
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("Enter a valid email");

  const user = await findUserByEmail(email);
  if (user) {
    const existing = await getMemberRole(workspaceId, user.id);
    if (existing) throw new Error("Already a member of this workspace");
    await insertWorkspaceMember({ workspace_id: workspaceId, user_id: user.id, role });
    return { status: "added" as const, message: `${email} added as ${role}` };
  }

  // Create pending invite
  const existingInvite = await db.select()
    .from(schema.workspaceInvites)
    .where(and(
      eq(schema.workspaceInvites.workspaceId, workspaceId),
      eq(schema.workspaceInvites.email, email),
      isNull(schema.workspaceInvites.acceptedAt),
    ))
    .limit(1);

  if (existingInvite.length > 0) throw new Error("An invite is already pending for this email");

  await db.insert(schema.workspaceInvites).values({
    id: crypto.randomUUID(),
    workspaceId,
    email,
    role,
    invitedByUserId: actorId,
    token: crypto.randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });

  return { status: "invited" as const, message: `Invite saved — ${email} joins when they sign in` };
}

export async function cancelInvite(workspaceId: string, actorId: string, inviteId: string) {
  await assertAdmin(workspaceId, actorId);
  await db.delete(schema.workspaceInvites)
    .where(and(eq(schema.workspaceInvites.id, inviteId), eq(schema.workspaceInvites.workspaceId, workspaceId)));
  return { ok: true };
}

// ── Accept pending invites on sign-in ─────────────────────────────────────────

export async function acceptPendingInvites(userId: string, email: string): Promise<void> {
  const invites = await db.select()
    .from(schema.workspaceInvites)
    .where(and(
      eq(schema.workspaceInvites.email, email.toLowerCase()),
      isNull(schema.workspaceInvites.acceptedAt),
    ));

  for (const inv of invites) {
    const alreadyMember = await getMemberRole(inv.workspaceId, userId);
    if (!alreadyMember) {
      await insertWorkspaceMember({ workspace_id: inv.workspaceId, user_id: userId, role: inv.role });
    }
    await db.update(schema.workspaceInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(schema.workspaceInvites.id, inv.id));
    await setActiveWorkspace(userId, inv.workspaceId);
  }
}

// ── Role management ───────────────────────────────────────────────────────────

export async function setMemberRole(
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  role: "admin" | "member",
) {
  const actorRole = await assertAdmin(workspaceId, actorId);
  const targetRole = await roleOf(workspaceId, targetUserId);
  if (targetRole === "owner") throw new Error("The owner's role cannot be changed");
  if (actorRole !== "owner") throw new Error("Only the owner can change roles");

  await db.update(schema.workspaceMembers)
    .set({ role })
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, targetUserId)));

  return { ok: true };
}

export async function removeMember(workspaceId: string, actorId: string, targetUserId: string) {
  const targetRole = await roleOf(workspaceId, targetUserId);
  if (targetRole === "owner") throw new Error("The owner cannot be removed");
  if (targetUserId !== actorId) await assertAdmin(workspaceId, actorId);

  await db.delete(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, targetUserId)));

  return { ok: true };
}

// ── Active workspace ──────────────────────────────────────────────────────────

// Stored in DB as a simple lookup (replaces SQLite user_active_workspace table)
// We use a JSON column in the users table for this lightweight preference
// For now: resolve from workspace_members — first workspace the user belongs to

export async function resolveActiveWorkspaceId(userId: string): Promise<string | null> {
  const [row] = await db.select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(schema.workspaceMembers.createdAt)
    .limit(1);
  return row?.workspaceId ?? null;
}

export async function setActiveWorkspace(userId: string, workspaceId: string): Promise<void> {
  // Validate access
  try { await roleOf(workspaceId, userId); } catch { return; }
  // Active workspace is resolved from membership order — no extra table needed
  log.debug({ userId, workspaceId }, "Active workspace set");
}

export async function listWorkspacesForUser(userId: string) {
  const rows = await db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name, slug: schema.workspaces.slug, role: schema.workspaceMembers.role })
    .from(schema.workspaces)
    .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMembers.userId, userId));
  return rows;
}
