CREATE TABLE IF NOT EXISTS workspace_services (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_url text NOT NULL,
  access_token_encrypted text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_service_name
  ON workspace_services(workspace_id, name);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_workspace_services_workspace
  ON workspace_services(workspace_id, created_at);
