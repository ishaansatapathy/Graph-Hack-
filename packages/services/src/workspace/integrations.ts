import { githubWebhookUrl } from "../integrations/config";
import type { IntegrationProvider } from "./db";
import * as workspaceDb from "./db";
import { registerGithubRepositoryWebhook } from "./github-webhook-register";
import { decryptJson, encryptJson, maskSecret } from "./secrets";

export type IntegrationSummary = {
  provider: IntegrationProvider;
  configured: boolean;
  maskedSecrets: Record<string, string | null>;
  updatedAt: string | null;
};

const PROVIDERS: IntegrationProvider[] = ["github", "jira", "slack"];

async function readConfig(workspaceId: string, provider: IntegrationProvider) {
  const row = await workspaceDb.getIntegration(workspaceId, provider);
  if (!row) return null;
  return decryptJson(row.config_encrypted);
}

export async function listIntegrationSummaries(workspaceId: string): Promise<IntegrationSummary[]> {
  const rows = await workspaceDb.listIntegrations(workspaceId);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return PROVIDERS.map((provider) => {
    const row = byProvider.get(provider);
    if (!row) return { provider, configured: false, maskedSecrets: {}, updatedAt: null };

    const config = decryptJson(row.config_encrypted);
    const masked: Record<string, string | null> = {};
    if (provider === "github") {
      masked.personalAccessToken = maskSecret(config.personalAccessToken);
      masked.webhookSecret = maskSecret(config.webhookSecret);
      masked.repositoryFullName = config.repositoryFullName ?? null;
    }
    if (provider === "jira") {
      masked.email = config.email ? `${config.email.slice(0, 2)}•••` : null;
      masked.apiToken = maskSecret(config.apiToken);
      masked.baseUrl = config.baseUrl ?? null;
    }
    if (provider === "slack") {
      masked.webhookUrl = config.webhookUrl ? "https://hooks.slack.com/•••" : null;
      masked.botToken = config.botToken ? "xoxb-•••" : null;
      masked.teamDomain = config.teamDomain ?? null;
    }
    return { provider, configured: true, maskedSecrets: masked, updatedAt: row.updated_at };
  });
}

export type UpsertGithubResult = {
  message: string;
  webhookRegistration?: { ok: boolean; message: string };
};

export function getGithubOnboarding(workspaceId: string) {
  return { webhookUrl: githubWebhookUrl(workspaceId) };
}

export async function upsertGithub(
  workspaceId: string,
  input: {
    personalAccessToken?: string;
    repositoryFullName?: string;
    webhookSecret?: string;
    registerWebhook?: boolean;
  },
): Promise<UpsertGithubResult> {
  const existing = (await readConfig(workspaceId, "github")) ?? {};
  const token = (input.personalAccessToken?.trim() || existing.personalAccessToken || "").trim();
  if (!token) throw new Error("GitHub token is required");

  const repositoryFullName = input.repositoryFullName?.trim() || existing.repositoryFullName?.trim() || "";
  const webhookSecret = input.webhookSecret?.trim() || existing.webhookSecret?.trim() || "";

  let webhookRegistration: { ok: boolean; message: string } | undefined;
  if (input.registerWebhook !== false && repositoryFullName && webhookSecret) {
    webhookRegistration = await registerGithubRepositoryWebhook({ token, repositoryFullName, webhookSecret, workspaceId });
    if (!webhookRegistration.ok) throw new Error(webhookRegistration.message);
  }

  await workspaceDb.upsertIntegration(
    workspaceId,
    "github",
    encryptJson({
      ...existing,
      personalAccessToken: token,
      ...(repositoryFullName ? { repositoryFullName } : {}),
      ...(webhookSecret ? { webhookSecret } : {}),
      webhookRegisteredAt: webhookRegistration?.ok ? new Date().toISOString() : (existing.webhookRegisteredAt ?? ""),
    }),
  );

  return { message: "GitHub connected", webhookRegistration };
}

export async function upsertJira(
  workspaceId: string,
  input: { baseUrl: string; email: string; apiToken: string },
): Promise<void> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const email = input.email.trim();
  const apiToken = input.apiToken.trim();
  if (!baseUrl || !email || !apiToken) throw new Error("Jira site URL, email, and API token are required");
  await workspaceDb.upsertIntegration(workspaceId, "jira", encryptJson({ baseUrl, email, apiToken }));
}

export async function upsertSlack(
  workspaceId: string,
  input: { webhookUrl: string; botToken?: string; teamDomain?: string },
): Promise<void> {
  const webhookUrl = input.webhookUrl.trim();
  if (!webhookUrl.startsWith("https://hooks.slack.com/")) {
    throw new Error("Use a valid Slack incoming webhook URL");
  }
  const existing = (await readConfig(workspaceId, "slack")) ?? {};
  await workspaceDb.upsertIntegration(
    workspaceId,
    "slack",
    encryptJson({
      ...existing,
      webhookUrl,
      ...(input.botToken?.trim() ? { botToken: input.botToken.trim() } : {}),
      ...(input.teamDomain?.trim() ? { teamDomain: input.teamDomain.trim() } : {}),
    }),
  );
}

export async function removeIntegration(workspaceId: string, provider: IntegrationProvider): Promise<void> {
  await workspaceDb.deleteIntegration(workspaceId, provider);
}

export async function testGithub(workspaceId: string) {
  const config = await readConfig(workspaceId, "github");
  const token = config?.personalAccessToken;
  if (!token) return { ok: false as const, message: "GitHub is not connected — add a personal access token" };

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "Stackfox" },
    });
    if (!response.ok) return { ok: false as const, message: `GitHub returned ${response.status}` };
    const data = (await response.json()) as { login?: string };
    return { ok: true as const, message: `Connected as @${data.login ?? "user"}` };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "GitHub test failed" };
  }
}

export async function testJira(workspaceId: string) {
  const config = await readConfig(workspaceId, "jira");
  if (!config?.baseUrl || !config.email || !config.apiToken) return { ok: false as const, message: "Jira is not connected" };

  const basic = Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  try {
    const response = await fetch(`${config.baseUrl}/rest/api/3/myself`, {
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
    if (!response.ok) return { ok: false as const, message: `Jira returned ${response.status}` };
    const data = (await response.json()) as { displayName?: string };
    return { ok: true as const, message: `Connected as ${data.displayName ?? "user"}` };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Jira test failed" };
  }
}

export async function testSlack(workspaceId: string) {
  const config = await readConfig(workspaceId, "slack");
  const webhookUrl = config?.webhookUrl;
  if (!webhookUrl) return { ok: false as const, message: "Slack is not connected — paste an incoming webhook URL" };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: ":white_check_mark: Stackfox is connected — graph progress updates can post here." }),
    });
    if (!response.ok) return { ok: false as const, message: `Slack returned ${response.status}` };
    return { ok: true as const, message: "Test message sent — check your Slack channel" };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Slack test failed" };
  }
}
