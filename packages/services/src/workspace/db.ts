import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { env } from "../env";

const defaultPath = path.join(process.cwd(), "data", "graph-hack.sqlite");
const dbPath = env.DATABASE_PATH?.trim() || defaultPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    owner_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS workspace_integrations (
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    config_encrypted TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workspace_id, provider)
  );

  CREATE TABLE IF NOT EXISTS workspace_api_keys (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export type IntegrationProvider = "github" | "jira" | "slack";

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

export function findWorkspaceById(id: string): DbWorkspace | null {
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as DbWorkspace | undefined;
  return row ?? null;
}

export function findWorkspaceBySlug(slug: string): DbWorkspace | null {
  const row = db.prepare("SELECT * FROM workspaces WHERE slug = ?").get(slug) as DbWorkspace | undefined;
  return row ?? null;
}

export function findWorkspaceForUser(userId: string): DbWorkspace | null {
  const row = db
    .prepare(
      `SELECT w.* FROM workspaces w
       INNER JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = ?
       ORDER BY w.created_at ASC
       LIMIT 1`,
    )
    .get(userId) as DbWorkspace | undefined;
  return row ?? null;
}

export function insertWorkspace(workspace: DbWorkspace) {
  db.prepare(
    `INSERT INTO workspaces (id, name, slug, owner_user_id, created_at) VALUES (@id, @name, @slug, @owner_user_id, @created_at)`,
  ).run(workspace);
}

export function insertWorkspaceMember(member: DbWorkspaceMember) {
  db.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (@workspace_id, @user_id, @role)`,
  ).run(member);
}

export function getMemberRole(workspaceId: string, userId: string): string | null {
  const row = db
    .prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId) as { role: string } | undefined;
  return row?.role ?? null;
}

export function listIntegrations(workspaceId: string): DbIntegration[] {
  return db
    .prepare("SELECT * FROM workspace_integrations WHERE workspace_id = ?")
    .all(workspaceId) as DbIntegration[];
}

export function getIntegration(workspaceId: string, provider: IntegrationProvider): DbIntegration | null {
  const row = db
    .prepare("SELECT * FROM workspace_integrations WHERE workspace_id = ? AND provider = ?")
    .get(workspaceId, provider) as DbIntegration | undefined;
  return row ?? null;
}

export function upsertIntegration(workspaceId: string, provider: IntegrationProvider, configEncrypted: string) {
  db.prepare(
    `INSERT INTO workspace_integrations (workspace_id, provider, config_encrypted, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(workspace_id, provider) DO UPDATE SET
       config_encrypted = excluded.config_encrypted,
       updated_at = datetime('now')`,
  ).run(workspaceId, provider, configEncrypted);
}

export function deleteIntegration(workspaceId: string, provider: IntegrationProvider) {
  db.prepare("DELETE FROM workspace_integrations WHERE workspace_id = ? AND provider = ?").run(
    workspaceId,
    provider,
  );
}

export function listApiKeys(workspaceId: string): DbApiKey[] {
  return db
    .prepare("SELECT * FROM workspace_api_keys WHERE workspace_id = ? ORDER BY created_at DESC")
    .all(workspaceId) as DbApiKey[];
}

export function insertApiKey(row: DbApiKey) {
  db.prepare(
    `INSERT INTO workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, created_at)
     VALUES (@id, @workspace_id, @name, @key_prefix, @key_hash, @created_at)`,
  ).run(row);
}

export function deleteApiKey(workspaceId: string, keyId: string) {
  db.prepare("DELETE FROM workspace_api_keys WHERE workspace_id = ? AND id = ?").run(workspaceId, keyId);
}

export function hashApiKey(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function slugifyName(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "workspace";
}
