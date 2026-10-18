CREATE TABLE IF NOT EXISTS workspace_file_drafts (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  path text NOT NULL,
  content text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, path)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_workspace_file_drafts_updated
  ON workspace_file_drafts(workspace_id, updated_at);
