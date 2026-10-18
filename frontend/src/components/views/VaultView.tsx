"use client";

import { useState } from "react";
import { Globe, KeyRound, Lock, Play, Plus, RefreshCw, Shield, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { apiFetch, errorMessage, NoticeBar, useResource, ViewError, ViewLoading, type Notice } from "./shared";

interface SharedService {
  id: string;
  name: string;
  baseUrl: string;
  requiresAuth: boolean;
  createdAt: string;
}

interface CallResult {
  status: number;
  contentType: string;
  body: string;
  latencyMs: number;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

function pretty(body: string, contentType: string) {
  if (!contentType.includes("json")) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export function VaultView() {
  const { state, reload } = useResource<{ services: SharedService[]; canManage: boolean }>("/api/workspace/services");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("GET");
  const [path, setPath] = useState("/");
  const [body, setBody] = useState("");
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newSecret, setNewSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (state.status === "loading") return <ViewLoading label="Loading API vault…" />;
  if (state.status === "error") return <ViewError title="Couldn't load shared services" error={state.error} onRetry={() => reload(false)} />;

  const { services, canManage } = state.data;
  const selected = services.find((s) => s.id === selectedId) ?? services[0] ?? null;

  const invoke = async () => {
    if (!selected) return;
    setInvoking(true);
    setResult(null);
    setNotice(null);
    try {
      setResult(
        await apiFetch<CallResult>(`/api/workspace/services/${encodeURIComponent(selected.id)}/call`, {
          method: "POST",
          body: { method, path: path.trim() || "/", ...(method !== "GET" && body.trim() ? { body } : {}) },
        }),
      );
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setInvoking(false);
    }
  };

  const addService = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setNotice(null);
    try {
      const { service } = await apiFetch<{ service: SharedService }>("/api/workspace/services", {
        method: "POST",
        body: { name: newName.trim(), baseUrl: newBaseUrl.trim(), accessToken: newSecret.trim() || undefined },
      });
      setNewName("");
      setNewBaseUrl("");
      setNewSecret("");
      setShowAdd(false);
      setSelectedId(service.id);
      setNotice({ tone: "ok", text: `"${service.name}" is shared with your workspace${service.requiresAuth ? "; its token is stored encrypted" : ""}.` });
      reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setAdding(false);
    }
  };

  const removeService = async (s: SharedService) => {
    if (!window.confirm(`Remove "${s.name}" from the workspace? Teammates will no longer be able to call it.`)) return;
    try {
      await apiFetch(`/api/workspace/services/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      if (selectedId === s.id) setSelectedId(null);
      setResult(null);
      reload();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    }
  };

  const ok = result ? result.status >= 200 && result.status < 300 : false;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="text-[17px] font-semibold text-fg">API Vault</h1>
          <p className="mt-1 text-[13px] text-fg-2">
            Share an HTTPS API with your workspace. Its bearer token stays encrypted on the server and is added to each call there; teammates never see it.
          </p>
        </div>
        {canManage && (
          <Button size="sm" variant="primary" onClick={() => setShowAdd((v) => !v)} className="gap-2">
            <Plus className="size-3.5 text-accent-ink" /> Share an API
          </Button>
        )}
      </div>

      <NoticeBar notice={notice} onDismiss={() => setNotice(null)} />

      {showAdd && canManage && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-surface-2 p-5">
          <h2 className="mb-3 border-b border-line pb-2 text-[14px] font-medium text-fg">Share an API</h2>
          <form onSubmit={addService} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Name">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Billing API" required maxLength={80} className={inputClass} />
            </Field>
            <Field label="Base URL (HTTPS origin)">
              <input type="url" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} placeholder="https://api.example.com" required className={inputClass} />
            </Field>
            <Field label="Bearer token (optional)">
              <input type="password" value={newSecret} onChange={(e) => setNewSecret(e.target.value)} autoComplete="off" className={inputClass} />
            </Field>
            <div className="flex items-center gap-3 md:col-span-3">
              <Button size="sm" variant="primary" type="submit" disabled={adding}>
                {adding ? "Saving…" : "Share with workspace"}
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {services.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-1">
          <EmptyState
            icon={<Lock size={16} strokeWidth={1.5} />}
            title="No shared APIs yet"
            body={canManage ? "Share an API so teammates can call it through Stackfox without holding its token." : "A workspace owner or admin can share APIs here."}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-5">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-fg-3">Shared APIs ({services.length})</h2>
            {services.map((s) => {
              const active = s.id === selected?.id;
              return (
                <div
                  key={s.id}
                  onClick={() => {
                    setSelectedId(s.id);
                    setResult(null);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(s.id)}
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${active ? "border-accent bg-surface-2" : "border-line bg-surface-1 hover:border-line-strong"}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex size-7 items-center justify-center rounded bg-surface-3 text-accent">
                        <Lock className="size-3.5" />
                      </div>
                      <div>
                        <h3 className="text-[13.5px] font-medium text-fg">{s.name}</h3>
                        <p className="font-mono text-[11px] text-fg-3">{s.baseUrl}</p>
                      </div>
                    </div>
                    {canManage && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeService(s);
                        }}
                        className="text-fg-3 hover:text-conflict"
                        title="Remove"
                        aria-label={`Remove ${s.name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 font-mono text-[11px] text-fg-3">
                    <span className="flex items-center gap-1.5 text-fg-2">
                      <Shield className="size-3 text-pass" />
                      {s.requiresAuth ? "Token stored encrypted" : "No token"}
                    </span>
                    <span>Added {new Date(s.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col rounded-lg border border-line bg-surface-1 p-5 lg:col-span-7">
            <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-accent" />
                <h2 className="text-[14px] font-medium text-fg">Call through Stackfox</h2>
              </div>
              <span className="font-mono text-[11px] text-fg-3">{selected?.name}</span>
            </div>

            <div className="mb-4 grid grid-cols-12 gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Method)}
                aria-label="HTTP method"
                className="col-span-3 rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] font-semibold text-accent focus:border-accent focus:outline-none"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/v1/status"
                aria-label="Request path"
                className="col-span-9 rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
              />
            </div>

            {method !== "GET" && (
              <div className="mb-4">
                <label className="mb-1 block font-mono text-[11px] text-fg-3">Request body (sent as-is)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-line bg-surface-2 p-2.5 font-mono text-[11.5px] text-fg focus:border-accent focus:outline-none"
                />
              </div>
            )}

            <div className="mb-5 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 font-mono text-[11.5px] text-fg-3">
                <KeyRound className="size-3.5 text-accent" />
                {selected?.requiresAuth ? "Server adds Authorization: Bearer …" : "Sent without a token"}
              </span>
              <Button size="sm" variant="primary" onClick={() => void invoke()} disabled={invoking || !selected} className="gap-2">
                {invoking ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 text-accent-ink" />}
                Send request
              </Button>
            </div>

            <div className="flex-1 rounded-md border border-line bg-surface-2/80 p-4 font-mono text-[12px]">
              <div className="mb-2 flex items-center justify-between border-b border-line/60 pb-2 text-[11px] text-fg-3">
                <span className="flex items-center gap-2">
                  RESPONSE
                  {result && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${ok ? "bg-pass/10 text-pass" : "bg-conflict/10 text-conflict"}`}>HTTP {result.status}</span>
                  )}
                </span>
                {result && (
                  <span>
                    {result.contentType} · {result.latencyMs}ms
                  </span>
                )}
              </div>
              {result ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-surface-1 p-3 text-[11px] leading-relaxed text-fg-2">
                  {pretty(result.body, result.contentType) || "(empty body)"}
                </pre>
              ) : (
                <div className="flex h-32 flex-col items-center justify-center text-center text-fg-3">
                  <Globe className="mb-1.5 size-5 opacity-40" />
                  <p>Send a request to see the API&apos;s real response.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputClass = "mt-1 w-full rounded border border-line bg-surface-1 px-3 py-1.5 font-mono text-[12px] text-fg focus:border-accent focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[11px] text-fg-2">
        {label}
        {children}
      </label>
    </div>
  );
}
