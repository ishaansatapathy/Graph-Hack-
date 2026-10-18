"use client";

import { useEffect, useState } from "react";
import { CheckCircle, Globe, KeyRound, Lock, Play, Plus, RefreshCw, Shield, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SharedService {
  id: string;
  name: string;
  baseUrl: string;
  requiresAuth: boolean;
  createdBy: string;
  createdAt: string;
  callCount: number;
  maskedToken: string | null;
}

interface ProxyResult {
  status: number;
  statusText: string;
  contentType: string;
  latencyMs: number;
  targetOrigin: string;
  targetPath: string;
  proxiedBy: string;
  authInjected: boolean;
  data: unknown;
}

export function VaultView() {
  const [services, setServices] = useState<SharedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");

  // Testing form
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [path, setPath] = useState<string>("/headers");
  const [body, setBody] = useState<string>("");
  const [invoking, setInvoking] = useState(false);
  const [result, setResult] = useState<ProxyResult | null>(null);

  // New service modal/drawer state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("https://httpbin.org");
  const [newSecret, setNewSecret] = useState("");
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadServices = async () => {
    try {
      const res = await fetch("/api/workspace/services");
      if (res.ok) {
        const json = await res.json();
        const list = (json.services ?? []) as SharedService[];
        setServices(list);
        if (list.length > 0 && !selectedServiceId) {
          setSelectedServiceId(list[0].id);
        }
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadServices();
  }, []);

  const selectedService = services.find((s) => s.id === selectedServiceId) ?? services[0] ?? null;

  const handleInvoke = async () => {
    if (!selectedService) return;
    setInvoking(true);
    setResult(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/workspace/services/${selectedService.id}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          path: path.trim() || "/",
          ...(body.trim() ? { body: JSON.parse(body) } : {}),
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as ProxyResult;
        setResult(json);
        void loadServices(); // refresh call count
      } else {
        const err = await res.json().catch(() => null);
        setFeedback(err?.error ?? "Invocation failed");
      }
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "Error invoking service");
    } finally {
      setInvoking(false);
    }
  };

  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newBaseUrl.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/workspace/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          baseUrl: newBaseUrl.trim(),
          accessToken: newSecret.trim() || undefined,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setNewName("");
        setNewSecret("");
        setShowAddForm(false);
        setFeedback(`Service "${created.service?.name}" successfully encrypted with AES-256-GCM and registered.`);
        await loadServices();
        if (created.service?.id) {
          setSelectedServiceId(created.service.id);
        }
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteService = async (id: string) => {
    try {
      await fetch(`/api/workspace/services/${id}`, { method: "DELETE" });
      await loadServices();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg font-mono text-[12px] text-fg-3">
        <RefreshCw className="mr-2 size-4 animate-spin text-accent" /> Loading Private API Vault…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-bg p-6 font-sans text-fg">
      {/* Top Banner */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[17px] font-semibold text-fg">Private API Vault & Zero-Knowledge Relay</h1>
            <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent">
              AES-256-GCM Encrypted
            </span>
          </div>
          <p className="mt-1 text-[13px] text-fg-2">
            Share private Google Auth, internal microservices, and external APIs with teammates without ever exposing raw secrets or API keys.
          </p>
        </div>

        <Button
          size="sm"
          variant="primary"
          onClick={() => setShowAddForm(!showAddForm)}
          className="gap-2"
        >
          <Plus className="size-3.5 text-accent-ink" />
          Share New Private API
        </Button>
      </div>

      {feedback && (
        <div className="mb-6 flex items-center justify-between rounded-md border border-accent/30 bg-accent/10 px-4 py-2.5 font-mono text-[12px] text-accent">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-accent hover:underline">
            dismiss
          </button>
        </div>
      )}

      {/* Add New Service Form */}
      {showAddForm && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-surface-2 p-5 shadow-xl">
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
            <h2 className="text-[14px] font-medium text-fg">Register New Private API / Token</h2>
            <span className="font-mono text-[11px] text-fg-3">Server-side AES-256-GCM encryption</span>
          </div>
          <form onSubmit={handleAddService} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="block font-mono text-[11px] text-fg-2">Service Name</label>
              <input
                type="text"
                placeholder="e.g. Google OAuth 2.0 Auth Service"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-surface-1 px-3 py-1.5 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] text-fg-2">Target Base URL</label>
              <input
                type="url"
                placeholder="https://..."
                value={newBaseUrl}
                onChange={(e) => setNewBaseUrl(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-surface-1 px-3 py-1.5 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] text-fg-2">Private Secret / Bearer Token</label>
              <input
                type="password"
                placeholder="ya29.a0AfH6... (kept secret)"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                className="mt-1 w-full rounded border border-line bg-surface-1 px-3 py-1.5 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-3 md:col-span-3">
              <Button size="sm" variant="primary" type="submit" disabled={adding}>
                {adding ? "Encrypting & Storing…" : "Encrypt & Share with Team"}
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Main Grid: Services List & Live Invoker */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Col: Shared Services (5 cols) */}
        <div className="space-y-4 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-fg-3">Shared Team Services ({services.length})</h2>
            <span className="font-mono text-[11px] text-pass">● Zero-Knowledge Enabled</span>
          </div>

          <div className="space-y-3">
            {services.map((s) => {
              const active = s.id === selectedService?.id;
              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedServiceId(s.id)}
                  className={`cursor-pointer rounded-lg border p-4 transition-all ${
                    active
                      ? "border-accent bg-surface-2 shadow-[0_0_15px_rgba(62,230,240,0.06)]"
                      : "border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2/50"
                  }`}
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
                    {services.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteService(s.id);
                        }}
                        className="text-fg-3 hover:text-conflict"
                        title="Remove service"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2 font-mono text-[11px] text-fg-3">
                    <span className="flex items-center gap-1.5 text-fg-2">
                      <Shield className="size-3 text-pass" />
                      {s.requiresAuth ? "AES-256 Encrypted Token" : "Public Endpoint"}
                    </span>
                    <span>{s.callCount} calls made</span>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[11px] text-fg-3">
                    <span>Shared by: <strong className="font-normal text-fg-2">{s.createdBy}</strong></span>
                    <span className="font-mono text-[10px] text-fg-3/70">ID: {s.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Col: Live Zero-Knowledge Gateway Tester (7 cols) */}
        <div className="flex flex-col rounded-lg border border-line bg-surface-1 p-5 lg:col-span-7">
          <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Zap className="size-4 text-accent" />
              <h2 className="text-[14px] font-medium text-fg">Zero-Knowledge Proxy Relay Tester</h2>
            </div>
            <span className="font-mono text-[11px] text-fg-3">
              Target: <strong className="text-fg-2">{selectedService?.name}</strong>
            </span>
          </div>

          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-2">
            Teammates call this proxy endpoint. The Stackfox server injects the owner&apos;s encrypted API credentials into upstream HTTP headers and returns the verified response. <span className="text-accent">No secret is ever exposed to the client!</span>
          </p>

          <div className="mb-4 grid grid-cols-12 gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "GET" | "POST")}
              className="col-span-3 rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] font-semibold text-accent focus:border-accent focus:outline-none"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/headers or /userinfo"
              className="col-span-9 rounded border border-line bg-surface-2 px-3 py-2 font-mono text-[12px] text-fg focus:border-accent focus:outline-none"
            />
          </div>

          {method === "POST" && (
            <div className="mb-4">
              <label className="mb-1 block font-mono text-[11px] text-fg-3">JSON Request Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{ "userId": "usr_ishaan" }'
                rows={3}
                className="w-full rounded border border-line bg-surface-2 p-2.5 font-mono text-[11.5px] text-fg focus:border-accent focus:outline-none"
              />
            </div>
          )}

          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[11.5px] text-fg-3">
              <KeyRound className="size-3.5 text-accent" />
              <span>Token automatically injected upstream:</span>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-pass">Bearer ya29.••••••••</code>
            </div>

            <Button
              size="sm"
              variant="primary"
              onClick={() => void handleInvoke()}
              disabled={invoking}
              className="gap-2"
            >
              {invoking ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5 text-accent-ink" />}
              Invoke via Secure Gateway
            </Button>
          </div>

          {/* Response Box */}
          <div className="flex-1 rounded-md border border-line bg-surface-2/80 p-4 font-mono text-[12px]">
            <div className="mb-2 flex items-center justify-between border-b border-line/60 pb-2 text-[11px] text-fg-3">
              <div className="flex items-center gap-2">
                <span>GATEWAY RESPONSE</span>
                {result && (
                  <span className="flex items-center gap-1 rounded bg-pass/10 px-1.5 py-0.5 text-[10px] text-pass">
                    <CheckCircle className="size-3" />
                    {result.status} {result.statusText}
                  </span>
                )}
              </div>
              {result && <span>{result.latencyMs}ms roundtrip</span>}
            </div>

            {result ? (
              <div className="space-y-3">
                <div className="rounded bg-surface-3/80 p-2 text-[11px] text-pass">
                  ✓ {result.proxiedBy} — Authorization Header injected server-side.
                </div>
                <pre className="max-h-72 overflow-auto rounded bg-surface-1 p-3 text-[11px] leading-relaxed text-fg-2">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </div>
            ) : (
              <div className="flex h-32 flex-col items-center justify-center text-center text-fg-3">
                <Globe className="mb-1.5 size-5 opacity-40" />
                <p>Click &quot;Invoke via Secure Gateway&quot; to test the private proxy.</p>
                <p className="text-[11px] text-fg-3/60">Server injects credentials without exposing them.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
