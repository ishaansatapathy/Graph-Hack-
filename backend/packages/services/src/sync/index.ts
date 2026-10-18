/** PostgreSQL-backed integration sync queue and workers. */

import { UserError } from "../errors";
import { childLogger } from "../logger";
import { syncDb } from "./db";
import { syncJiraToGraph } from "./jira";
import { syncSlackToGraph } from "./slack";

const log = childLogger("sync");
export type SyncProvider = "jira" | "slack";

export async function triggerSync(workspaceId: string, provider: SyncProvider): Promise<string> {
  if (await syncDb.isRunning(workspaceId, provider)) {
    throw new UserError(`A ${provider} sync is already queued or running. Please wait.`, "CONFLICT");
  }
  const runId = await syncDb.startRun(workspaceId, provider);
  log.info({ workspaceId, provider, runId }, "Sync queued");
  return runId;
}

let workerTimer: NodeJS.Timeout | null = null;
let workerPolling = false;
let activeWorkers = 0;
let lastLeaseRecovery = 0;
const MAX_CONCURRENT_SYNCS = 2;

async function executeSyncRun(run: { id: string; workspaceId: string; provider: string; attempt: number }) {
  const heartbeat = setInterval(() => {
    void syncDb.heartbeatRun(run.id, run.attempt).then((owned) => {
      if (!owned) log.warn({ runId: run.id, attempt: run.attempt }, "Sync worker lease was lost");
    }).catch((error) => log.warn({ error, runId: run.id }, "Sync worker heartbeat failed"));
  }, 30_000);
  heartbeat.unref();
  try {
    let items = 0;
    let message = "";
    if (run.provider === "jira") {
      const result = await syncJiraToGraph(run.workspaceId);
      items = result.issues;
      message = `Synced ${result.issues} issues (${result.skipped} skipped) · ${result.codeLinks ?? 0} linked to code · ${result.decisions ?? 0} decisions`;
    } else if (run.provider === "slack") {
      const result = await syncSlackToGraph(run.workspaceId);
      items = result.messages;
      message = result.mode === "full"
        ? `Synced ${result.messages} messages across ${result.channels} channels, ${result.mentions} Issue mentions, ${result.codeLinks ?? 0} linked to code, ${result.decisions ?? 0} decisions`
        : "Webhook-only mode — add a Slack bot token for full message ingestion";
    } else {
      throw new Error("Unknown integration sync provider");
    }

    const finished = await syncDb.finishRun(run.id, run.attempt, "ok", items, message);
    if (!finished) log.warn({ runId: run.id, attempt: run.attempt }, "Finished sync result ignored after lease loss");
    log.info({ ...run, items }, "Sync completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await syncDb.finishRun(run.id, run.attempt, "error", 0, message).catch((finishError) => {
      log.error({ finishError, runId: run.id }, "Failed to persist sync failure");
    });
    log.error({ ...run, error }, "Sync failed");
  } finally {
    clearInterval(heartbeat);
  }
}

async function pollSyncQueue() {
  if (workerPolling) return;
  workerPolling = true;
  try {
    if (Date.now() - lastLeaseRecovery > 30_000) {
      const recovered = await syncDb.recoverExpiredRuns();
      lastLeaseRecovery = Date.now();
      if (recovered) log.warn({ recovered }, "Requeued syncs with expired worker leases");
    }
    while (activeWorkers < MAX_CONCURRENT_SYNCS) {
      const run = await syncDb.claimNextRun();
      if (!run) break;
      activeWorkers++;
      void executeSyncRun(run).finally(() => {
        activeWorkers--;
        setTimeout(() => void pollSyncQueue(), 0);
      });
    }
  } catch (error) {
    log.error({ error }, "Sync queue poll failed");
  } finally {
    workerPolling = false;
  }
}

/** Claiming uses row locks so multiple API replicas can share this worker safely. */
export function startIntegrationSyncWorker() {
  if (workerTimer) return () => undefined;
  workerTimer = setInterval(() => void pollSyncQueue(), 1_000);
  workerTimer.unref();
  void pollSyncQueue();
  return () => {
    if (workerTimer) clearInterval(workerTimer);
    workerTimer = null;
  };
}

export { syncDb };
