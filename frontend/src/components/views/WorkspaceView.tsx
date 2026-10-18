"use client";

import { useState } from "react";
import { Cpu, Database, Mail, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, errorMessage, NoticeBar, useResource, ViewError, ViewLoading, type Notice } from "./shared";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

interface WorkspaceData {
  workspace: { id: string; name: string; slug: string; role: "owner" | "admin" | "member" };
  currentUserId: string;
  members: Member[];
  invites: Invite[];
  usage: { totalTokens: number; requestCount: number; byModel: Record<string, number> };
  infrastructure: {
    database: { status: string; latencyMs: number | null };
    graph: { engine: "falkordb" | "embedded"; nodes: number; edges: number };
  };
}

export function WorkspaceView() {
  const { state, reload } = useResource<WorkspaceData>("/api/workspace");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (state.status === "loading") return <ViewLoading label="Loading workspace…" />;
  if (state.status === "error") return <ViewError title="Couldn't load the workspace" error={state.error} onRetry={() => reload(false)} />;

  const data = state.data;
  const canManage = data.workspace.role !== "member";

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiFetch<{ message: string }>("/api/workspace/invite", {
        method: "POST",
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      setNotice({ tone: "ok", text: result.message });
      setInviteEmail("");
      reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const cancelInvite = async (id: string) => {
    try {
      await apiFetch(`/api/workspace/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  };

  const models = Object.entries(data.usage.byModel).sort((a, b) => b[1] - a[1]);
  const db = data.infrastructure.database;
  const graph = data.infrastructure.graph;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold text-fg">{data.workspace.name}</h1>
            <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[11px] uppercase text-accent">
              {data.workspace.role}
            </span>
          </div>
          <p className="mt-1 font-mono text-[12px] text-fg-3">{data.workspace.slug}</p>
        </div>
      </div>

      <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
              <Users className="size-4 text-accent" />
              <h2 className="text-[14px] font-medium text-fg">Members ({data.members.length})</h2>
            </div>
            <div className="divide-y divide-line/60">
              {data.members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-surface-3 font-mono text-[13px] font-bold text-accent">
                      {(m.name || m.email).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-fg">{m.name}</span>
                        {m.userId === data.currentUserId && <span className="text-[11px] text-fg-3">(you)</span>}
                        <span className="rounded bg-surface-2 px-1.5 font-mono text-[10px] uppercase text-fg-3">{m.role}</span>
                      </div>
                      <p className="font-mono text-[11px] text-fg-3">{m.email}</p>
                    </div>
                  </div>
                  <span className="text-[11px] text-fg-3">Joined {new Date(m.joinedAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-3 flex items-center gap-2">
              <UserPlus className="size-4 text-accent" />
              <h2 className="text-[14px] font-medium text-fg">Invite a teammate</h2>
            </div>
            {canManage ? (
              <>
                <p className="mb-3 text-[12.5px] text-fg-2">
                  They get an email invitation. If they already have a Stackfox account, they&apos;re added right away.
                </p>
                <form onSubmit={sendInvite} className="flex flex-wrap gap-2">
                  <input
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="min-w-[220px] flex-1 rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                    required
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
                    aria-label="Role"
                    className="rounded border border-line bg-surface-2 px-2.5 py-2 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                  >
                    <option value="member">Member</option>
                    {data.workspace.role === "owner" && <option value="admin">Admin</option>}
                  </select>
                  <Button size="sm" variant="primary" type="submit" disabled={busy}>
                    {busy ? "Inviting…" : "Send invite"}
                  </Button>
                </form>
              </>
            ) : (
              <p className="text-[12.5px] text-fg-3">Only workspace owners and admins can invite teammates.</p>
            )}

            {data.invites.length > 0 && (
              <div className="mt-4 border-t border-line/60 pt-3">
                <span className="font-mono text-[11px] uppercase tracking-wider text-fg-3">Pending invitations</span>
                <div className="mt-2 space-y-1.5">
                  {data.invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between rounded bg-surface-2 px-3 py-1.5 font-mono text-[11.5px] text-fg-2">
                      <span className="flex items-center gap-2">
                        <Mail className="size-3 text-fg-3" />
                        {inv.email}
                        <span className="text-[10.5px] uppercase text-fg-3">{inv.role}</span>
                      </span>
                      {canManage && (
                        <button onClick={() => void cancelInvite(inv.id)} className="text-fg-3 hover:text-conflict" title="Cancel invite" aria-label={`Cancel invite for ${inv.email}`}>
                          <X className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-3 flex items-center gap-2 border-b border-line pb-2.5">
              <Database className="size-4 text-accent" />
              <h3 className="text-[13.5px] font-medium text-fg">Infrastructure</h3>
            </div>
            <div className="space-y-3 font-mono text-[11.5px]">
              <Row label="Graph engine">
                <span className={graph.engine === "falkordb" ? "text-pass" : "text-risk"}>
                  {graph.engine === "falkordb" ? "FalkorDB" : "Embedded (FalkorDB offline)"}
                </span>
              </Row>
              <Row label="Workspace graph">
                <span className="text-fg-2">
                  {graph.nodes} nodes · {graph.edges} edges
                </span>
              </Row>
              <Row label="Postgres">
                <span className={db.status === "healthy" ? "text-pass" : "text-risk"}>
                  {db.status}
                  {db.latencyMs != null && <span className="text-fg-3"> · {db.latencyMs}ms</span>}
                </span>
              </Row>
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-3 flex items-center gap-2 border-b border-line pb-2.5">
              <Cpu className="size-4 text-accent" />
              <h3 className="text-[13.5px] font-medium text-fg">AI usage</h3>
            </div>
            {data.usage.requestCount === 0 ? (
              <p className="text-[12px] leading-relaxed text-fg-3">No AI requests yet. Usage appears here after GraphRAG questions or conflict reviews.</p>
            ) : (
              <div className="space-y-2 font-mono text-[11.5px]">
                <Row label="Total tokens">
                  <span className="font-bold text-fg">{data.usage.totalTokens.toLocaleString()}</span>
                </Row>
                <Row label="Requests">
                  <span className="text-fg-2">{data.usage.requestCount}</span>
                </Row>
                <div className="mt-2 border-t border-line/60 pt-2 text-[10.5px] text-fg-3">
                  {models.map(([model, tokens]) => (
                    <div key={model} className="flex justify-between py-0.5">
                      <span>{model}</span>
                      <span className="text-fg-2">{tokens.toLocaleString()} tokens</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-3">{label}</span>
      {children}
    </div>
  );
}
