ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
--> statement-breakpoint

UPDATE sync_runs
SET heartbeat_at = started_at
WHERE status = 'running' AND heartbeat_at IS NULL;
