import { githubWebhookUrl } from "../integrations/config";

export type GithubWebhookRegistrationResult = {
  ok: boolean;
  message: string;
  hookId?: number;
  action?: "created" | "updated" | "existing";
};

const WEBHOOK_EVENTS = ["push"] as const;

function parseRepositoryFullName(value: string) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value.trim());
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]! };
}

function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "Stackfox",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function registerGithubRepositoryWebhook(input: {
  token: string;
  repositoryFullName: string;
  webhookSecret: string;
  workspaceId: string;
}): Promise<GithubWebhookRegistrationResult> {
  const repository = parseRepositoryFullName(input.repositoryFullName);
  if (!repository) {
    return { ok: false, message: "Repository must be owner/repo (e.g. acme/api)" };
  }

  const secret = input.webhookSecret.trim();
  if (!secret) {
    return { ok: false, message: "Webhook secret is required" };
  }

  const webhookUrl = githubWebhookUrl(input.workspaceId);
  const listUrl = `https://api.github.com/repos/${repository.owner}/${repository.repo}/hooks`;

  const listResponse = await fetch(listUrl, { headers: githubHeaders(input.token) });
  if (!listResponse.ok) {
    const hint =
      listResponse.status === 404
        ? " — repo not found or token lacks access"
        : listResponse.status === 403
          ? " — token needs admin:repo_hook or repo scope"
          : "";
    return { ok: false, message: `GitHub hooks lookup failed (${listResponse.status})${hint}` };
  }

  const hooks = (await listResponse.json()) as Array<{ id: number; config?: { url?: string } }>;
  // Reuse only this workspace's hook (also repoints one left on an old API URL); other workspaces keep theirs.
  const workspaceParam = `/webhooks/github?workspaceId=${encodeURIComponent(input.workspaceId)}`;
  const existing = hooks.find((hook) => hook.config?.url?.includes(workspaceParam));

  const body = {
    active: true,
    events: [...WEBHOOK_EVENTS],
    config: {
      url: webhookUrl,
      content_type: "json",
      secret,
      insecure_ssl: "0",
    },
  };

  if (existing) {
    const patchResponse = await fetch(`${listUrl}/${existing.id}`, {
      method: "PATCH",
      headers: { ...githubHeaders(input.token), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!patchResponse.ok) {
      return { ok: false, message: `Failed to update webhook (${patchResponse.status})` };
    }
    return {
      ok: true,
      message: `Webhook updated for ${repository.owner}/${repository.repo}`,
      hookId: existing.id,
      action: "updated",
    };
  }

  const createResponse = await fetch(listUrl, {
    method: "POST",
    headers: { ...githubHeaders(input.token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "web", ...body }),
  });

  if (!createResponse.ok) {
    return { ok: false, message: `Failed to create webhook (${createResponse.status})` };
  }

  const created = (await createResponse.json()) as { id?: number };
  return {
    ok: true,
    message: `Webhook registered for ${repository.owner}/${repository.repo}`,
    hookId: created.id,
    action: "created",
  };
}
