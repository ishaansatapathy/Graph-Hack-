WITH ranked_active AS (
  SELECT id,
         row_number() OVER (PARTITION BY workspace_id, provider ORDER BY started_at DESC, id DESC) AS position
  FROM sync_runs
  WHERE status IN ('queued', 'running')
)
UPDATE sync_runs AS runs
SET status = 'error',
    message = 'Superseded by the latest active sync during migration',
    finished_at = now()
FROM ranked_active
WHERE runs.id = ranked_active.id AND ranked_active.position > 1;
--> statement-breakpoint

DROP INDEX IF EXISTS uq_sync_runs_workspace_provider_running;
--> statement-breakpoint

CREATE UNIQUE INDEX uq_sync_runs_workspace_provider_running
  ON sync_runs(workspace_id, provider)
  WHERE status IN ('queued', 'running');
