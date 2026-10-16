"use client";

import { useCallback, useEffect, useState } from "react";

import { trpc } from "~/lib/trpc";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
};

type Props = {
  workspaceId: string;
};

export function SharePanel({ workspaceId }: Props) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [name, setName] = useState("Demo integration");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await trpc.workspace.share.listApiKeys.query({ workspaceId });
      setKeys(list);
    } catch {
      setKeys([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    setBusy(true);
    try {
      const created = await trpc.workspace.share.createApiKey.mutate({ workspaceId, name });
      setRevealed(created.key);
      setName("Demo integration");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await trpc.workspace.share.revokeApiKey.mutate({ workspaceId, keyId: id });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-share">
      <p className="app-muted">Workspace-scoped API keys — share read access with teammates or scripts.</p>
      <div className="app-ask-form">
        <input
          className="app-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name"
        />
        <button type="button" className="app-btn" disabled={busy || !name.trim()} onClick={() => void createKey()}>
          Create key
        </button>
      </div>
      {revealed ? (
        <div className="app-answer">
          <strong>Copy now — shown once</strong>
          <pre className="app-cypher">{revealed}</pre>
        </div>
      ) : null}
      <ul className="app-key-list">
        {keys.map((k) => (
          <li key={k.id}>
            <span>{k.name}</span>
            <code>{k.prefix}…</code>
            <button type="button" className="app-btn-ghost app-btn-small" disabled={busy} onClick={() => void revoke(k.id)}>
              Revoke
            </button>
          </li>
        ))}
        {keys.length === 0 ? <li className="app-muted">No API keys yet</li> : null}
      </ul>
    </div>
  );
}
