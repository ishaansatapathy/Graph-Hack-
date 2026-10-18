"use client";

import { useEffect, useState } from "react";

import { SharePanel } from "~/components/app/share-panel";
import { trpc } from "~/lib/trpc";

export default function SharePage() {
  const [workspace, setWorkspace] = useState<{ id: string; role: "owner" | "admin" | "member" } | null>(null);

  useEffect(() => {
    void trpc.workspace.current.query({}).then((ws) => setWorkspace({ id: ws.id, role: ws.role }));
  }, []);

  if (!workspace) return <p className="app-muted">Loading…</p>;
  return <SharePanel workspaceId={workspace.id} role={workspace.role} />;
}
