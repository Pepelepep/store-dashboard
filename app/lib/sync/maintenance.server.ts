import prisma from "../../db.server";
import { getSupabaseAdminClient } from "../db/supabase.server";
import { getOfflineAdminClient } from "../shopify/offline-admin.server";
import { processWebhookEventsBatch } from "./webhook-events-processor.server";
import {
  enqueueOrdersReconciliation48hJob,
  processSyncJobsBatch,
  type SyncJobRow,
} from "./sync-jobs.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const STALE_JOB_MS = 15 * 60 * 1000;

async function recoverStaleJobs(supabase: SupabaseAdminClient) {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS).toISOString();
  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("status", "running")
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);
  let recovered = 0;
  let failed = 0;
  for (const job of (data ?? []) as SyncJobRow[]) {
    const retryCount = Number(job.details?.staleRetryCount ?? 0) + 1;
    const exhausted = retryCount > 3;
    const { error: updateError } = await supabase
      .from("sync_jobs")
      .update({
        status: exhausted ? "error" : "pending",
        error_message: exhausted
          ? "Sync job exceeded stale retry limit."
          : null,
        details: {
          ...(job.details ?? {}),
          staleRetryCount: retryCount,
          recoveredAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
        finished_at: exhausted ? new Date().toISOString() : null,
      })
      .eq("id", job.id)
      .eq("status", "running")
      .eq("updated_at", job.updated_at);
    if (updateError) throw new Error(updateError.message);
    if (exhausted) failed += 1;
    else recovered += 1;
  }
  return { checked: (data ?? []).length, recovered, failed };
}

async function getInstalledShops(limit: number) {
  const sessions = await prisma.session.findMany({
    where: { isOnline: false },
    select: { shop: true },
    distinct: ["shop"],
    orderBy: { shop: "asc" },
    take: limit,
  });
  return sessions.map((session) => session.shop).filter(Boolean);
}

async function enqueueDueReconciliations(supabase: SupabaseAdminClient) {
  const shops = await getInstalledShops(25);
  const summary = {
    shopsChecked: shops.length,
    enqueued: 0,
    skipped: 0,
    failed: 0,
  };
  for (const shop of shops) {
    try {
      const now = new Date();
      const { data: latestSuccess } = await supabase
        .from("sync_jobs")
        .select("finished_at")
        .eq("shop_domain", shop)
        .eq("job_type", "orders_reconciliation_48h")
        .eq("status", "success")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: latestJob } = await supabase
        .from("sync_jobs")
        .select("status, error_message, finished_at")
        .eq("shop_domain", shop)
        .eq("job_type", "orders_reconciliation_48h")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastSucceededAt = latestSuccess?.finished_at ?? null;
      const latestActivityAt =
        latestJob?.finished_at ?? lastSucceededAt ?? now.toISOString();
      const dueAt =
        latestJob?.status === "pending" || latestJob?.status === "running"
          ? new Date(now.getTime() + SIX_HOURS_MS)
          : lastSucceededAt || latestJob?.status === "error"
            ? new Date(new Date(latestActivityAt).getTime() + SIX_HOURS_MS)
            : now;
      await supabase.from("sync_automation_state").upsert(
        {
          shop_domain: shop,
          last_reconciliation_succeeded_at: lastSucceededAt,
          next_reconciliation_due_at: dueAt.toISOString(),
          last_error:
            latestJob?.status === "error" ? latestJob.error_message : null,
          updated_at: now.toISOString(),
        },
        { onConflict: "shop_domain" },
      );
      if (dueAt.getTime() > now.getTime()) {
        summary.skipped += 1;
        continue;
      }
      const result = await enqueueOrdersReconciliation48hJob({
        supabase,
        shop,
        now,
      });
      if (result.enqueued) {
        summary.enqueued += 1;
        await supabase
          .from("sync_automation_state")
          .update({
            last_reconciliation_started_at: now.toISOString(),
            next_reconciliation_due_at: new Date(
              now.getTime() + SIX_HOURS_MS,
            ).toISOString(),
            last_error: null,
            updated_at: now.toISOString(),
          })
          .eq("shop_domain", shop);
      } else summary.skipped += 1;
    } catch (error) {
      summary.failed += 1;
      await supabase.from("sync_automation_state").upsert(
        {
          shop_domain: shop,
          next_reconciliation_due_at: new Date().toISOString(),
          last_error: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 1000),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shop_domain" },
      );
    }
  }
  return summary;
}

async function cleanupHistory(supabase: SupabaseAdminClient) {
  const { data, error } = await supabase.rpc(
    "cleanup_operational_sync_history",
    { p_batch_size: 500 },
  );
  if (error) throw new Error(error.message);
  return (
    (data ?? [])[0] ?? {
      sync_jobs_deleted: 0,
      sync_runs_deleted: 0,
      webhook_events_deleted: 0,
    }
  );
}

export async function runMaintenanceTick() {
  const supabase = getSupabaseAdminClient();
  const tickStartedAt = new Date().toISOString();
  const { error: startError } = await supabase
    .from("maintenance_tick_state")
    .upsert(
      {
        singleton: true,
        last_started_at: tickStartedAt,
        updated_at: tickStartedAt,
      },
      { onConflict: "singleton" },
    );
  if (startError) throw new Error(startError.message);
  const steps: Record<
    string,
    { ok: boolean; result?: unknown; error?: string }
  > = {};
  const runStep = async (name: string, task: () => Promise<unknown>) => {
    try {
      steps[name] = { ok: true, result: await task() };
    } catch (error) {
      steps[name] = {
        ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(
          0,
          1000,
        ),
      };
    }
  };
  await runStep("webhooks", () =>
    processWebhookEventsBatch({
      supabase,
      batchSize: 25,
      maxAttempts: 5,
      includeReconciliation: false,
    }),
  );
  await runStep("syncJobs", () =>
    processSyncJobsBatch({
      supabase,
      limit: 5,
      getAdminClient: getOfflineAdminClient,
    }),
  );
  await runStep("staleRecovery", () => recoverStaleJobs(supabase));
  await runStep("reconciliation", () => enqueueDueReconciliations(supabase));
  await runStep("cleanup", () => cleanupHistory(supabase));
  const failedSteps = Object.entries(steps)
    .filter(([, step]) => !step.ok)
    .map(([name]) => name);
  const tickCompletedAt = new Date().toISOString();
  const tickSucceeded = failedSteps.length === 0;
  const healthUpdate: Record<string, unknown> = {
    last_completed_at: tickCompletedAt,
    last_error: tickSucceeded
      ? null
      : `Failed steps: ${failedSteps.join(", ")}`,
    updated_at: tickCompletedAt,
  };
  if (tickSucceeded) healthUpdate.last_succeeded_at = tickCompletedAt;
  const { error: healthError } = await supabase
    .from("maintenance_tick_state")
    .update(healthUpdate)
    .eq("singleton", true);
  if (healthError) throw new Error(healthError.message);
  return {
    ok: tickSucceeded,
    partial:
      failedSteps.length > 0 && failedSteps.length < Object.keys(steps).length,
    failedSteps,
    steps,
  };
}
