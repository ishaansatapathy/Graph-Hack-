WITH ranked_running AS (
  SELECT id,
         row_number() OVER (PARTITION BY workspace_id, provider ORDER BY started_at DESC, id DESC) AS position
  FROM sync_runs
  WHERE status = 'running'
)
UPDATE sync_runs AS runs
SET status = 'error',
    message = 'Superseded by the latest active sync during migration',
    finished_at = now()
FROM ranked_running
WHERE runs.id = ranked_running.id AND ranked_running.position > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_runs_workspace_provider_running
  ON sync_runs(workspace_id, provider)
  WHERE status = 'running';
