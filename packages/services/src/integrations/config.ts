import { env } from "../env";

export function getApiPublicUrl() {
  const fromEnv = env.API_PUBLIC_URL?.trim() || process.env.API_INTERNAL_URL?.trim();
  return (fromEnv || "http://localhost:8000").replace(/\/+$/, "");
}

export function githubWebhookUrl(workspaceId: string) {
  return `${getApiPublicUrl()}/webhooks/github?workspaceId=${encodeURIComponent(workspaceId)}`;
}
