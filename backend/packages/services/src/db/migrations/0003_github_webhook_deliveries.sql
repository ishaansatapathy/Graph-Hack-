CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
  delivery_id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'processing',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_github_deliveries_workspace_started
  ON github_webhook_deliveries(workspace_id, started_at);
