"use client";

import { useState } from "react";
import { Database, ExternalLink, GitBranch, History, MessageSquare, RefreshCw, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage, NoticeBar, useResource, ViewError, ViewLoading, type Notice } from "./shared";

type Provider = "github" | "jira" | "slack";

interface IntegrationSummary {
  provider: Provider;
  configured: boolean;
  maskedSecrets: Record<string, string | null>;
  updatedAt: string | null;
}

interface SyncRun {
  id: string;
  provider: string;
  status: "queued" | "running" | "ok" | "error";
  items: number;
  message: string;
  startedAt: string;
}

interface IntegrationsData {
  canManage: boolean;
  integrations: IntegrationSummary[];
  runs: SyncRun[];
  jiraIssues: { key: string; title: string; status: string; priority: string; url: string }[];
  slackMessages: { ts: string; text: string; user: string; url: string; channel: string }[];
}

interface AuditItem {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

const FIELDS: Record<Provider, { name: string; label: string; type?: string; placeholder: string; optional?: boolean }[]> = {
  github: [
    { name: "repositoryFullName", label: "Repository", placeholder: "owner/name" },
    { name: "personalAccessToken", label: "Personal access token", type: "password", placeholder: "github_pat_…" },
  ],
  jira: [
    { name: "baseUrl", label: "Jira site", placeholder: "https://your-team.atlassian.net" },
    { name: "email", label: "Account email", type: "email", placeholder: "you@company.com" },
    { name: "apiToken", label: "API token", type: "password", placeholder: "Atlassian API token" },
  ],
  slack: [
    { name: "webhookUrl", label: "Incoming webhook URL", type: "password", placeholder: "https://hooks.slack.com/services/…" },
    { name: "botToken", label: "Bot token (optional, to read channels)", type: "password", placeholder: "xoxb-…", optional: true },
    { name: "teamDomain", label: "Workspace slug (optional, for message links)", placeholder: "your-team", optional: true },
  ],
};

const META: Record<Provider, { title: string; icon: React.ReactNode; about: string }> = {
  github: {
    title: "GitHub",
    icon: <GitBranch className="size-4" />,
    about: "Lets the IDE browse and commit to the repository, and adds diff evidence to conflicts.",
  },
  jira: { title: "Jira", icon: <Ticket className="size-4" />, about: "Syncs issues into the workspace graph so commits and conflicts can reference them." },
  slack: {
    title: "Slack",
    icon: <MessageSquare className="size-4" />,
    about: "Posts push updates through an incoming webhook. With a bot token, Sync now also reads public channels and links messages that name files or functions to the code.",
  },
};

export function IntegrationsView() {
  const { state, reload } = useResource<IntegrationsData>("/api/integrations");
  const audit = useResource<{ logs: AuditItem[] }>("/api/integrations/audit-log");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (state.status === "loading") return <ViewLoading label="Loading integrations…" />;
  if (state.status === "error") return <ViewError title="Couldn't load integrations" error={state.error} onRetry={() => reload(false)} />;

  const data = state.data;

  /** Runs an action, shows its result, refreshes; resolves true when it succeeded. */
  const act = async (key: string, run: () => Promise<{ message?: string; ok?: boolean }>): Promise<boolean> => {
    setBusy(key);
    setNotice(null);
    try {
      const r = await run();
      setNotice({ tone: r.ok === false ? "error" : "ok", text: r.message ?? "Done" });
      reload();
      audit.reload();
      return r.ok !== false;
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      <div className="mb-6 border-b border-line pb-4">
        <h1 className="text-[17px] font-semibold text-fg">Integrations</h1>
        <p className="mt-1 text-[13px] text-fg-2">
          Connect the tools your workspace graph reads from. Secrets are stored encrypted and only shown masked.
          {!data.canManage && " Only owners and admins can change connections."}
        </p>
      </div>

      <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {data.integrations.map((it) => (
          <IntegrationCard
            key={it.provider}
            item={it}
            canManage={data.canManage}
            busy={busy}
            onConnect={(values) =>
              act(`${it.provider}:connect`, () => apiFetch(`/api/integrations/${it.provider}`, { method: "POST", body: values }))
            }
            onTest={() => act(`${it.provider}:test`, () => apiFetch(`/api/integrations/${it.provider}/test`, { method: "POST", body: {} }))}
            onSync={() => act(`${it.provider}:sync`, () => apiFetch(`/api/integrations/${it.provider}/sync`, { method: "POST", body: {} }))}
            onToggleAutoMove={(enabled) =>
              void act("jira:automation", () => apiFetch("/api/integrations/jira/automation", { method: "POST", body: { enabled } }))
            }
            onDisconnect={() => {
              if (!window.confirm(`Disconnect ${META[it.provider].title}? Its stored credentials are deleted.`)) return;
              void act(`${it.provider}:remove`, async () => {
                await apiFetch(`/api/integrations/${it.provider}`, { method: "DELETE" });
                return { message: `${META[it.provider].title} disconnected` };
              });
            }}
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel icon={<Ticket className="size-4 text-accent" />} title={`Synced Jira issues (${data.jiraIssues.length})`}>
          {data.jiraIssues.length === 0 ? (
            <Empty>No Jira issues in the graph yet. Connect Jira and run a sync.</Empty>
          ) : (
            <div className="space-y-2">
              {data.jiraIssues.map((i) => (
                <div key={i.key} className="flex items-center justify-between gap-3 rounded border border-line bg-surface-2/60 px-3 py-2">
                  <div className="min-w-0">
                    <span className="mr-2 font-mono text-[12px] font-bold text-accent">{i.key}</span>
                    <span className="text-[12.5px] text-fg">{i.title}</span>
                  </div>
                  <span className="flex shrink-0 items-center gap-2 font-mono text-[10.5px] text-fg-3">
                    {i.status}
                    {i.url && (
                      <a href={i.url} target="_blank" rel="noreferrer" className="hover:text-fg" aria-label={`Open ${i.key} in Jira`}>
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel icon={<MessageSquare className="size-4 text-accent" />} title={`Synced Slack messages (${data.slackMessages.length})`}>
          {data.slackMessages.length === 0 ? (
            <Empty>No Slack messages in the graph yet. Reading channels needs a bot token; run a Slack sync after connecting.</Empty>
          ) : (
            <div className="space-y-2">
              {data.slackMessages.map((m) => (
                <div key={`${m.channel}:${m.ts}`} className="rounded border border-line bg-surface-2/60 p-3 font-mono text-[11.5px] leading-relaxed">
                  <div className="mb-1 flex justify-between text-[10.5px] text-fg-3">
                    <span className="text-accent">#{m.channel}</span>
                    <span>{new Date(Number(m.ts) * 1000).toLocaleString()}</span>
                  </div>
                  {/* Plain text on purpose: Slack content is untrusted. */}
                  <p className="whitespace-pre-wrap break-words text-fg">{m.text}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel icon={<RefreshCw className="size-4 text-accent" />} title="Sync runs">
          {data.runs.length === 0 ? (
            <Empty>No syncs have run yet.</Empty>
          ) : (
            <div className="space-y-1.5 font-mono text-[11.5px]">
              {data.runs.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded bg-surface-2 px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className={r.status === "ok" ? "text-pass" : r.status === "error" ? "text-conflict" : "text-risk"}>{r.status}</span>
                    <span className="text-fg-2">{r.provider}</span>
                    <span className="truncate text-fg-3">{r.message || `${r.items} items`}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-fg-3">{new Date(r.startedAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel icon={<History className="size-4 text-accent" />} title="Audit log">
          {audit.state.status === "loading" && <Empty>Loading…</Empty>}
          {audit.state.status === "error" && <Empty>{audit.state.error.message}</Empty>}
          {audit.state.status === "ready" &&
            (audit.state.data.logs.length === 0 ? (
              <Empty>No audited actions yet.</Empty>
            ) : (
              <div className="space-y-1.5 font-mono text-[11.5px]">
                {audit.state.data.logs.slice(0, 20).map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-3 rounded bg-surface-2 px-3 py-1.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-semibold text-accent">{log.action}</span>
                      <span className="truncate text-fg-2">{log.detail}</span>
                    </span>
                    <span className="shrink-0 text-[10.5px] text-fg-3">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ))}
        </Panel>
      </div>
    </div>
  );
}

function IntegrationCard({
  item,
  canManage,
  busy,
  onConnect,
  onTest,
  onSync,
  onDisconnect,
  onToggleAutoMove,
}: {
  item: IntegrationSummary;
  canManage: boolean;
  busy: string | null;
  onConnect: (values: Record<string, string>) => Promise<boolean>;
  onTest: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onToggleAutoMove?: (enabled: boolean) => void;
}) {
  const meta = META[item.provider];
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const p = item.provider;
  const shown = Object.entries(item.maskedSecrets).filter(([k, v]) => v && k !== "autoTransitionOnCommit");
  const autoMove = item.maskedSecrets.autoTransitionOnCommit === "true";

  return (
    <div className="flex flex-col rounded-lg border border-line bg-surface-1 p-5">
      <div className="mb-3 flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded bg-surface-3 text-accent">{meta.icon}</div>
          <h2 className="text-[14px] font-medium text-fg">{meta.title}</h2>
        </div>
        <span className={`flex items-center gap-1.5 font-mono text-[11px] ${item.configured ? "text-pass" : "text-fg-3"}`}>
          <span className={`size-1.5 rounded-full ${item.configured ? "bg-pass" : "bg-fg-3"}`} />
          {item.configured ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-fg-2">{meta.about}</p>

      {shown.length > 0 && (
        <dl className="mb-3 space-y-1 font-mono text-[11px]">
          {shown.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-fg-3">{k}</dt>
              <dd className="truncate text-fg-2">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {p === "jira" && item.configured && (
        <label className="mb-3 flex items-start gap-2 text-[12px] leading-relaxed text-fg-2">
          <input
            type="checkbox"
            checked={autoMove}
            disabled={!canManage || busy === "jira:automation"}
            onChange={(e) => onToggleAutoMove?.(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Move an issue to <span className="text-fg">In Progress</span> when a pushed commit mentions its key (for example SF-12)
          </span>
        </label>
      )}

      {editing && canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onConnect(values).then((ok) => {
              if (ok) {
                setEditing(false);
                setValues({});
              }
            });
          }}
          className="mt-auto space-y-2"
        >
          {FIELDS[p].map((f) => (
            <label key={f.name} className="block font-mono text-[11px] text-fg-3">
              {f.label}
              <input
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                autoComplete="off"
                required={!f.optional && !(p === "github" && f.name === "personalAccessToken" && item.configured)}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                className="mt-1 w-full rounded border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-fg focus:border-accent focus:outline-none"
              />
            </label>
          ))}
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="primary" type="submit" disabled={busy === `${p}:connect`}>
              {busy === `${p}:connect` ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-auto flex flex-wrap gap-2">
          {canManage && (
            <Button size="sm" variant={item.configured ? "ghost" : "primary"} onClick={() => setEditing(true)}>
              {item.configured ? "Update" : "Connect"}
            </Button>
          )}
          {item.configured && (
            <Button size="sm" variant="ghost" onClick={onTest} disabled={busy === `${p}:test`}>
              {busy === `${p}:test` ? "Testing…" : "Test"}
            </Button>
          )}
          {item.configured && p !== "github" && (
            <Button size="sm" variant="ghost" onClick={onSync} disabled={busy === `${p}:sync`}>
              {busy === `${p}:sync` ? "Starting…" : "Sync now"}
            </Button>
          )}
          {item.configured && canManage && (
            <Button size="sm" variant="ghost" onClick={onDisconnect} className="text-conflict">
              Disconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-5">
      <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
        {icon}
        <h3 className="text-[13.5px] font-medium text-fg">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 font-mono text-[11.5px] text-fg-3">
      <Database className="size-3.5 shrink-0 opacity-50" />
      {children}
    </p>
  );
}
