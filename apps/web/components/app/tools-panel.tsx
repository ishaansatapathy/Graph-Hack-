"use client";

import { useCallback, useEffect, useState } from "react";

import { trpc } from "~/lib/trpc";

type Kind = "query_graph" | "find_callers" | "graph_stats";

type Tool = {
  id: string;
  name: string;
  kind: Kind;
  description: string;
  visibility: "private" | "workspace";
  version: number;
  revoked: boolean;
  ownedByMe: boolean;
  updatedAt: string;
};

type Catalog = Record<string, { label: string; description: string; inputHint: string }>;

type AuditRow = { id: string; action: string; detail: string; createdAt: string };

export function ToolsPanel({ workspaceId }: { workspaceId: string }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({});
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [kind, setKind] = useState<Kind>("query_graph");
  const [name, setName] = useState("Graph query");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [callArgs, setCallArgs] = useState<Record<string, string>>({});
  const [callOut, setCallOut] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await trpc.workspace.tools.list.query({ workspaceId });
      setTools(res.tools as Tool[]);
      setCatalog(res.catalog as Catalog);
      setAudit((await trpc.workspace.tools.audit.query({ workspaceId })) as AuditRow[]);
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Load failed" });
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, okText?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (okText) setMessage({ tone: "ok", text: okText });
      await load();
    } catch (err) {
      setMessage({ tone: "err", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  async function callTool(tool: Tool) {
    setBusy(true);
    try {
      const raw = callArgs[tool.id]?.trim() || "{}";
      const args = JSON.parse(raw) as Record<string, unknown>;
      const res = await trpc.workspace.tools.execute.mutate({ workspaceId, toolId: tool.id, args });
      setCallOut((o) => ({
        ...o,
        [tool.id]: `// ${res.cypher}\n${JSON.stringify(res.rows, null, 2)}`,
      }));
    } catch (err) {
      setCallOut((o) => ({ ...o, [tool.id]: err instanceof Error ? err.message : "Call failed" }));
    } finally {
      setBusy(false);
      void load();
    }
  }

  return (
    <div className="app-share">
      <p className="app-muted">
        Shareable MCP-style graph tools. Private by default — share with your workspace, revoke any time. Every call is
        permission-checked and audited; shared tools never expose your credentials.
      </p>

      {message ? <p className={`app-flash app-flash--${message.tone}`}>{message.text}</p> : null}

      <div className="app-ask-form">
        <select
          className="app-input"
          value={kind}
          onChange={(e) => {
            const k = e.target.value as Kind;
            setKind(k);
            setName(k);
          }}
        >
          {Object.keys(catalog).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tool name" />
        <button
          type="button"
          className="app-btn"
          disabled={busy || !name.trim()}
          onClick={() => void run(() => trpc.workspace.tools.create.mutate({ workspaceId, name, kind }), "Tool created (private)")}
        >
          Add tool
        </button>
      </div>

      <ul className="app-key-list app-tool-list">
        {tools.map((t) => (
          <li key={t.id} className="app-tool-item">
            <div className="app-tool-head">
              <strong>{t.name}</strong>
              <code>{t.kind}</code>
              <span className={`app-pill ${t.visibility === "workspace" ? "app-pill--on" : ""}`}>
                {t.revoked ? "Revoked" : t.visibility === "workspace" ? "Shared" : "Private"}
              </span>
              <span className="app-muted">v{t.version}</span>
              {t.ownedByMe && !t.revoked ? (
                <span className="app-tool-actions">
                  <button
                    type="button"
                    className="app-btn app-btn-small"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        trpc.workspace.tools.setVisibility.mutate({
                          workspaceId,
                          toolId: t.id,
                          visibility: t.visibility === "workspace" ? "private" : "workspace",
                        }),
                      )
                    }
                  >
                    {t.visibility === "workspace" ? "Make private" : "Share"}
                  </button>
                  <button
                    type="button"
                    className="app-btn-ghost app-btn-small"
                    disabled={busy}
                    onClick={() => void run(() => trpc.workspace.tools.revoke.mutate({ workspaceId, toolId: t.id }), "Tool revoked")}
                  >
                    Revoke
                  </button>
                </span>
              ) : null}
            </div>
            <p className="app-muted">
              {t.description}
              {!t.ownedByMe ? " · shared by a teammate" : ""}
            </p>
            {!t.revoked ? (
              <div className="app-ask-form">
                <input
                  className="app-input"
                  placeholder={catalog[t.kind]?.inputHint ?? "{}"}
                  value={callArgs[t.id] ?? ""}
                  onChange={(e) => setCallArgs((a) => ({ ...a, [t.id]: e.target.value }))}
                />
                <button type="button" className="app-btn app-btn-small" disabled={busy} onClick={() => void callTool(t)}>
                  Call
                </button>
              </div>
            ) : null}
            {callOut[t.id] ? <pre className="app-cypher">{callOut[t.id]}</pre> : null}
          </li>
        ))}
        {tools.length === 0 ? <li className="app-muted">No tools yet — add one above.</li> : null}
      </ul>

      <h3 className="app-section-title">Audit log</h3>
      <ul className="app-key-list">
        {audit.map((a) => (
          <li key={a.id}>
            <span>{a.action}</span>
            <span className="app-muted">{a.detail}</span>
            <code>{new Date(a.createdAt).toLocaleTimeString()}</code>
          </li>
        ))}
        {audit.length === 0 ? <li className="app-muted">No events yet</li> : null}
      </ul>
    </div>
  );
}
