"use client";

import { useCallback, useEffect, useState } from "react";
import { trpc } from "~/lib/trpc";
import { DeploymentsPanel } from "~/components/app/deployments-panel";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
};

type Member = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
};

type Invite = {
  id: string;
  email: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
};

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
};

type HealthData = {
  status: "healthy" | "degraded" | "unhealthy";
  database: {
    status: string;
    latencyMs: number;
    serverTime?: string;
    database?: string;
  };
};

export default function WorkspaceHubPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState<"members" | "apikeys" | "deployments" | "usage" | "health">("members");

  // Members state
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);
  const [memberActionMsg, setMemberActionMsg] = useState("");

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKeySecret, setCreatedKeySecret] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  // AI Usage state
  const [usage, setUsage] = useState<{
    totalTokens: number;
    requestCount: number;
    byModel: Record<string, number>;
  } | null>(null);

  // Health state
  const [health, setHealth] = useState<HealthData | null>(null);
  const [housekeepingRunning, setHousekeepingRunning] = useState(false);
  const [housekeepingReport, setHousekeepingReport] = useState<{
    success: boolean;
    durationMs: number;
    prunedDeviceQuotas: number;
    prunedExpiredInvites: number;
    reapedStaleSyncRuns: number;
    prunedGithubWebhookDeliveries: number;
  } | null>(null);

  const [loading, setLoading] = useState(true);

  // Load current workspace
  useEffect(() => {
    void trpc.workspace.current
      .query({})
      .then((ws) => {
        setWorkspace(ws as Workspace);
      })
      .catch(() => {});
    void trpc.auth.me.query({}).then((user) => setPlatformAdmin(user.role === "admin")).catch(() => {});
  }, []);

  const loadMembers = useCallback(async (wsId: string) => {
    try {
      const data = await trpc.workspace.members.list.query({ workspaceId: wsId });
      setMembers((data.members ?? []) as Member[]);
      setInvites((data.invites ?? []) as Invite[]);
    } catch {
      /* ignore */
    }
  }, []);

  const loadApiKeys = useCallback(async (wsId: string) => {
    try {
      const data = await trpc.workspace.share.listApiKeys.query({ workspaceId: wsId });
      setApiKeys((data ?? []) as ApiKey[]);
    } catch {
      /* ignore */
    }
  }, []);

  const loadUsage = useCallback(async (wsId: string) => {
    try {
      const data = await trpc.workspace.usage.current.query({ workspaceId: wsId });
      setUsage(data as typeof usage);
    } catch {
      /* ignore */
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const data = await trpc.health.getHealth.query({});
      setHealth(data as HealthData);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!workspace) return;
    setLoading(true);
    void Promise.all([
      loadMembers(workspace.id),
      loadApiKeys(workspace.id),
      loadUsage(workspace.id),
      loadHealth(),
    ]).finally(() => setLoading(false));
  }, [workspace, loadMembers, loadApiKeys, loadUsage, loadHealth]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace || !inviteEmail.trim()) return;
    setInviting(true);
    setMemberActionMsg("");
    try {
      const res = await trpc.workspace.members.invite.mutate({
        workspaceId: workspace.id,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setMemberActionMsg(res.message);
      setInviteEmail("");
      await loadMembers(workspace.id);
    } catch (err) {
      setMemberActionMsg(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setInviting(false);
    }
  }

  async function handleCancelInvite(inviteId: string) {
    if (!workspace) return;
    try {
      await trpc.workspace.members.cancelInvite.mutate({
        workspaceId: workspace.id,
        inviteId,
      });
      await loadMembers(workspace.id);
    } catch (err) {
      setMemberActionMsg(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  async function handleRemoveMember(targetUserId: string) {
    if (!workspace || !confirm("Are you sure you want to remove this team member?")) return;
    try {
      await trpc.workspace.members.remove.mutate({
        workspaceId: workspace.id,
        userId: targetUserId,
      });
      await loadMembers(workspace.id);
    } catch (err) {
      setMemberActionMsg(err instanceof Error ? err.message : "Remove failed");
    }
  }

  async function handleCreateApiKey(e: React.FormEvent) {
    e.preventDefault();
    if (!workspace) return;
    setCreatingKey(true);
    try {
      const created = await trpc.workspace.share.createApiKey.mutate({
        workspaceId: workspace.id,
        name: newKeyName.trim() || "API Key",
      });
      setCreatedKeySecret(created.key);
      setNewKeyName("");
      await loadApiKeys(workspace.id);
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleRevokeApiKey(keyId: string) {
    if (!workspace || !confirm("Revoke this API key? Any service using it will be denied.")) return;
    try {
      await trpc.workspace.share.revokeApiKey.mutate({
        workspaceId: workspace.id,
        keyId,
      });
      await loadApiKeys(workspace.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Revoke failed");
    }
  }

  async function handleTriggerHousekeeping() {
    setHousekeepingRunning(true);
    setHousekeepingReport(null);
    try {
      const rep = await trpc.health.runHousekeeping.mutate({});
      setHousekeepingReport(rep);
      await loadHealth();
    } finally {
      setHousekeepingRunning(false);
    }
  }

  if (!workspace) return <p className="app-muted">Loading workspace context…</p>;

  return (
    <div className="workspace-hub">
      {/* ── Workspace Header Card ── */}
      <div className="workspace-header-card">
        <div className="workspace-header-left">
          <div className="workspace-avatar">{workspace.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <h2 className="workspace-title">{workspace.name}</h2>
            <div className="workspace-meta-row">
              <span className="workspace-slug">/{workspace.slug}</span>
              <span className="workspace-role-pill">{workspace.role.toUpperCase()}</span>
              <span className="workspace-plan-pill">PRO PLAN</span>
            </div>
          </div>
        </div>

        <div className="workspace-header-right">
          <code className="workspace-id-badge" title="Workspace UUID">
            ID: {workspace.id.slice(0, 8)}…
          </code>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div className="workspace-nav-tabs">
        <button
          type="button"
          className={`workspace-tab-btn ${activeTab === "members" ? "active" : ""}`}
          onClick={() => setActiveTab("members")}
        >
          👥 Team Members ({members.length})
        </button>
        <button
          type="button"
          className={`workspace-tab-btn ${activeTab === "apikeys" ? "active" : ""}`}
          onClick={() => setActiveTab("apikeys")}
        >
          🔑 API Keys ({apiKeys.length})
        </button>
        <button
          type="button"
          className={`workspace-tab-btn ${activeTab === "usage" ? "active" : ""}`}
          onClick={() => setActiveTab("usage")}
        >
          📊 AI Usage & Spend
        </button>
        <button
          type="button"
          className={`workspace-tab-btn ${activeTab === "deployments" ? "active" : ""}`}
          onClick={() => setActiveTab("deployments")}
        >
          Shared Services
        </button>
        <button
          type="button"
          className={`workspace-tab-btn ${activeTab === "health" ? "active" : ""}`}
          onClick={() => setActiveTab("health")}
        >
          🛡 Infrastructure & Health
        </button>
      </div>

      {/* ── Tab Content ── */}
      <div className="workspace-tab-content">
        {/* ── 1. Team Members & Invites ── */}
        {activeTab === "members" ? (
          <div className="tab-pane">
            <div className="tab-pane-header">
              <div>
                <h3>Workspace Members</h3>
                <p className="app-muted">Manage authorized engineers with access to your graph tools and codebase.</p>
              </div>
            </div>

            {memberActionMsg ? (
              <p className="app-flash app-flash--ok" style={{ marginBottom: "16px" }}>
                {memberActionMsg}
              </p>
            ) : null}

            {/* Invite Form */}
            <form className="workspace-invite-box" onSubmit={handleInvite}>
              <h4>Invite Teammate</h4>
              <div className="invite-inputs">
                <input
                  type="email"
                  className="app-input"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
                <select
                  className="app-select"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" className="app-btn-primary" disabled={inviting}>
                  {inviting ? "Sending…" : "Send Invite"}
                </button>
              </div>
            </form>

            {/* Active Members Table */}
            <div className="workspace-table-card">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Joined</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.userId}>
                      <td>
                        <strong>{m.name}</strong>
                      </td>
                      <td className="app-muted">{m.email}</td>
                      <td>
                        <span className={`role-badge role-${m.role}`}>{m.role}</span>
                      </td>
                      <td className="app-muted" style={{ fontSize: "0.8rem" }}>
                        {new Date(m.joinedAt).toLocaleDateString()}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {m.role !== "owner" && (workspace.role === "owner" || workspace.role === "admin") ? (
                          <button
                            type="button"
                            className="app-btn-ghost app-btn-small"
                            style={{ color: "#f87171" }}
                            onClick={() => void handleRemoveMember(m.userId)}
                          >
                            Remove
                          </button>
                        ) : (
                          <span className="app-muted" style={{ fontSize: "0.75rem" }}>Protected</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pending Invites */}
            {invites.length > 0 ? (
              <div style={{ marginTop: "24px" }}>
                <h4>Pending Invitations ({invites.length})</h4>
                <div className="workspace-table-card">
                  <table className="workspace-table">
                    <thead>
                      <tr>
                        <th>Invited Email</th>
                        <th>Role</th>
                        <th>Invited Date</th>
                        <th style={{ textAlign: "right" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((inv) => (
                        <tr key={inv.id}>
                          <td>{inv.email}</td>
                          <td>
                            <span className="role-badge role-member">{inv.role}</span>
                          </td>
                          <td className="app-muted" style={{ fontSize: "0.8rem" }}>
                            {new Date(inv.createdAt).toLocaleDateString()}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              type="button"
                              className="app-btn-ghost app-btn-small"
                              onClick={() => void handleCancelInvite(inv.id)}
                            >
                              Revoke Invite
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── 2. API Keys Management ── */}
        {activeTab === "apikeys" ? (
          <div className="tab-pane">
            <div className="tab-pane-header">
              <div>
                <h3>Workspace API Keys</h3>
                <p className="app-muted">API keys allow CLI, CI/CD, and MCP agents to access this workspace securely.</p>
              </div>
            </div>

            {createdKeySecret ? (
              <div className="app-flash app-flash--ok" style={{ marginBottom: "16px" }}>
                <strong>Key generated! Copy it now (it won't be shown again):</strong>
                <pre style={{ margin: "8px 0 0", color: "#6ee7b7", wordBreak: "break-all" }}>
                  {createdKeySecret}
                </pre>
              </div>
            ) : null}

            {/* Generate Key Form */}
            <form className="workspace-invite-box" onSubmit={handleCreateApiKey}>
              <h4>Generate New API Key</h4>
              <div className="invite-inputs">
                <input
                  type="text"
                  className="app-input"
                  placeholder="Key name, e.g. GitHub Action Bot"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  required
                />
                <button type="submit" className="app-btn-primary" disabled={creatingKey}>
                  {creatingKey ? "Generating…" : "Create Secret Key"}
                </button>
              </div>
            </form>

            <div className="workspace-table-card">
              <table className="workspace-table">
                <thead>
                  <tr>
                    <th>Key Name</th>
                    <th>Prefix</th>
                    <th>Created At</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "#9ca3af", padding: "20px" }}>
                        No API keys generated yet.
                      </td>
                    </tr>
                  ) : (
                    apiKeys.map((k) => (
                      <tr key={k.id}>
                        <td><strong>{k.name}</strong></td>
                        <td><code>{k.prefix}…</code></td>
                        <td className="app-muted" style={{ fontSize: "0.8rem" }}>
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="app-btn-ghost app-btn-small"
                            style={{ color: "#f87171" }}
                            onClick={() => void handleRevokeApiKey(k.id)}
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "deployments" ? (
          <div className="tab-pane">
            <DeploymentsPanel workspaceId={workspace.id} role={workspace.role} />
          </div>
        ) : null}

        {/* ── 3. AI Usage & Spend ── */}
        {activeTab === "usage" ? (
          <div className="tab-pane">
            <div className="tab-pane-header">
              <div>
                <h3>AI Model Consumption & Spend</h3>
                <p className="app-muted">Live token consumption aggregated across all graph queries and conflict resolutions.</p>
              </div>
            </div>

            <div className="usage-stat-grid">
              <div className="stat-card">
                <span className="stat-label">TOTAL TOKENS</span>
                <span className="stat-value">{(usage?.totalTokens ?? 0).toLocaleString()}</span>
                <span className="stat-sub">Across all workspace requests</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">AI REQUESTS</span>
                <span className="stat-value">{(usage?.requestCount ?? 0).toLocaleString()}</span>
                <span className="stat-sub">GraphRAG + Conflict resolutions</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">ESTIMATED SPEND</span>
                <span className="stat-value">$0.00</span>
                <span className="stat-sub">Enterprise Plan · Included</span>
              </div>
            </div>

            <div style={{ marginTop: "24px" }}>
              <h4>Model Breakdown</h4>
              <div className="workspace-table-card">
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th>Model Provider</th>
                      <th>Task Role</th>
                      <th>Tokens Consumed</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><code>gemini-2.5-flash</code></td>
                      <td>Fast Graph Traversal & Search</td>
                      <td>{(usage?.byModel?.["gemini-2.5-flash"] ?? 0).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td><code>gemini-2.5-pro</code></td>
                      <td>Multi-file Conflict Resolution</td>
                      <td>{(usage?.byModel?.["gemini-2.5-pro"] ?? 0).toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {/* ── 4. Infrastructure & Health ── */}
        {activeTab === "health" ? (
          <div className="tab-pane">
            <div className="tab-pane-header">
              <div>
                <h3>Database & Infrastructure Diagnostics</h3>
                <p className="app-muted">Real-time health monitoring of Neon PostgreSQL and FalkorDB graph engine.</p>
              </div>
            </div>

            <div className="usage-stat-grid">
              <div className="stat-card">
                <span className="stat-label">POSTGRESQL STATUS</span>
                <span className="stat-value" style={{ color: health?.database?.status === "healthy" ? "#34d399" : "#fbbf24" }}>
                  {health?.database?.status?.toUpperCase() ?? "CHECKING…"}
                </span>
                <span className="stat-sub">Neon Serverless (WebSocket Pool)</span>
              </div>

              <div className="stat-card">
                <span className="stat-label">QUERY LATENCY</span>
                <span className="stat-value">{health?.database?.latencyMs ?? "--"} ms</span>
                <span className="stat-sub">Round-trip database ping</span>
              </div>

              <div className="stat-card">
                <span className="stat-label">DATABASE INSTANCE</span>
                <span className="stat-value" style={{ fontSize: "1.2rem" }}>
                  {health?.database?.database ?? "neondb"}
                </span>
                <span className="stat-sub">PostgreSQL 16 · AWS us-east-2</span>
              </div>
            </div>

            {platformAdmin ? <>
            <div className="workspace-invite-box" style={{ marginTop: "24px" }}>
              <h4>Automated Database Housekeeping</h4>
              <p className="app-muted" style={{ fontSize: "0.85rem", margin: "4px 0 12px" }}>
                Cleans expired rate-limit fingerprints older than 7 days, prunes dead invitation tokens,
                and terminates zombie sync runs.
              </p>
              <button
                type="button"
                className="app-btn-primary"
                onClick={() => void handleTriggerHousekeeping()}
                disabled={housekeepingRunning}
              >
                {housekeepingRunning ? "Running Housekeeping Queries…" : "▶ Trigger Database Retention Cleanup"}
              </button>

              {housekeepingReport ? (
                <div className="app-flash app-flash--ok" style={{ marginTop: "12px" }}>
                  ✓ Housekeeping complete in {housekeepingReport.durationMs}ms:
                  <ul style={{ margin: "6px 0 0", paddingLeft: "20px", fontSize: "0.85rem" }}>
                    <li>Pruned {housekeepingReport.prunedDeviceQuotas} expired rate-limit buckets</li>
                    <li>Pruned {housekeepingReport.prunedExpiredInvites} expired invites</li>
                    <li>Reaped {housekeepingReport.reapedStaleSyncRuns} stale sync runs</li>
                    <li>Pruned {housekeepingReport.prunedGithubWebhookDeliveries} old GitHub delivery records</li>
                  </ul>
                </div>
              ) : null}
            </div>
            </> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
