/**
 * Production data access layer — Drizzle ORM on Neon (PostgreSQL).
 *
 * Same function signatures as the old SQLite db.ts so all callers
 * continue to work without changes. Internally uses async Drizzle queries.
 */

import crypto from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { childLogger } from "../logger";
import { db, schema } from "./client";

const log = childLogger("db");

// Re-export types so callers don't need to change their imports
export type IntegrationProvider = "github" | "jira" | "slack";

// User type — matches old SQLite user table shape for auth compatibility
export type DbUser = {
  id: string;
  email: string;
  full_name: string;
  display_name: string;
  profile_image_url: string | null;
  email_verified: number | boolean;
  role: string;
  token_version: string;
  provider: string;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DbWorkspace = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  created_at: string;
};

export type DbWorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: string;
};

export type DbIntegration = {
  workspace_id: string;
  provider: IntegrationProvider;
  config_encrypted: string;
  updated_at: string;
};

export type DbApiKey = {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_at: string;
};

// ── Workspaces ────────────────────────────────────────────────────────────────

export async function findWorkspaceById(id: string): Promise<DbWorkspace | null> {
  const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, slug: row.slug, owner_user_id: row.ownerUserId, created_at: row.createdAt.toISOString() };
}

export async function findWorkspaceBySlug(slug: string): Promise<DbWorkspace | null> {
  const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.slug, slug)).limit(1);
  if (!row) return null;
  return { id: row.id, name: row.name, slug: row.slug, owner_user_id: row.ownerUserId, created_at: row.createdAt.toISOString() };
}

export async function findWorkspaceForUser(userId: string): Promise<DbWorkspace | null> {
  const [row] = await db
    .select({ workspace: schema.workspaces })
    .from(schema.workspaces)
    .innerJoin(schema.workspaceMembers, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(schema.workspaces.createdAt)
    .limit(1);
  if (!row) return null;
  return {
    id: row.workspace.id,
    name: row.workspace.name,
    slug: row.workspace.slug,
    owner_user_id: row.workspace.ownerUserId,
    created_at: row.workspace.createdAt.toISOString(),
  };
}

export async function insertWorkspace(workspace: DbWorkspace): Promise<void> {
  await db.insert(schema.workspaces).values({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    ownerUserId: workspace.owner_user_id,
  }).onConflictDoNothing();
}

export async function insertWorkspaceMember(member: DbWorkspaceMember): Promise<void> {
  await db.insert(schema.workspaceMembers).values({
    workspaceId: member.workspace_id,
    userId: member.user_id,
    role: member.role as "owner" | "admin" | "member",
  }).onConflictDoNothing();
}

/**
 * Production ACID transaction: atomically creates a workspace, establishes the
 * creator as owner in workspace_members, sets their active workspace pointer,
 * and writes the initial audit record.
 */
export async function createWorkspaceAtomic(opts: {
  userId: string;
  name: string;
  slug?: string;
  plan?: string;
}): Promise<DbWorkspace> {
  const baseName = opts.name.trim() || "My workspace";
  const id = crypto.randomUUID();
  let slug = opts.slug || slugifyName(baseName);

  // If slug collision occurs, append short random entropy
  const existing = await findWorkspaceBySlug(slug);
  if (existing) {
    slug = `${slug}-${crypto.randomBytes(3).toString("hex")}`;
  }

  return await db.transaction(async (tx) => {
    const [wsRow] = await tx
      .insert(schema.workspaces)
      .values({
        id,
        name: baseName,
        slug,
        ownerUserId: opts.userId,
        plan: opts.plan ?? "free",
      })
      .returning();

    if (!wsRow) throw new Error("Failed to create workspace row in transaction");

    // Insert owner member
    await tx.insert(schema.workspaceMembers).values({
      workspaceId: id,
      userId: opts.userId,
      role: "owner",
    });

    // Point user's active workspace to newly created workspace
    await tx
      .update(schema.users)
      .set({ activeWorkspaceId: id, updatedAt: new Date() })
      .where(eq(schema.users.id, opts.userId));

    // Record audit event
    await tx.insert(schema.auditEvents).values({
      id: crypto.randomUUID(),
      workspaceId: id,
      actorUserId: opts.userId,
      action: "workspace.created",
      detail: `Created workspace ${baseName}`,
    });

    return {
      id: wsRow.id,
      name: wsRow.name,
      slug: wsRow.slug,
      owner_user_id: wsRow.ownerUserId,
      created_at: wsRow.createdAt.toISOString(),
    };
  });
}

/**
 * Production ACID transaction: soft-deletes a workspace, resets activeWorkspaceId
 * for any affected users, and records an audit event.
 */
export async function softDeleteWorkspaceAtomic(workspaceId: string, actorUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.workspaces)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.workspaces.id, workspaceId));

    await tx
      .update(schema.users)
      .set({ activeWorkspaceId: null, updatedAt: new Date() })
      .where(eq(schema.users.activeWorkspaceId, workspaceId));

    await tx.insert(schema.auditEvents).values({
      id: crypto.randomUUID(),
      workspaceId,
      actorUserId,
      action: "workspace.deleted",
      detail: "Workspace soft-deleted",
    });
  });
}

/**
 * Production ACID transaction: transfers ownership of workspace to another member.
 */
export async function transferWorkspaceOwnershipAtomic(
  workspaceId: string,
  currentOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [ws] = await tx
      .select({ ownerUserId: schema.workspaces.ownerUserId })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);

    if (!ws || ws.ownerUserId !== currentOwnerId) {
      throw new Error("Only the current workspace owner can transfer ownership");
    }

    const [member] = await tx
      .select()
      .from(schema.workspaceMembers)
      .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, newOwnerId)))
      .limit(1);

    if (!member) {
      throw new Error("New owner must be an existing member of the workspace");
    }

    await tx
      .update(schema.workspaces)
      .set({ ownerUserId: newOwnerId, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, workspaceId));

    await tx
      .update(schema.workspaceMembers)
      .set({ role: "owner" })
      .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, newOwnerId)));

    await tx
      .update(schema.workspaceMembers)
      .set({ role: "admin" })
      .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, currentOwnerId)));

    await tx.insert(schema.auditEvents).values({
      id: crypto.randomUUID(),
      workspaceId,
      actorUserId: currentOwnerId,
      action: "workspace.ownership_transferred",
      detail: `Ownership transferred to user ${newOwnerId}`,
    });
  });
}

export async function getMemberRole(workspaceId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(and(eq(schema.workspaceMembers.workspaceId, workspaceId), eq(schema.workspaceMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

// ── Integrations ──────────────────────────────────────────────────────────────

export async function listIntegrations(workspaceId: string): Promise<DbIntegration[]> {
  const rows = await db.select().from(schema.workspaceIntegrations)
    .where(eq(schema.workspaceIntegrations.workspaceId, workspaceId));
  return rows.map((r) => ({
    workspace_id: r.workspaceId,
    provider: r.provider as IntegrationProvider,
    config_encrypted: r.configEncrypted,
    updated_at: r.updatedAt.toISOString(),
  }));
}

export async function getIntegration(workspaceId: string, provider: IntegrationProvider): Promise<DbIntegration | null> {
  const [row] = await db.select()
    .from(schema.workspaceIntegrations)
    .where(and(
      eq(schema.workspaceIntegrations.workspaceId, workspaceId),
      eq(schema.workspaceIntegrations.provider, provider),
    ))
    .limit(1);
  if (!row) return null;
  return {
    workspace_id: row.workspaceId,
    provider: row.provider as IntegrationProvider,
    config_encrypted: row.configEncrypted,
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function upsertIntegration(workspaceId: string, provider: IntegrationProvider, configEncrypted: string): Promise<void> {
  await db.insert(schema.workspaceIntegrations)
    .values({ workspaceId, provider, configEncrypted })
    .onConflictDoUpdate({
      target: [schema.workspaceIntegrations.workspaceId, schema.workspaceIntegrations.provider],
      set: { configEncrypted, updatedAt: new Date() },
    });
}

export async function deleteIntegration(workspaceId: string, provider: IntegrationProvider): Promise<void> {
  await db.delete(schema.workspaceIntegrations)
    .where(and(
      eq(schema.workspaceIntegrations.workspaceId, workspaceId),
      eq(schema.workspaceIntegrations.provider, provider),
    ));
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export async function listApiKeys(workspaceId: string): Promise<DbApiKey[]> {
  const rows = await db.select().from(schema.apiKeys)
    .where(eq(schema.apiKeys.workspaceId, workspaceId))
    .orderBy(desc(schema.apiKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    workspace_id: r.workspaceId,
    name: r.name,
    key_prefix: r.keyPrefix,
    key_hash: r.keyHash,
    created_at: r.createdAt.toISOString(),
  }));
}

export async function insertApiKey(row: DbApiKey): Promise<void> {
  await db.insert(schema.apiKeys).values({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
  });
}

export async function deleteApiKey(workspaceId: string, keyId: string): Promise<void> {
  await db.delete(schema.apiKeys)
    .where(and(eq(schema.apiKeys.workspaceId, workspaceId), eq(schema.apiKeys.id, keyId)));
}

// ── AI Usage tracking ─────────────────────────────────────────────────────────

export async function trackAiUsage(opts: {
  workspaceId: string;
  userId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  featureTag: string;
}): Promise<void> {
  try {
    await db.insert(schema.aiUsage).values({
      id: crypto.randomUUID(),
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      model: opts.model,
      promptTokens: opts.promptTokens,
      completionTokens: opts.completionTokens,
      totalTokens: opts.promptTokens + opts.completionTokens,
      featureTag: opts.featureTag,
    });
  } catch (err) {
    log.warn({ err }, "Failed to track AI usage — non-fatal");
  }
}

export async function getWorkspaceAiUsage(workspaceId: string) {
  const rows = await db
    .select({
      model: schema.aiUsage.model,
      tokens: sql<number>`sum(${schema.aiUsage.totalTokens})`,
      count: sql<number>`count(*)`,
    })
    .from(schema.aiUsage)
    .where(eq(schema.aiUsage.workspaceId, workspaceId))
    .groupBy(schema.aiUsage.model);

  const byModel: Record<string, number> = {};
  let totalTokens = 0;
  let requestCount = 0;
  for (const r of rows) {
    byModel[r.model] = Number(r.tokens);
    totalTokens += Number(r.tokens);
    requestCount += Number(r.count);
  }
  return { totalTokens, requestCount, byModel };
}

// ── Device quota (DB-backed, persistent across restarts) ──────────────────────

export async function getDeviceWindowCount(fpHash: string, windowStart: string): Promise<number> {
  const [row] = await db.select({ requests: schema.deviceQuota.requests })
    .from(schema.deviceQuota)
    .where(and(eq(schema.deviceQuota.fpHash, fpHash), eq(schema.deviceQuota.windowStart, windowStart)))
    .limit(1);
  return row?.requests ?? 0;
}

export async function incrementDeviceWindow(fpHash: string, windowStart: string): Promise<void> {
  await db.insert(schema.deviceQuota)
    .values({ fpHash, windowStart, requests: 1 })
    .onConflictDoUpdate({
      target: [schema.deviceQuota.fpHash, schema.deviceQuota.windowStart],
      set: { requests: sql`${schema.deviceQuota.requests} + 1` },
    });
}

export async function cleanupOldDeviceQuotas(): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db.delete(schema.deviceQuota).where(sql`${schema.deviceQuota.windowStart} < ${cutoff}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function slugifyName(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return base || "workspace";
}

// ── User helpers ──────────────────────────────────────────────────────────────

function rowToDbUser(row: typeof schema.users.$inferSelect): DbUser {
  return {
    id: row.id,
    email: row.email,
    full_name: row.fullName,
    display_name: row.displayName,
    profile_image_url: row.profileImageUrl ?? null,
    email_verified: row.emailVerified,
    role: row.role,
    token_version: row.tokenVersion,
    provider: row.provider,
    provider_id: row.providerId ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).limit(1);
  return row ? rowToDbUser(row) : null;
}

export async function findUserById(id: string): Promise<DbUser | null> {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  return row ? rowToDbUser(row) : null;
}

export async function insertUser(user: {
  id: string;
  email: string;
  fullName: string;
  displayName: string;
  profileImageUrl?: string | null;
  provider?: string;
  providerId?: string | null;
  emailVerified?: boolean;
}): Promise<DbUser> {
  const [row] = await db.insert(schema.users).values({
    id: user.id,
    email: user.email.toLowerCase(),
    name: user.fullName,
    fullName: user.fullName,
    displayName: user.displayName || user.fullName,
    profileImageUrl: user.profileImageUrl ?? null,
    provider: user.provider ?? "google",
    providerId: user.providerId ?? null,
    emailVerified: user.emailVerified ?? (user.provider === "google"),
  }).returning();
  if (!row) throw new Error("insertUser: no row returned");
  return rowToDbUser(row);
}

export async function updateUserProvider(id: string, update: {
  profileImageUrl?: string | null;
  providerId?: string;
  fullName?: string;
  emailVerified?: boolean;
}): Promise<void> {
  await db.update(schema.users)
    .set({
      ...(update.profileImageUrl !== undefined && { profileImageUrl: update.profileImageUrl }),
      ...(update.providerId && { providerId: update.providerId }),
      ...(update.fullName && { fullName: update.fullName, name: update.fullName }),
      ...(update.emailVerified !== undefined && { emailVerified: update.emailVerified }),
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, id));
}

export async function bumpTokenVersion(userId: string): Promise<string> {
  const newVersion = crypto.randomUUID().slice(0, 8);
  await db.update(schema.users)
    .set({ tokenVersion: newVersion, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  return newVersion;
}

// ── Re-exports for production database health, errors, and housekeeping ───────

export * from "./health";
export * from "./housekeeping";
export * from "./errors";
export { withDbRetry, closeDbPool, db, schema } from "./client";
