"use client";

import { useEffect, useState } from "react";

import { trpc } from "~/lib/trpc";

export default function WorkspacePage() {
  const [workspace, setWorkspace] = useState<{
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null>(null);

  useEffect(() => {
    void trpc.workspace.current.query({}).then(setWorkspace);
  }, []);

  if (!workspace) return <p className="app-muted">Loading…</p>;

  return (
    <div className="app-workspace-card">
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{workspace.name}</dd>
        </div>
        <div>
          <dt>Slug</dt>
          <dd>{workspace.slug}</dd>
        </div>
        <div>
          <dt>Your role</dt>
          <dd>{workspace.role}</dd>
        </div>
        <div>
          <dt>Workspace ID</dt>
          <dd>
            <code className="app-code-inline">{workspace.id}</code>
          </dd>
        </div>
      </dl>
    </div>
  );
}
