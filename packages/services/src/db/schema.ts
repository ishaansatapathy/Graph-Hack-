/**
 * Drizzle ORM schema — Stackfox production database (Neon/PostgreSQL)
 *
 * All tables that were previously in SQLite are now here.
 * Run `npm run db:push` to push schema to Neon.
 */

import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "member"]);
export const integrationProviderEnum = pgEnum("integration_provider", ["github", "jira", "slack"]);
export const toolVisibilityEnum = pgEnum("tool_visibility", ["private", "workspace", "public"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
export const syncStatusEnum = pgEnum("sync_status", ["running", "ok", "error"]);

// ── Users ────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  fullName: text("full_name").notNull().default(""),
  displayName: text("display_name").notNull().default(""),
  avatarUrl: text("avatar_url"),
  profileImageUrl: text("profile_image_url"),
  emailVerified: boolean("email_verified").notNull().default(false),
  role: text("role").notNull().default("user"),
  tokenVersion: text("token_version").notNull().default("0"),
  provider: text("provider").notNull().default("google"),
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_users_email").on(t.email),
]);

// ── Workspaces ────────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  plan: text("plan").notNull().default("free"),       // free | pro | enterprise
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_workspaces_owner").on(t.ownerUserId),
  index("idx_workspaces_slug").on(t.slug),
]);

// ── Workspace members ─────────────────────────────────────────────────────────

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: memberRoleEnum("role").notNull().default("member"),
  invitedByUserId: text("invited_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  index("idx_members_user").on(t.userId),
]);

// ── Workspace integrations ────────────────────────────────────────────────────

export const workspaceIntegrations = pgTable("workspace_integrations", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: integrationProviderEnum("provider").notNull(),
  configEncrypted: text("config_encrypted").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.provider] }),
]);

// ── API keys ──────────────────────────────────────────────────────────────────

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_apikeys_workspace").on(t.workspaceId),
  index("idx_apikeys_hash").on(t.keyHash),
]);

// ── Workspace tools (shared integrations) ────────────────────────────────────

export const workspaceTools = pgTable("workspace_tools", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  description: text("description").notNull().default(""),
  visibility: toolVisibilityEnum("visibility").notNull().default("private"),
  version: integer("version").notNull().default(1),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_tools_workspace").on(t.workspaceId),
]);

// ── Audit log ─────────────────────────────────────────────────────────────────

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action").notNull(),
  toolId: text("tool_id"),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_audit_workspace").on(t.workspaceId),
  index("idx_audit_actor").on(t.actorUserId),
]);

// ── Agent memory ──────────────────────────────────────────────────────────────

export const agentMemory = pgTable("agent_memory", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_memory_workspace_user").on(t.workspaceId, t.userId),
]);

// ── Sync runs ─────────────────────────────────────────────────────────────────

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  provider: text("provider").notNull(),
  status: syncStatusEnum("status").notNull().default("running"),
  items: integer("items").notNull().default(0),
  message: text("message").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("idx_syncruns_workspace").on(t.workspaceId),
]);

// ── Device quota (fingerprint-based rate limiting) ────────────────────────────

export const deviceQuota = pgTable("device_quota", {
  fpHash: text("fp_hash").notNull(),
  windowStart: text("window_start").notNull(),      // "2026-10-17T11:03" or "2026-10-17"
  requests: integer("requests").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.fpHash, t.windowStart] }),
]);

// ── AI usage / billing ────────────────────────────────────────────────────────

export const aiUsage = pgTable("ai_usage", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  featureTag: text("feature_tag").notNull().default("ask"),  // "ask" | "conflict_resolve" | ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_aiusage_workspace").on(t.workspaceId),
  index("idx_aiusage_date").on(t.createdAt),
]);

// ── Workspace invites ─────────────────────────────────────────────────────────

export const workspaceInvites = pgTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  invitedByUserId: text("invited_by_user_id").notNull(),
  email: text("email").notNull(),
  role: memberRoleEnum("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("uq_invite_workspace_email").on(t.workspaceId, t.email),
  index("idx_invite_token").on(t.token),
]);
