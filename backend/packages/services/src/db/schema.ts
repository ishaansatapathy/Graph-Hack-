/**
 * Drizzle ORM schema — Stackfox production database (Neon/PostgreSQL)
 *
 * All tables with production-grade constraints, foreign-key cascades,
 * composite query indexes, and soft-delete support.
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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const memberRoleEnum = pgEnum("member_role", ["owner", "admin", "member"]);
export const integrationProviderEnum = pgEnum("integration_provider", ["github", "jira", "slack"]);
export const toolVisibilityEnum = pgEnum("tool_visibility", ["private", "workspace", "public"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
export const syncStatusEnum = pgEnum("sync_status", ["queued", "running", "ok", "error"]);

// ── Users ─────────────────────────────────────────────────────────────────────

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
  activeWorkspaceId: text("active_workspace_id").references((): any => workspaces.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_users_email").on(t.email),
  index("idx_users_provider").on(t.provider, t.providerId),
]);

// ── Workspaces ────────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  plan: text("plan").notNull().default("free"),       // free | pro | enterprise
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
  invitedByUserId: text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  index("idx_members_user").on(t.userId),
  index("idx_members_workspace").on(t.workspaceId),
]);

// ── Workspace integrations ───────────────────────────────────────────────────

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
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_apikeys_workspace").on(t.workspaceId),
  index("idx_apikeys_hash").on(t.keyHash),
]);

// ── Workspace tools (shared integrations) ─────────────────────────────────────

export const workspaceTools = pgTable("workspace_tools", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
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
  index("idx_tools_owner").on(t.ownerUserId),
  unique("uq_tools_workspace_name").on(t.workspaceId, t.name),
]);

// ── Audit log ─────────────────────────────────────────────────────────────────

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  toolId: text("tool_id"),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_audit_workspace_date").on(t.workspaceId, t.createdAt),
  index("idx_audit_actor").on(t.actorUserId),
]);

// ── Agent memory ──────────────────────────────────────────────────────────────

export const agentMemory = pgTable("agent_memory", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_memory_workspace_user_date").on(t.workspaceId, t.userId, t.createdAt),
]);

// ── Sync runs ─────────────────────────────────────────────────────────────────

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  status: syncStatusEnum("status").notNull().default("running"),
  items: integer("items").notNull().default(0),
  message: text("message").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("idx_syncruns_workspace_provider_date").on(t.workspaceId, t.provider, t.startedAt),
  uniqueIndex("uq_sync_runs_workspace_provider_running")
    .on(t.workspaceId, t.provider)
    .where(sql`${t.status} IN ('queued', 'running')`),
]);

// ── Device quota (fingerprint-based rate limiting) ────────────────────────────

export const deviceQuota = pgTable("device_quota", {
  fpHash: text("fp_hash").notNull(),
  windowStart: text("window_start").notNull(),      // "2026-10-17T11:03" or "2026-10-17"
  requests: integer("requests").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.fpHash, t.windowStart] }),
  index("idx_devicequota_window").on(t.windowStart),
]);

// ── AI usage / billing ────────────────────────────────────────────────────────

export const aiUsage = pgTable("ai_usage", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  featureTag: text("feature_tag").notNull().default("ask"),  // "ask" | "conflict_resolve" | ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_aiusage_workspace_date").on(t.workspaceId, t.createdAt),
  index("idx_aiusage_user_date").on(t.userId, t.createdAt),
]);

// ── Workspace invites ─────────────────────────────────────────────────────────

export const workspaceInvites = pgTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  invitedByUserId: text("invited_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: memberRoleEnum("role").notNull().default("member"),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("uq_invite_workspace_email").on(t.workspaceId, t.email),
  index("idx_invite_token").on(t.token),
  index("idx_invite_lookup").on(t.workspaceId, t.email, t.acceptedAt),
]);

// ── Conflict notifications (dedupe so each conflict emails once) ──────────────

export const conflictNotifications = pgTable("conflict_notifications", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conflictKey: text("conflict_key").notNull(),   // e.g. "path::shaA::shaB"
  notifiedAt: timestamp("notified_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.conflictKey] }),
]);

// Workspace-scoped API services that teammates can invoke from the workspace UI.
export const workspaceServices = pgTable("workspace_services", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("uq_workspace_service_name").on(t.workspaceId, t.name),
  index("idx_workspace_services_workspace").on(t.workspaceId, t.createdAt),
]);

// Workspace-level shared editor drafts; versioned writes prevent lost updates.
export const workspaceFileDrafts = pgTable("workspace_file_drafts", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  updatedByUserId: text("updated_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.path] }),
  index("idx_workspace_file_drafts_updated").on(t.workspaceId, t.updatedAt),
]);

export const githubWebhookDeliveries = pgTable("github_webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("processing"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("idx_github_deliveries_workspace_started").on(t.workspaceId, t.startedAt)]);
