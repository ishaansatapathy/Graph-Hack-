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

type SyncRun = {
  id: string;
  provider: string;
  status: "running" | "ok" | "error";
  items: number;
  message: string;
  startedAt: string;
  finishedAt: string | null;
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
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [syncing, setSyncing] = useState(false);

  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubWebhookSecret, setGithubWebhookSecret] = useState("");
  const [githubWebhookUrl, setGithubWebhookUrl] = useState("");
  const [jiraBase, setJiraBase] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraAutoTransition, setJiraAutoTransition] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [slackBotToken, setSlackBotToken] = useState("");
  const [slackTeamDomain, setSlackTeamDomain] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.workspace.integrations.list.query({ workspaceId });
      setItems(list as IntegrationRow[]);
      const jira = list.find((item) => item.provider === "jira");
      setJiraAutoTransition(jira?.maskedSecrets.autoTransitionOnCommit === "true");
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const loadRuns = useCallback(async () => {
    try {
      const runs = await trpc.graph.sync.runs.query({ workspaceId, limit: 8 });
      setSyncRuns((runs ?? []) as SyncRun[]);
    } catch {
      /* ignore */
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
    void loadRuns();
  }, [load, loadRuns]);

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

  async function syncToGraph(provider: "jira" | "slack") {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await trpc.graph.sync.trigger.mutate({ workspaceId, provider });
      setMessage({ tone: "ok", text: result?.message ?? `${provider} sync started` });
      // Poll runs after short delay
      setTimeout(() => void loadRuns(), 2000);
      setTimeout(() => void loadRuns(), 6000);
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Sync failed" });
    } finally {
      setSyncing(false);
    }
  }

  async function saveJiraAutomation() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await trpc.workspace.integrations.setJiraCommitAutomation.mutate({
        workspaceId,
        enabled: jiraAutoTransition,
      });
      setMessage({ tone: "ok", text: result.message });
      await load();
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Could not save Jira automation" });
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
          autoTransitionOnCommit: jiraAutoTransition,
        });
        setJiraToken("");
        setMessage({ tone: "ok", text: "Jira saved — click 'Sync to graph' to ingest issues" });
      } else {
        // Build merged config: Slack may optionally have a bot token for full sync
        await trpc.workspace.integrations.upsertSlack.mutate({
          workspaceId,
          webhookUrl: slackWebhook,
          ...(slackBotToken ? { botToken: slackBotToken } : {}),
          ...(slackTeamDomain ? { teamDomain: slackTeamDomain } : {}),
        });
        setSlackWebhook("");
        setSlackBotToken("");
        setMessage({ tone: "ok", text: "Slack saved — add a bot token for full message ingestion" });
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

  const focusRuns = syncRuns.filter((r) => r.provider === focus);

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
            PAT + repo + webhook secret — we register the hook and ingest pushes into FalkorDB as Commit, File, and Function nodes.
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
              Save &amp; register webhook
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
          <p className="app-muted">
            Site URL + email + API token. After saving, click <strong>Sync to graph</strong> to ingest Jira issues as graph nodes.
          </p>
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
          <label className="app-field" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="checkbox"
              checked={jiraAutoTransition}
              onChange={(e) => setJiraAutoTransition(e.target.checked)}
            />
            <span>When a commit explicitly references a Jira key, move that issue to In Progress.</span>
          </label>
          <button
            type="button"
            className="app-btn-ghost"
            disabled={busy || !configured("jira")}
            onClick={() => void saveJiraAutomation()}
          >
            Save automation setting
          </button>
          <div className="app-row-actions">
            <button
              type="button"
              className="app-btn"
              disabled={busy || !jiraBase || !jiraEmail || !jiraToken}
              onClick={() => void save("jira")}
            >
              Save
            </button>
            <button
              type="button"
              className="app-btn"
              disabled={busy || syncing || !configured("jira")}
              onClick={() => void syncToGraph("jira")}
            >
              {syncing ? "Syncing…" : "Sync to graph ↗"}
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("jira")} onClick={() => void runTest("jira")}>
              Test
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("jira")} onClick={() => void disconnect("jira")}>
              Disconnect
            </button>
          </div>
          {focusRuns.length > 0 ? <SyncRunsTable runs={focusRuns} onRefresh={() => void loadRuns()} /> : null}
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
          <p className="app-muted">
            Incoming webhook for test pings. Add a <strong>bot token</strong> (xoxb-…) to enable full message ingestion into FalkorDB.
          </p>
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
          <label className="app-field">
            <span>Bot token (optional — for full sync)</span>
            <input
              className="app-input app-input-block"
              type="password"
              placeholder="xoxb-… (channels:read, channels:history)"
              value={slackBotToken}
              onChange={(e) => setSlackBotToken(e.target.value)}
            />
          </label>
          <label className="app-field">
            <span>Team domain (optional)</span>
            <input
              className="app-input app-input-block"
              placeholder="your-team (for message links)"
              value={slackTeamDomain}
              onChange={(e) => setSlackTeamDomain(e.target.value)}
            />
          </label>
          <div className="app-row-actions">
            <button type="button" className="app-btn" disabled={busy || !slackWebhook} onClick={() => void save("slack")}>
              Save
            </button>
            <button
              type="button"
              className="app-btn"
              disabled={busy || syncing || !configured("slack")}
              onClick={() => void syncToGraph("slack")}
            >
              {syncing ? "Syncing…" : "Sync to graph ↗"}
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("slack")} onClick={() => void runTest("slack")}>
              Test
            </button>
            <button type="button" className="app-btn-ghost" disabled={busy || !configured("slack")} onClick={() => void disconnect("slack")}>
              Disconnect
            </button>
          </div>
          {focusRuns.length > 0 ? <SyncRunsTable runs={focusRuns} onRefresh={() => void loadRuns()} /> : null}
        </article>
      ) : null}
    </div>
  );
}

function SyncRunsTable({ runs, onRefresh }: { runs: SyncRun[]; onRefresh: () => void }) {
  return (
    <div className="app-sync-runs">
      <div className="app-sync-runs-header">
        <span>Recent syncs</span>
        <button type="button" className="app-btn-ghost app-btn-small" onClick={onRefresh}>↻ Refresh</button>
      </div>
      <table className="app-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Items</th>
            <th>Message</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <span className={`app-pill ${r.status === "ok" ? "app-pill--on" : r.status === "error" ? "app-pill--err" : ""}`}>
                  {r.status}
                </span>
              </td>
              <td>{r.items}</td>
              <td className="app-muted">{r.message}</td>
              <td className="app-muted">{new Date(r.startedAt).toLocaleTimeString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
