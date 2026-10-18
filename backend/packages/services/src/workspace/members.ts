import crypto from "node:crypto";

import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db, schema } from "../db/client";
import { findUserByEmail, findUserById, getMemberRole, insertWorkspaceMember } from "../db/index";
import { sendInviteEmail, sendMemberJoinedEmail } from "../email";
import { UserError } from "../errors";
import { childLogger } from "../logger";
import { recordAudit } from "./audit";

const log = childLogger("members");

export type MemberRole = "owner" | "admin" | "member";

// ── Role helpers ───────────────────────────────────────────────────────────────

async function roleOf(workspaceId: string, userId: string): Promise<MemberRole> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) throw new UserError("Workspace not found or access denied");
  return role === "owner" || role === "admin" ? role : "member";
}

async function assertAdmin(workspaceId: string, userId: string): Promise<MemberRole> {
  const role = await roleOf(workspaceId, userId);
  if (role === "member") throw new UserError("Only workspace owners and admins can do this");
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
  const actorRole = await assertAdmin(workspaceId, actorId);
  if (role === "admin" && actorRole !== "owner") {
    throw new UserError("Only the workspace owner can invite admins", "FORBIDDEN");
  }
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) throw new UserError("Enter a valid email");

  const actor = await findUserById(actorId);
  const actorName = actor?.display_name || actor?.full_name || "A teammate";
  const [ws] = await db.select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  const workspaceName = ws?.name ?? "your workspace";

  const user = await findUserByEmail(email);
  if (user) {
    const existing = await getMemberRole(workspaceId, user.id);
    if (existing) throw new UserError("Already a member of this workspace");
    await insertWorkspaceMember({ workspace_id: workspaceId, user_id: user.id, role });
    recordAudit(workspaceId, actorId, "member.added", null, `${user.id}:${role}`);

    // Notify existing workspace members that someone new joined
    const membersResult = await listMembers(workspaceId, actorId);
    const notifyEmails = membersResult.members
      .filter((m) => m.userId !== user.id && m.email)
      .map((m) => m.email);
    void sendMemberJoinedEmail({
      to: notifyEmails,
      joinerName: user.display_name || user.full_name || email,
      joinerEmail: email,
      workspaceName,
      workspaceId,
      role,
    });

    return { status: "added" as const, message: `${email} added as ${role}` };
  }

  // Purge stale (expired or already-accepted) invites so re-inviting works
  await db.delete(schema.workspaceInvites).where(and(
    eq(schema.workspaceInvites.workspaceId, workspaceId),
    eq(schema.workspaceInvites.email, email),
    or(isNotNull(schema.workspaceInvites.acceptedAt), lt(schema.workspaceInvites.expiresAt, new Date())),
  ));

  // Create pending invite
  const existingInvite = await db.select()
    .from(schema.workspaceInvites)
    .where(and(
      eq(schema.workspaceInvites.workspaceId, workspaceId),
      eq(schema.workspaceInvites.email, email),
      isNull(schema.workspaceInvites.acceptedAt),
    ))
    .limit(1);

  if (existingInvite.length > 0) throw new UserError("An invite is already pending for this email");

  const inviteToken = crypto.randomBytes(32).toString("hex");

  await db.insert(schema.workspaceInvites).values({
    id: crypto.randomUUID(),
    workspaceId,
    email,
    role,
    invitedByUserId: actorId,
    token: inviteToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });
  recordAudit(workspaceId, actorId, "member.invited", null, `${email}:${role}`);

  // Fire-and-forget invite email
  void sendInviteEmail({
    to: email,
    workspaceName,
    inviterName: actorName,
    inviteToken,
    role,
  });

  return { status: "invited" as const, message: `Invite sent to ${email} — expires in 7 days` };
}

export async function cancelInvite(workspaceId: string, actorId: string, inviteId: string) {
  await assertAdmin(workspaceId, actorId);
  await db.delete(schema.workspaceInvites)
    .where(and(eq(schema.workspaceInvites.id, inviteId), eq(schema.workspaceInvites.workspaceId, workspaceId)));
  return { ok: true };
}

// ── Invite by token (email link flow) ─────────────────────────────────────────

export type InviteDetails = {
  workspaceName: string;
  inviterName: string;
  role: MemberRole;
  email: string;
  expiresAt: string;
};

async function findOpenInvite(token: string) {
  const [inv] = await db.select()
    .from(schema.workspaceInvites)
    .where(and(
      eq(schema.workspaceInvites.token, token),
      isNull(schema.workspaceInvites.acceptedAt),
      gt(schema.workspaceInvites.expiresAt, new Date()),
    ))
    .limit(1);
  return inv ?? null;
}

/** Public lookup — the 256-bit token is the credential. */
export async function getInviteByToken(token: string): Promise<InviteDetails> {
  const inv = await findOpenInvite(token);
  if (!inv) throw new UserError("This invite is invalid, expired, or already used");

  const [ws] = await db.select({ name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, inv.workspaceId))
    .limit(1);
  const inviter = await findUserById(inv.invitedByUserId);

  return {
    workspaceName: ws?.name ?? "a workspace",
    inviterName: inviter?.display_name || inviter?.full_name || "A teammate",
    role: inv.role === "admin" ? "admin" : "member",
    email: inv.email,
    expiresAt: inv.expiresAt.toISOString(),
  };
}

/** Accept an invite as the signed-in user. The user's email must match the invite. */
export async function acceptInviteByToken(token: string, userId: string, userEmail: string) {
  return await db.transaction(async (tx) => {
    const [inv] = await tx.select()
      .from(schema.workspaceInvites)
      .where(and(
        eq(schema.workspaceInvites.token, token),
        isNull(schema.workspaceInvites.acceptedAt),
        gt(schema.workspaceInvites.expiresAt, new Date()),
      ))
      .limit(1);

    if (!inv) throw new UserError("This invite is invalid, expired, or already used");
    if (inv.email.toLowerCase() !== userEmail.trim().toLowerCase()) {
      throw new UserError(`This invite was sent to ${inv.email}. Sign in with that account to accept it.`);
    }

    // Atomic conditional claim to prevent double-accept under concurrent requests
    const claimed = await tx.update(schema.workspaceInvites)
      .set({ acceptedAt: new Date() })
      .where(and(eq(schema.workspaceInvites.id, inv.id), isNull(schema.workspaceInvites.acceptedAt)))
      .returning({ id: schema.workspaceInvites.id });

    if (claimed.length === 0) throw new UserError("This invite is invalid, expired, or already used");

    // Ensure member record exists
    await tx.insert(schema.workspaceMembers).values({
      workspaceId: inv.workspaceId,
      userId,
      role: inv.role,
    }).onConflictDoNothing();

    // Point user's active workspace to newly joined workspace
    await tx.update(schema.users)
      .set({ activeWorkspaceId: inv.workspaceId, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));

    // Audit log
    await tx.insert(schema.auditEvents).values({
      id: crypto.randomUUID(),
      workspaceId: inv.workspaceId,
      actorUserId: userId,
      action: "member.invite_accepted",
      detail: `Accepted invitation as ${inv.role}`,
    });

    log.info({ workspaceId: inv.workspaceId, userId }, "Invite accepted atomically");
    return { workspaceId: inv.workspaceId };
  });
}

// ── Accept pending invites on sign-in ─────────────────────────────────────────

export async function acceptPendingInvites(userId: string, email: string): Promise<void> {
  const invites = await db.select()
    .from(schema.workspaceInvites)
    .where(and(
      eq(schema.workspaceInvites.email, email.toLowerCase()),
      isNull(schema.workspaceInvites.acceptedAt),
      gt(schema.workspaceInvites.expiresAt, new Date()),
    ));

  for (const inv of invites) {
    try {
      await db.transaction(async (tx) => {
        const claimed = await tx.update(schema.workspaceInvites)
          .set({ acceptedAt: new Date() })
          .where(and(eq(schema.workspaceInvites.id, inv.id), isNull(schema.workspaceInvites.acceptedAt)))
          .returning({ id: schema.workspaceInvites.id });

        if (claimed.length === 0) return;

        await tx.insert(schema.workspaceMembers).values({
          workspaceId: inv.workspaceId,
          userId,
          role: inv.role,
        }).onConflictDoNothing();

        await tx.update(schema.users)
          .set({ activeWorkspaceId: inv.workspaceId, updatedAt: new Date() })
          .where(eq(schema.users.id, userId));

        await tx.insert(schema.auditEvents).values({
          id: crypto.randomUUID(),
          workspaceId: inv.workspaceId,
          actorUserId: userId,
          action: "member.invite_accepted",
          detail: `Accepted pending invitation as ${inv.role}`,
        });
      });
    } catch (err) {
      log.warn({ err, inviteId: inv.id }, "Failed to auto-claim pending invite");
    }
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
  if (targetRole === "owner") throw new UserError("The owner's role cannot be changed");
  if (actorRole !== "owner") throw new UserError("Only the owner can change roles");

  await db.update(schema.workspaceMembers)
    .set({ role })
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, targetUserId)));
  recordAudit(workspaceId, actorId, "member.role_changed", null, `${targetUserId}:${targetRole}->${role}`);

  return { ok: true };
}

export async function removeMember(workspaceId: string, actorId: string, targetUserId: string) {
  const targetRole = await roleOf(workspaceId, targetUserId);
  if (targetRole === "owner") throw new UserError("The owner cannot be removed");
  if (targetUserId !== actorId) {
    const actorRole = await assertAdmin(workspaceId, actorId);
    if (targetRole === "admin" && actorRole !== "owner") {
      throw new UserError("Only the workspace owner can remove admins", "FORBIDDEN");
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.workspaceMembers)
      .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, targetUserId)));

    // If removed member had this workspace active, re-point them to another workspace or null
    const [user] = await tx.select({ activeId: schema.users.activeWorkspaceId })
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId))
      .limit(1);

    if (user?.activeId === workspaceId) {
      const [nextWs] = await tx.select({ workspaceId: schema.workspaceMembers.workspaceId })
        .from(schema.workspaceMembers)
        .where(eq(schema.workspaceMembers.userId, targetUserId))
        .orderBy(schema.workspaceMembers.createdAt)
        .limit(1);

      await tx.update(schema.users)
        .set({ activeWorkspaceId: nextWs?.workspaceId ?? null, updatedAt: new Date() })
        .where(eq(schema.users.id, targetUserId));
    }

    await tx.insert(schema.auditEvents).values({
      id: crypto.randomUUID(),
      workspaceId,
      actorUserId: actorId,
      action: "member.removed",
      detail: `Member ${targetUserId} removed`,
    });
  });

  return { ok: true };
}

// ── Active workspace ──────────────────────────────────────────────────────────

// Persisted in users.active_workspace_id. Always validated against current
// membership so a removed member can never resolve to a workspace they left.

export async function resolveActiveWorkspaceId(userId: string): Promise<string | null> {
  const [pref] = await db.select({ id: schema.users.activeWorkspaceId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (pref?.id && (await getMemberRole(pref.id, userId))) return pref.id;

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
  await db.update(schema.users)
    .set({ activeWorkspaceId: workspaceId })
    .where(eq(schema.users.id, userId));
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
