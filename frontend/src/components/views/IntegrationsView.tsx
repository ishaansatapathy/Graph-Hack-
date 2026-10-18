"use client";

import { useEffect, useState } from "react";
import { Check, CheckCircle2, Database, GitBranch, GitCommit, History, MessageSquare, RefreshCw, Send, ShieldCheck, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";

interface JiraTask {
  id: string;
  title: string;
  assignee: string;
  status: string;
  linkedBranch: string;
  graphLinkedNodes: string[];
}

interface SlackAlert {
  id: string;
  channel: string;
  text: string;
  timestamp: string;
}

interface AuditLogItem {
  id: string;
  action: string;
  detail: string;
  createdAt: string;
}

interface IntegrationsData {
  jira: {
    connected: boolean;
    configuredInDb?: boolean;
    projectKey: string;
    autoTransitionOnCommit: boolean;
    tasks: JiraTask[];
  };
  slack: {
    connected: boolean;
    configuredInDb?: boolean;
    channel: string;
    alerts: SlackAlert[];
  };
  github: {
    connected: boolean;
    repo: string;
    branch: string;
    openPrCount: number;
  };
}

export function IntegrationsView() {
  const [data, setData] = useState<IntegrationsData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Slack live testing state
  const [showSlackTest, setShowSlackTest] = useState(false);
  const [testWebhookUrl, setTestWebhookUrl] = useState("");
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [res, auditRes] = await Promise.all([
        fetch("/api/integrations"),
        fetch("/api/integrations/audit-log"),
      ]);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
      if (auditRes.ok) {
        const auditJson = await auditRes.json();
        setAuditLogs(auditJson.logs ?? []);
      }
    } catch {
      // fallback handled gracefully
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const triggerCommitSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/integrations/commit-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sha: "8b7f1a3",
          commitMessage: "fix(billing): read primaryEmail with fallback (closes #STACK-42)",
          author: "Agent B",
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setSyncResult(json.message);
        await loadData();
      }
    } catch {
      setSyncResult("Failed to dispatch commit sync");
    } finally {
      setSyncing(false);
    }
  };

  const handleTestSlack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testWebhookUrl.trim()) return;
    setTestingSlack(true);
    setSlackTestResult(null);
    try {
      const res = await fetch("/api/integrations/slack/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: testWebhookUrl.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setSlackTestResult(json.message ?? "Slack test message dispatched!");
        await loadData();
      } else {
        setSlackTestResult(`Error: ${json.error ?? "Failed to reach Slack"}`);
      }
    } catch (err) {
      setSlackTestResult(err instanceof Error ? err.message : "Error testing Slack");
    } finally {
      setTestingSlack(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg font-mono text-[12px] text-fg-3">
        <RefreshCw className="mr-2 size-4 animate-spin text-accent" /> Loading integrations & FalkorDB sync pipeline…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      {/* Header Banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold text-fg">Jira & Slack AST Synchronizer</h1>
            <span className="rounded border border-pass/30 bg-pass/10 px-2 py-0.5 font-mono text-[11px] text-pass">
              Active Sync Engine
            </span>
          </div>
          <p className="mt-1 text-[13px] text-fg-2">
            FalkorDB automatically transitions Jira issues, validates pull requests, and alerts Slack on AST contract drift.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="primary"
            onClick={() => void triggerCommitSync()}
            disabled={syncing}
            className="gap-2"
          >
            {syncing ? <RefreshCw className="size-3.5 animate-spin" /> : <GitCommit className="size-3.5 text-accent-ink" />}
            Simulate Git Commit (closes #STACK-42)
          </Button>
        </div>
      </div>

      {syncResult && (
        <div className="mb-6 flex items-center justify-between rounded-md border border-pass/30 bg-pass/10 px-4 py-2.5 font-mono text-[12px] text-pass">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4" />
            {syncResult}
          </span>
          <span className="text-[11px] opacity-75">FalkorDB graph updated · STACK-42 transitioned</span>
        </div>
      )}

      {/* Grid: Jira & Slack */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Jira Panel */}
        <div className="flex flex-col rounded-lg border border-line bg-surface-1 p-5">
          <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded bg-blue-500/20 text-blue-400">
                <Ticket className="size-4" />
              </div>
              <div>
                <h2 className="text-[14px] font-medium text-fg">Jira Cloud Workspace</h2>
                <p className="font-mono text-[11px] text-fg-3">Project: {data?.jira.projectKey ?? "STACK"} (Checkout Service)</p>
              </div>
            </div>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-pass">
              <span className="size-1.5 rounded-full bg-pass" />
              Connected
            </span>
          </div>

          <div className="mb-4 flex items-center justify-between rounded border border-line bg-surface-2 px-3 py-2 text-[12px]">
            <span className="text-fg-2">Auto-transition Jira issues on Git commit</span>
            <span className="font-mono text-[11px] font-semibold text-accent">ENABLED</span>
          </div>

          <div className="space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-3">Tracked Sprint Tasks</p>
            {data?.jira.tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-md border border-line bg-surface-2/60 p-3.5 transition-colors hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-bold text-accent">{task.id}</span>
                    <span className="text-[13px] font-medium text-fg">{task.title}</span>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-[10.5px] font-medium ${
                      task.status === "DONE"
                        ? "border border-pass/30 bg-pass/10 text-pass"
                        : "border border-accent/30 bg-accent/10 text-accent"
                    }`}
                  >
                    {task.status}
                  </span>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-3 font-mono text-[11px] text-fg-3">
                  <span className="flex items-center gap-1 text-fg-2">
                    <GitBranch className="size-3 text-fg-3" />
                    {task.linkedBranch}
                  </span>
                  <span>Assignee: {task.assignee}</span>
                  <span className="text-fg-3">Graph nodes: {task.graphLinkedNodes.join(", ")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Slack Panel */}
        <div className="flex flex-col rounded-lg border border-line bg-surface-1 p-5">
          <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-7 items-center justify-center rounded bg-amber-500/20 text-amber-400">
                <MessageSquare className="size-4" />
              </div>
              <div>
                <h2 className="text-[14px] font-medium text-fg">Slack Bot & Channel Stream</h2>
                <p className="font-mono text-[11px] text-fg-3">Target: {data?.slack.channel ?? "#eng-checkout-team"}</p>
              </div>
            </div>
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-pass">
              <span className="size-1.5 rounded-full bg-pass" />
              Live Bot
            </span>
          </div>

          <div className="mb-4 flex items-center justify-between rounded border border-line bg-surface-2 px-3 py-2 text-[12px]">
            <span className="text-fg-2">Real-time alerts on AST contract breaks</span>
            <span className="font-mono text-[11px] font-semibold text-accent">ACTIVE</span>
          </div>

          <div className="flex flex-1 flex-col space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-3">Recent Bot Dispatches</p>
            <div className="flex-1 space-y-2.5">
              {data?.slack.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-md border border-line bg-surface-2/60 p-3 font-mono text-[11.5px] leading-relaxed text-fg-2"
                >
                  <div className="mb-1 flex items-center justify-between text-[10.5px] text-fg-3">
                    <span className="text-accent">{alert.channel}</span>
                    <span>{new Date(alert.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-fg" dangerouslySetInnerHTML={{
                    __html: alert.text
                      .replace(/\*(.*?)\*/g, "<strong>$1</strong>")
                      .replace(/`(.*?)`/g, "<code class='bg-surface-3 px-1 py-0.5 rounded text-accent'>$1</code>")
                  }} />
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-col gap-2 rounded border border-line bg-surface-2 p-3 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium text-fg">
                  <Send className="size-3.5 text-accent" />
                  Live Slack Webhook Dispatch
                </span>
                <button
                  type="button"
                  onClick={() => setShowSlackTest(!showSlackTest)}
                  className="font-mono text-[11px] text-accent hover:underline"
                >
                  {showSlackTest ? "Hide Test Form" : "Test Incoming Webhook"}
                </button>
              </div>

              {showSlackTest && (
                <form onSubmit={handleTestSlack} className="mt-2 space-y-2 border-t border-line/60 pt-2">
                  <input
                    type="url"
                    value={testWebhookUrl}
                    onChange={(e) => setTestWebhookUrl(e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                    className="w-full rounded border border-line bg-surface-1 px-2.5 py-1.5 font-mono text-[11.5px] text-fg focus:border-accent focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    <Button
                      type="submit"
                      size="sm"
                      variant="primary"
                      disabled={testingSlack || !testWebhookUrl.trim()}
                      className="gap-1.5"
                    >
                      {testingSlack ? <RefreshCw className="size-3 animate-spin" /> : <Send className="size-3" />}
                      Dispatch Live Test Message
                    </Button>
                    {slackTestResult && (
                      <span className="font-mono text-[11px] text-accent">{slackTestResult}</span>
                    )}
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* PostgreSQL Audit Log Trail */}
      <div className="mt-6 rounded-lg border border-line bg-surface-1 p-5">
        <div className="mb-3 flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Database className="size-4 text-accent" />
            <h3 className="text-[13.5px] font-medium text-fg">Neon PostgreSQL Audit Trail (Live DB)</h3>
          </div>
          <span className="font-mono text-[11px] text-fg-3">{auditLogs.length} events recorded</span>
        </div>

        {auditLogs.length > 0 ? (
          <div className="space-y-2 font-mono text-[11.5px]">
            {auditLogs.map((log) => (
              <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-surface-2 px-3 py-2 text-fg-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-accent">{log.action}</span>
                  <span className="text-fg-3">·</span>
                  <span className="truncate max-w-md text-fg">{log.detail}</span>
                </div>
                <span className="text-fg-3 text-[10.5px]">{new Date(log.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[11.5px] text-fg-3">No audit events recorded yet. Trigger a commit sync to record the first event in Neon DB.</p>
        )}
      </div>

      {/* GitHub & FalkorDB Pipeline Status */}
      <div className="mt-6 rounded-lg border border-line bg-surface-1 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-pass" />
            <div>
              <h3 className="text-[13.5px] font-medium text-fg">GitHub Webhook Pipeline (FalkorDB Synced)</h3>
              <p className="font-mono text-[11.5px] text-fg-3">
                Repository: {data?.github.repo ?? "acme/checkout-service"} · Branch: {data?.github.branch ?? "main"} · Open PRs: {data?.github.openPrCount ?? 3}
              </p>
            </div>
          </div>
          <span className="font-mono text-[11px] text-fg-2">Synced via Express /trpc & /webhooks/github</span>
        </div>
      </div>
    </div>
  );
}
