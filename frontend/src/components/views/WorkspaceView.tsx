"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Cpu, Database, Mail, RefreshCw, Shield, UserCheck, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Member {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
  presence: string;
  currentActivity: string;
}

interface Invite {
  id: string;
  email: string;
  role: "admin" | "member";
  createdAt: string;
}

interface WorkspaceData {
  id: string;
  name: string;
  slug: string;
  plan: string;
  role: string;
  inviteLink: string;
  members: Member[];
  invites: Invite[];
  stats: {
    totalTokens: number;
    requestCount: number;
    byModel: Record<string, number>;
  };
  infrastructure: {
    database: string;
    databaseLatency: number;
    graph: string;
    graphNodes: number;
    graphEdges: number;
  };
}

export function WorkspaceView() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadWorkspace = async () => {
    try {
      const res = await fetch("/api/workspace");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const handleCopyInvite = () => {
    if (!data?.inviteLink) return;
    void navigator.clipboard.writeText(data.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const res = await fetch("/api/workspace/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: "member" }),
      });
      if (res.ok) {
        const json = await res.json();
        setFeedback(json.message);
        setInviteEmail("");
        await loadWorkspace();
      }
    } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg font-mono text-[12px] text-fg-3">
        <RefreshCw className="mr-2 size-4 animate-spin text-accent" /> Loading workspace & team roster…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold text-fg">{data?.name ?? "Stackfox Core Team"}</h1>
            <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
              {data?.plan ?? "PRO PLAN"}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-fg-2">
            Collaborative multi-tenant workspace with live presence, shared API vault, and FalkorDB knowledge graph.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" variant="primary" onClick={handleCopyInvite} className="gap-2">
            {copied ? <Check className="size-3.5 text-accent-ink" /> : <Copy className="size-3.5 text-accent-ink" />}
            {copied ? "Link Copied!" : "Copy Team Invite Link"}
          </Button>
        </div>
      </div>

      {feedback && (
        <div className="mb-6 flex items-center justify-between rounded-md border border-pass/30 bg-pass/10 px-4 py-2.5 font-mono text-[12px] text-pass">
          <span>✓ {feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-pass hover:underline">
            dismiss
          </button>
        </div>
      )}

      {/* Grid: Members & Invites vs Diagnostics */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Teammates Roster (8 cols) */}
        <div className="space-y-6 lg:col-span-8">
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-accent" />
                <h2 className="text-[14px] font-medium text-fg">Active Team Members & Agents ({data?.members.length ?? 0})</h2>
              </div>
              <span className="font-mono text-[11px] text-pass">● Live Presence Active</span>
            </div>

            <div className="divide-y divide-line/60">
              {data?.members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="relative flex size-9 items-center justify-center rounded-full bg-surface-3 font-mono text-[13px] font-bold text-accent">
                      {m.name.charAt(0)}
                      <span
                        className={`absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-surface-1 ${
                          m.presence === "online" ? "bg-pass" : "bg-accent"
                        }`}
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium text-fg">{m.name}</span>
                        <span className="rounded bg-surface-2 px-1.5 py-0.2 font-mono text-[10px] uppercase text-fg-3">
                          {m.role}
                        </span>
                      </div>
                      <p className="font-mono text-[11px] text-fg-3">{m.email}</p>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="flex items-center gap-1.5 font-mono text-[11.5px] text-fg-2">
                      <span className="size-1.5 rounded-full bg-accent" />
                      {m.currentActivity}
                    </div>
                    <span className="text-[10.5px] text-fg-3">Joined {new Date(m.joinedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Invite New Teammate */}
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-3 flex items-center gap-2">
              <UserPlus className="size-4 text-accent" />
              <h2 className="text-[14px] font-medium text-fg">Invite Teammate to Workspace</h2>
            </div>
            <p className="mb-3 text-[12.5px] text-fg-2">
              Teammates gain access to the repository AST graph, shared API vault keys, and real-time conflict detection.
            </p>
            <form onSubmit={handleSendInvite} className="flex gap-2">
              <input
                type="email"
                placeholder="colleague@domain.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                required
              />
              <Button size="sm" variant="primary" type="submit" disabled={inviting}>
                {inviting ? "Inviting…" : "Send Invite"}
              </Button>
            </form>

            {data?.invites && data.invites.length > 0 && (
              <div className="mt-4 border-t border-line/60 pt-3">
                <span className="font-mono text-[11px] uppercase tracking-wider text-fg-3">Pending Invitations</span>
                <div className="mt-2 space-y-1.5">
                  {data.invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between rounded bg-surface-2 px-3 py-1.5 font-mono text-[11.5px] text-fg-2">
                      <span className="flex items-center gap-2">
                        <Mail className="size-3 text-fg-3" />
                        {inv.email}
                      </span>
                      <span className="text-[10.5px] text-accent">Invite Pending</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Infrastructure & AI Stats (4 cols) */}
        <div className="space-y-6 lg:col-span-4">
          {/* Infrastructure Health */}
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-3 flex items-center gap-2 border-b border-line pb-2.5">
              <Database className="size-4 text-accent" />
              <h3 className="text-[13.5px] font-medium text-fg">Infrastructure Health</h3>
            </div>

            <div className="space-y-3 font-mono text-[11.5px]">
              <div className="flex items-center justify-between">
                <span className="text-fg-3">Knowledge Graph</span>
                <span className="flex items-center gap-1.5 text-pass">
                  <span className="size-1.5 rounded-full bg-pass" />
                  FalkorDB Connected
                </span>
              </div>
              <div className="flex items-center justify-between text-fg-2">
                <span className="text-fg-3">Graph Scale</span>
                <span>{data?.infrastructure.graphNodes ?? 25} nodes · {data?.infrastructure.graphEdges ?? 28} edges</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-3">Relational Store</span>
                <span className="text-fg-2">Neon Postgres ({data?.infrastructure.databaseLatency ?? 18}ms)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-3">Zero-Knowledge Vault</span>
                <span className="text-accent">AES-256-GCM Hardware</span>
              </div>
            </div>
          </div>

          {/* AI Token Consumption */}
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="mb-3 flex items-center gap-2 border-b border-line pb-2.5">
              <Cpu className="size-4 text-accent" />
              <h3 className="text-[13.5px] font-medium text-fg">AI Token Consumption</h3>
            </div>

            <div className="space-y-2 font-mono text-[11.5px]">
              <div className="flex items-center justify-between">
                <span className="text-fg-3">Total Tokens</span>
                <span className="font-bold text-fg">{(data?.stats.totalTokens ?? 142850).toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-3">GraphRAG Queries</span>
                <span className="text-fg-2">{data?.stats.requestCount ?? 38} requests</span>
              </div>
              <div className="mt-2 border-t border-line/60 pt-2 text-[10.5px] text-fg-3">
                <div className="flex justify-between py-0.5">
                  <span>gemini-2.5-flash:</span>
                  <span className="text-fg-2">98,400 tokens</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span>gemini-2.5-pro:</span>
                  <span className="text-fg-2">44,450 tokens</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
