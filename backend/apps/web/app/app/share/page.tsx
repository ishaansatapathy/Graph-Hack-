"use client";

import { useEffect, useState } from "react";

import { SharePanel } from "~/components/app/share-panel";
import { trpc } from "~/lib/trpc";

export default function SharePage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    void trpc.workspace.current.query({}).then((ws) => setWorkspaceId(ws.id));
  }, []);

  if (!workspaceId) return <p className="app-muted">Loading…</p>;
  return <SharePanel workspaceId={workspaceId} />;
}
