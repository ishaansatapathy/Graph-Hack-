import crypto from "node:crypto";

import * as workspaceDb from "./db";
import * as integrationOps from "./integrations";
import * as memberOps from "./members";

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

export async function getOrCreateWorkspaceForUser(
  userId: string,
  displayName: string,
  email?: string,
): Promise<WorkspacePublic> {
  if (email) await memberOps.acceptPendingInvites(userId, email);

  const activeId = await memberOps.resolveActiveWorkspaceId(userId);
  const existing =
    (activeId ? await workspaceDb.findWorkspaceById(activeId) : null) ??
    (await workspaceDb.findWorkspaceForUser(userId));

  if (existing) {
    const role = (await workspaceDb.getMemberRole(existing.id, userId)) ?? "member";
    return { id: existing.id, name: existing.name, slug: existing.slug, role: toRole(role) };
  }

  const name = `${displayName.split(" ")[0] || "My"} workspace`;
  const created = await workspaceDb.createWorkspaceAtomic({
    userId,
    name,
  });

  return { id: created.id, name: created.name, slug: created.slug, role: "owner" };
}

export async function assertWorkspaceMember(workspaceId: string, userId: string): Promise<string> {
  const role = await workspaceDb.getMemberRole(workspaceId, userId);
  if (!role) throw new Error("Workspace not found or access denied");
  return role;
}

export async function createApiKey(workspaceId: string, userId: string, name: string) {
  await assertWorkspaceMember(workspaceId, userId);
  const trimmed = name.trim() || "API key";
  const raw = `sk_stackfox_${crypto.randomBytes(24).toString("base64url")}`;
  const prefix = raw.slice(0, 16);
  const id = crypto.randomUUID();
  await workspaceDb.insertApiKey({
    id,
    workspace_id: workspaceId,
    name: trimmed,
    key_prefix: prefix,
    key_hash: workspaceDb.hashApiKey(raw),
    created_at: new Date().toISOString(),
  });
  return { id, name: trimmed, key: raw, prefix, createdAt: new Date().toISOString() };
}

export async function listApiKeys(workspaceId: string, userId: string) {
  await assertWorkspaceMember(workspaceId, userId);
  const keys = await workspaceDb.listApiKeys(workspaceId);
  return keys.map((k) => ({ id: k.id, name: k.name, prefix: k.key_prefix, createdAt: k.created_at }));
}

export async function revokeApiKey(workspaceId: string, userId: string, keyId: string) {
  await assertWorkspaceMember(workspaceId, userId);
  await workspaceDb.deleteApiKey(workspaceId, keyId);
  return { ok: true };
}

export const workspaceIntegrations = integrationOps;
export const workspaceMembers = memberOps;
export * as workspaceTools from "./tools";
export { handleGithubPush, getGithubWebhookSecretForWorkspace } from "./github-push-handler";
export { getGithubOnboarding } from "./integrations";
