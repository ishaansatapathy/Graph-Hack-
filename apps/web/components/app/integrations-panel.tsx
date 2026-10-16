"use client";

import { useCallback, useEffect, useState } from "react";

import { trpc } from "~/lib/trpc";

type Provider = "github" | "jira" | "slack";

type IntegrationRow = {
  provider: Provider;
  configured: boolean;
  maskedSecrets: Record<string, string | null>;
  updatedAt: string | null;
};

const PROVIDER_TITLES: Record<Provider, string> = {
  github: "GitHub",
  jira: "Jira",
  slack: "Slack",
};

type Props = {
  workspaceId: string;
  focus: Provider;
};

export function IntegrationsPanel({ workspaceId, focus }: Props) {
  const [items, setItems] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubWebhookSecret, setGithubWebhookSecret] = useState("");
  const [githubWebhookUrl, setGithubWebhookUrl] = useState("");
  const [jiraBase, setJiraBase] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.workspace.integrations.list.query({ workspaceId });
      setItems(list as IntegrationRow[]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void trpc.workspace.integrations.githubOnboarding
      .query({ workspaceId })
      .then((data) => setGithubWebhookUrl(data.webhookUrl))
      .catch(() => setGithubWebhookUrl(""));
  }, [workspaceId]);

  const configured = (p: Provider) => items.find((i) => i.provider === p)?.configured ?? false;

  async function runTest(provider: Provider) {
    setBusy(true);
    setMessage(null);
    try {
      const fn =
        provider === "github"
          ? trpc.workspace.integrations.testGithub.mutate
          : provider === "jira"
            ? trpc.workspace.integrations.testJira.mutate
            : trpc.workspace.integrations.testSlack.mutate;
      const result = await fn({ workspaceId });
      setMessage({ tone: result.ok ? "ok" : "err", text: result.message });
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setBusy(false);
    }
  }

  async function save(provider: Provider) {
    setBusy(true);
    setMessage(null);
    try {
      if (provider === "github") {
        const result = await trpc.workspace.integrations.upsertGithub.mutate({
          workspaceId,
          personalAccessToken: githubToken || undefined,
          repositoryFullName: githubRepo || undefined,
          webhookSecret: githubWebhookSecret || undefined,
          registerWebhook: true,
        });
        setGithubToken("");
        setGithubWebhookSecret("");
        setMessage({
          tone: "ok",
          text: result.webhookRegistration?.message ?? result.message,
        });
      } else if (provider === "jira") {
        await trpc.workspace.integrations.upsertJira.mutate({
          workspaceId,
          baseUrl: jiraBase,
          email: jiraEmail,
          apiToken: jiraToken,
        });
        setJiraToken("");
      } else {
        await trpc.workspace.integrations.upsertSlack.mutate({
          workspaceId,
          webhookUrl: slackWebhook,
        });
        setSlackWebhook("");
      }
      if (provider !== "github") {
        setMessage({ tone: "ok", text: `${PROVIDER_TITLES[provider]} saved` });
      }
      await load();
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(provider: Provider) {
    setBusy(true);
    setMessage(null);
    try {
      await trpc.workspace.integrations.remove.mutate({ workspaceId, provider });
      setMessage({ tone: "ok", text: "Disconnected" });
      await load();
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Remove failed" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="app-muted">Loading integrations…</p>;
  }

  return (
    <div className="app-integrations">
      {message ? (
        <p className={`app-flash app-flash--${message.tone}`} role="status">{message.text}</p>
      ) : null}

      {focus === "github" ? (
        <article className="app-integration-card">
          <header>
            <h3>GitHub</h3>
            <span className={`app-pill ${configured("github") ? "app-pill--on" : ""}`}>
              {configured("github") ? "Connected" : "Not connected"}
            </span>
          </header>
          <p className="app-muted">
            Evolvex-style: PAT + repo + webhook secret — we register the hook and ingest pushes to FalkorDB.
          </p>
          {githubWebhookUrl ? (
            <p className="app-webhook-url">
              Webhook URL: <code>{githubWebhookUrl}</code>
            </p>
          ) : null}
          <label className="app-field">
            <span>Repository (owner/repo)</span>
            <input
              className="app-input app-input-block"
              placeholder="acme/payments-api"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
            />
          </label>
          <label className="app-field">
            <span>Webhook secret</span>
            <input
              className="app-input app-input-block"
              type="password"
              placeholder="random-secret-for-hmac"
              value={githubWebhookSecret}
              onChange={(e) => setGithubWebhookSecret(e.target.value)}
            />
          </label>
          <label className="app-field">
            <span>Personal access token</span>
            <input
              className="app-input app-input-block"
              type="password"
              placeholder="ghp_… (repo + admin:repo_hook)"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
            />
          </label>
          <div className="app-row-actions">
            <button
              type="button"
              className="app-btn"
              disabled={busy || (!githubToken && !configured("github")) || !githubRepo || !githubWebhookSecret}
              onClick={() => void save("github")}
            >
              Save & register webhook
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("github")} onClick={() => void runTest("github")}>
              Test
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("github")} onClick={() => void disconnect("github")}>
              Disconnect
            </button>
          </div>
        </article>
      ) : null}

      {focus === "jira" ? (
        <article className="app-integration-card">
          <header>
            <h3>Jira Cloud</h3>
            <span className={`app-pill ${configured("jira") ? "app-pill--on" : ""}`}>
              {configured("jira") ? "Connected" : "Not connected"}
            </span>
          </header>
          <p className="app-muted">Site URL + email + API token (Atlassian account settings).</p>
          <label className="app-field">
            <span>Site URL</span>
            <input
              className="app-input app-input-block"
              placeholder="https://your-domain.atlassian.net"
              value={jiraBase}
              onChange={(e) => setJiraBase(e.target.value)}
            />
          </label>
          <label className="app-field">
            <span>Email</span>
            <input
              className="app-input app-input-block"
              type="email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
            />
          </label>
          <label className="app-field">
            <span>API token</span>
            <input
              className="app-input app-input-block"
              type="password"
              value={jiraToken}
              onChange={(e) => setJiraToken(e.target.value)}
            />
          </label>
          <div className="app-row-actions">
            <button
              type="button"
              className="app-btn"
              disabled={busy || !jiraBase || !jiraEmail || !jiraToken}
              onClick={() => void save("jira")}
            >
              Save
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("jira")} onClick={() => void runTest("jira")}>
              Test
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("jira")} onClick={() => void disconnect("jira")}>
              Disconnect
            </button>
          </div>
        </article>
      ) : null}

      {focus === "slack" ? (
        <article className="app-integration-card">
          <header>
            <h3>Slack</h3>
            <span className={`app-pill ${configured("slack") ? "app-pill--on" : ""}`}>
              {configured("slack") ? "Connected" : "Not connected"}
            </span>
          </header>
          <p className="app-muted">Incoming webhook URL for progress posts (Evolvex-style test message).</p>
          <label className="app-field">
            <span>Webhook URL</span>
            <input
              className="app-input app-input-block"
              type="url"
              placeholder="https://hooks.slack.com/services/…"
              value={slackWebhook}
              onChange={(e) => setSlackWebhook(e.target.value)}
            />
          </label>
          <div className="app-row-actions">
            <button type="button" className="app-btn" disabled={busy || !slackWebhook} onClick={() => void save("slack")}>
              Save
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("slack")} onClick={() => void runTest("slack")}>
              Test
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("slack")} onClick={() => void disconnect("slack")}>
              Disconnect
            </button>
          </div>
        </article>
      ) : null}
    </div>
  );
}
