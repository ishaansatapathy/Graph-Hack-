import crypto from "node:crypto";

import * as workspaceDb from "./db";
import * as integrationOps from "./integrations";

export type WorkspacePublic = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
};

function toRole(role: string): WorkspacePublic["role"] {
  if (role === "owner" || role === "admin") return role;
  return "member";
}

export function getOrCreateWorkspaceForUser(userId: string, displayName: string): WorkspacePublic {
  const existing = workspaceDb.findWorkspaceForUser(userId);
  if (existing) {
    const role = workspaceDb.getMemberRole(existing.id, userId) ?? "member";
    return {
      id: existing.id,
      name: existing.name,
      slug: existing.slug,
      role: toRole(role),
    };
  }

  const id = crypto.randomUUID();
  const name = `${displayName.split(" ")[0] || "My"} workspace`;
  let slug = workspaceDb.slugifyName(name);
  if (workspaceDb.findWorkspaceBySlug(slug)) slug = `${slug}-${id.slice(0, 6)}`;

  workspaceDb.insertWorkspace({
    id,
    name,
    slug,
    owner_user_id: userId,
    created_at: new Date().toISOString(),
  });
  workspaceDb.insertWorkspaceMember({ workspace_id: id, user_id: userId, role: "owner" });

  return { id, name, slug, role: "owner" };
}

export function assertWorkspaceMember(workspaceId: string, userId: string) {
  const role = workspaceDb.getMemberRole(workspaceId, userId);
  if (!role) throw new Error("Workspace not found or access denied");
  return role;
}

export function createApiKey(workspaceId: string, userId: string, name: string) {
  assertWorkspaceMember(workspaceId, userId);
  const trimmed = name.trim() || "API key";
  const raw = `sk_stackfox_${crypto.randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 16);
  const id = crypto.randomUUID();
  workspaceDb.insertApiKey({
    id,
    workspace_id: workspaceId,
    name: trimmed,
    key_prefix: prefix,
    key_hash: workspaceDb.hashApiKey(raw),
    created_at: new Date().toISOString(),
  });
  return { id, name: trimmed, key: raw, prefix, createdAt: new Date().toISOString() };
}

export function listApiKeys(workspaceId: string, userId: string) {
  assertWorkspaceMember(workspaceId, userId);
  return workspaceDb.listApiKeys(workspaceId).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.key_prefix,
    createdAt: k.created_at,
  }));
}

export function revokeApiKey(workspaceId: string, userId: string, keyId: string) {
  assertWorkspaceMember(workspaceId, userId);
  workspaceDb.deleteApiKey(workspaceId, keyId);
  return { ok: true };
}

export const workspaceIntegrations = integrationOps;
export * as workspaceTools from "./tools";
export { handleGithubPush, getGithubWebhookSecretForWorkspace } from "./github-push-handler";
export { getGithubOnboarding } from "./integrations";
