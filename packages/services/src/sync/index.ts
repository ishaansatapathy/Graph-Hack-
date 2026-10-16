/**
 * Orchestrator for integration → FalkorDB syncs.
 * Wraps each provider sync with run-tracking (sync_runs table) and
 * deduplication (skips if a sync is still running).
 */

import * as syncDb from "./db";
import { syncJiraToGraph } from "./jira";
import { syncSlackToGraph } from "./slack";

export type SyncProvider = "jira" | "slack";

export async function triggerSync(workspaceId: string, provider: SyncProvider) {
  if (syncDb.isRunning(workspaceId, provider)) {
    throw new Error(`A ${provider} sync is already running — please wait`);
  }

  const runId = syncDb.startRun(workspaceId, provider);

  // Run async (fire-and-forget from the caller's perspective, tracked in DB)
  void (async () => {
    try {
      let items = 0;
      let message = "";

      if (provider === "jira") {
        const r = await syncJiraToGraph(workspaceId);
        items = r.issues;
        message = `Synced ${r.issues} issues (${r.skipped} skipped)`;
      } else if (provider === "slack") {
        const r = await syncSlackToGraph(workspaceId);
        items = r.messages;
        message =
          r.mode === "full"
            ? `Synced ${r.messages} messages across ${r.channels} channels, ${r.mentions} Issue mentions`
            : "Webhook-only mode — add a Slack bot token for full message ingestion";
      }

      syncDb.finishRun(runId, "ok", items, message);
    } catch (err) {
      syncDb.finishRun(runId, "error", 0, err instanceof Error ? err.message : String(err));
    }
  })();

  return runId;
}

export { syncDb };
