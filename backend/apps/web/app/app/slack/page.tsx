"use client";

import { useEffect, useState } from "react";

import { IntegrationsPanel } from "~/components/app/integrations-panel";
import { trpc } from "~/lib/trpc";

export default function SlackIntegrationPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    void trpc.workspace.current.query({}).then((ws) => setWorkspaceId(ws.id));
  }, []);

  if (!workspaceId) return <p className="app-muted">Loading…</p>;
  return <IntegrationsPanel workspaceId={workspaceId} focus="slack" />;
}
