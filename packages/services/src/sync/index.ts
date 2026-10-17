/**
 * Orchestrator for integration → FalkorDB syncs.
 * Wraps each provider sync with run-tracking (Neon sync_runs) and
 * deduplication (skips if a sync is still running).
 */

import { childLogger } from "../logger";
import { syncDb } from "./db";
import { syncJiraToGraph } from "./jira";
import { syncSlackToGraph } from "./slack";

const log = childLogger("sync");

export type SyncProvider = "jira" | "slack";

export async function triggerSync(workspaceId: string, provider: SyncProvider): Promise<string> {
  if (await syncDb.isRunning(workspaceId, provider)) {
    throw new Error(`A ${provider} sync is already running — please wait`);
  }

  const runId = await syncDb.startRun(workspaceId, provider);
  log.info({ workspaceId, provider, runId }, "Sync started");

  // Fire-and-forget — tracked in DB
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

      await syncDb.finishRun(runId, "ok", items, message);
      log.info({ workspaceId, provider, runId, items }, "Sync completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await syncDb.finishRun(runId, "error", 0, msg);
      log.error({ workspaceId, provider, runId, err }, "Sync failed");
    }
  })();

  return runId;
}

export { syncDb };
