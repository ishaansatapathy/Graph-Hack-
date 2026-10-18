import { env } from "../env";

export function getApiPublicUrl() {
  const fromEnv = env.API_PUBLIC_URL?.trim() || process.env.API_INTERNAL_URL?.trim();
  return (fromEnv || "http://localhost:8000").replace(/\/+$/, "");
}

export function githubWebhookUrl(workspaceId: string) {
  return `${getApiPublicUrl()}/webhooks/github?workspaceId=${encodeURIComponent(workspaceId)}`;
}

export function normalizeJiraCloudBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Jira Cloud site URL");
  }
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.atlassian\.net$/i.test(url.hostname) ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Use an HTTPS Jira Cloud site URL such as https://your-team.atlassian.net");
  }
  return url.origin;
}

export function normalizeSlackWebhookUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Slack incoming webhook URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "hooks.slack.com" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    !/^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("Use a valid https://hooks.slack.com/services/... webhook URL");
  }
  return url.toString();
}
