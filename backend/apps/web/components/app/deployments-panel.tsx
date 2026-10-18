"use client";

import { useCallback, useEffect, useState } from "react";
import { trpc } from "~/lib/trpc";

type Service = { id: string; name: string; baseUrl: string; requiresAuth: boolean; createdAt: string };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type CallResult = { status: number; contentType: string; body: string };

export function DeploymentsPanel({
  workspaceId,
  role,
}: {
  workspaceId: string;
  role: "owner" | "admin" | "member";
}) {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [method, setMethod] = useState<Method>("GET");
  const [path, setPath] = useState("/");
  const [body, setBody] = useState("");
  const [result, setResult] = useState<CallResult | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const canManage = role === "owner" || role === "admin";
  const selected = services.find((service) => service.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const rows = await trpc.workspace.deployments.list.query({ workspaceId }) as Service[];
      setServices(rows);
      setSelectedId((current) => rows.some((service) => service.id === current) ? current : (rows[0]?.id ?? ""));
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Could not load shared services" });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function createService(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await trpc.workspace.deployments.create.mutate({
        workspaceId,
        name,
        baseUrl,
        ...(accessToken ? { accessToken } : {}),
      });
      setName("");
      setBaseUrl("");
      setAccessToken("");
      setMessage({ error: false, text: "Service added to the workspace." });
      await load();
      setSelectedId(created.id);
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Could not add service" });
    } finally {
      setBusy(false);
    }
  }

  async function removeService(service: Service) {
    setBusy(true);
    setMessage(null);
    try {
      await trpc.workspace.deployments.remove.mutate({ workspaceId, serviceId: service.id });
      setMessage({ error: false, text: `${service.name} removed from the workspace.` });
      setResult(null);
      await load();
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Could not remove service" });
    } finally {
      setBusy(false);
    }
  }

  async function callService(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const response = await trpc.workspace.deployments.invoke.mutate({
        workspaceId,
        serviceId: selected.id,
        method,
        path,
        ...(body.trim() ? { body } : {}),
      }) as CallResult;
      setResult(response);
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : "Service request failed" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="app-muted">Loading shared services…</p>;

  return (
    <section className="deployment-hub">
      <header className="deployment-hub-header">
        <div>
          <h3>Shared services</h3>
          <p className="app-muted">Register a deployed API once, then let workspace teammates call it from here.</p>
        </div>
      </header>

      {message ? <p className={`app-flash app-flash--${message.error ? "err" : "ok"}`} role="status">{message.text}</p> : null}

      {canManage ? (
        <form className="deployment-register-card" onSubmit={(event) => void createService(event)}>
          <h4>Register deployed service</h4>
          <div className="deployment-register-grid">
            <label className="app-field">
              <span>Service name</span>
              <input className="app-input app-input-block" required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Payments API" />
            </label>
            <label className="app-field">
              <span>HTTPS base URL</span>
              <input className="app-input app-input-block" required type="url" maxLength={500} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" />
            </label>
            <label className="app-field">
              <span>Shared bearer token (optional)</span>
              <input className="app-input app-input-block" type="password" maxLength={4000} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="Stored encrypted for workspace members" />
            </label>
          </div>
          <button type="submit" className="app-btn" disabled={busy || !name.trim() || !baseUrl.trim()}>
            {busy ? "Saving…" : "Add service"}
          </button>
          <p className="app-muted">Only HTTPS public hosts are accepted. Credentials are encrypted at rest and never shown again.</p>
        </form>
      ) : null}

      {services.length === 0 ? (
        <div className="deployment-empty app-muted">No services registered for this workspace yet.</div>
      ) : (
        <div className="deployment-layout">
          <aside className="deployment-service-list">
            {services.map((service) => (
              <div key={service.id} className={`deployment-service-card ${selectedId === service.id ? "active" : ""}`}>
                <button type="button" className="deployment-service-select" onClick={() => { setSelectedId(service.id); setResult(null); }}>
                  <strong>{service.name}</strong>
                  <code>{service.baseUrl}</code>
                  <span className="app-muted">{service.requiresAuth ? "Workspace bearer auth" : "No auth configured"}</span>
                </button>
                {canManage ? <button type="button" className="app-btn-ghost app-btn-small" disabled={busy} onClick={() => void removeService(service)}>Remove</button> : null}
              </div>
            ))}
          </aside>

          {selected ? (
            <form className="deployment-console" onSubmit={(event) => void callService(event)}>
              <h4>Call {selected.name}</h4>
              <div className="deployment-request-row">
                <select className="app-input" aria-label="HTTP method" value={method} onChange={(event) => setMethod(event.target.value as Method)}>
                  {(["GET", "POST", "PUT", "PATCH", "DELETE"] as Method[]).map((value) => <option key={value}>{value}</option>)}
                </select>
                <input className="app-input app-input-block" aria-label="API path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/v1/health" />
                <button type="submit" className="app-btn" disabled={busy || !path.startsWith("/")}>{busy ? "Calling…" : "Send request"}</button>
              </div>
              {method !== "GET" ? (
                <label className="app-field">
                  <span>JSON body (optional, max 64 KB)</span>
                  <textarea className="app-input app-input-block deployment-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder={'{\n  "example": true\n}'} />
                </label>
              ) : null}
              {result ? (
                <div className="deployment-response">
                  <div className="deployment-response-meta">
                    <strong className={result.status >= 200 && result.status < 400 ? "deployment-status-ok" : "deployment-status-error"}>HTTP {result.status}</strong>
                    <span className="app-muted">{result.contentType}</span>
                  </div>
                  <pre>{result.body}</pre>
                </div>
              ) : null}
            </form>
          ) : null}
        </div>
      )}
    </section>
  );
}
