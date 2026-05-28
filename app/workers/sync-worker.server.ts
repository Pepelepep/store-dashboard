import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import {
  claimNextSyncJobForWorker,
  processClaimedSyncJobBatch,
} from "../lib/sync/sync-jobs.server";

const workerId =
  process.env.SYNC_WORKER_ID ??
  `${process.env.RENDER_SERVICE_NAME ?? "sync-worker"}-${randomUUID()}`;
const pollIntervalMs = Number(process.env.SYNC_WORKER_POLL_INTERVAL_MS ?? 2000);
const idleIntervalMs = Number(process.env.SYNC_WORKER_IDLE_INTERVAL_MS ?? 5000);

let shuttingDown = false;

function requestShutdown(signal: string) {
  console.log(`[sync-worker] Received ${signal}. Shutting down after current batch.`);
  shuttingDown = true;
}

process.on("SIGINT", () => requestShutdown("SIGINT"));
process.on("SIGTERM", () => requestShutdown("SIGTERM"));

async function runWorker() {
  const supabase = getSupabaseAdminClient();

  console.log(`[sync-worker] Started worker ${workerId}.`);
  console.log(
    "[sync-worker] V1 uses bounded GraphQL pagination. TODO: evaluate Shopify Bulk Operations for very large backfills.",
  );

  while (!shuttingDown) {
    try {
      const job = await claimNextSyncJobForWorker({
        supabase,
        workerId,
      });

      if (!job) {
        await sleep(idleIntervalMs);
        continue;
      }

      console.log(
        `[sync-worker] Processing job ${job.id} (${job.job_type}/${job.current_step ?? "unknown"}).`,
      );

      const admin = await getOfflineAdminClient(job.shop_domain);
      const result = await processClaimedSyncJobBatch({
        admin,
        supabase,
        job,
        workerId,
      });

      console.log(
        `[sync-worker] Job ${result.job.id} status=${result.job.status} step=${result.job.current_step ?? "-"} processed=${result.processed}.`,
      );

      await sleep(pollIntervalMs);
    } catch (error) {
      console.error("[sync-worker] Worker loop error:", error);
      await sleep(idleIntervalMs);
    }
  }

  console.log(`[sync-worker] Stopped worker ${workerId}.`);
}

runWorker().catch((error) => {
  console.error("[sync-worker] Fatal error:", error);
  process.exitCode = 1;
});
