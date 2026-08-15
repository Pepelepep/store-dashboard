import prisma from "../../db.server";
import { processShopRedactionJobsBatch } from "../compliance/compliance-webhooks.server";
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
const RECONCILIATION_SHOPS_PER_TICK = 100;

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

async function enqueueDueReconciliations(supabase: SupabaseAdminClient) {
  const now = new Date();
  const { data: dueStates, error: dueStatesError } = await supabase
    .from("sync_automation_state")
    .select("shop_domain, last_reconciliation_succeeded_at")
    .lte("next_reconciliation_due_at", now.toISOString())
    .order("next_reconciliation_due_at", { ascending: true })
    .order("shop_domain", { ascending: true })
    .limit(RECONCILIATION_SHOPS_PER_TICK);
  if (dueStatesError) throw new Error(dueStatesError.message);

  const summary = {
    shopsChecked: dueStates?.length ?? 0,
    enqueued: 0,
    skipped: 0,
    failed: 0,
  };
  for (const state of dueStates ?? []) {
    const shop = state.shop_domain;
    try {
      const { data: latestSuccess } = await supabase
        .from("sync_jobs")
        .select("finished_at")
        .eq("shop_domain", shop)
        .eq("job_type", "orders_reconciliation_48h")
        .eq("status", "success")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastSucceededAt =
        latestSuccess?.finished_at ?? state.last_reconciliation_succeeded_at;
      const result = await enqueueOrdersReconciliation48hJob({
        supabase,
        shop,
        now,
      });
      if (result.enqueued) {
        summary.enqueued += 1;
      } else summary.skipped += 1;

      const { error: updateError } = await supabase
        .from("sync_automation_state")
        .update({
          last_reconciliation_started_at: result.enqueued
            ? now.toISOString()
            : undefined,
          last_reconciliation_succeeded_at: lastSucceededAt,
          next_reconciliation_due_at: new Date(
            now.getTime() + SIX_HOURS_MS,
          ).toISOString(),
          last_error: null,
          updated_at: now.toISOString(),
        })
        .eq("shop_domain", shop);
      if (updateError) throw new Error(updateError.message);
    } catch (error) {
      summary.failed += 1;
      await supabase.from("sync_automation_state").upsert(
        {
          shop_domain: shop,
          next_reconciliation_due_at: new Date(
            Date.now() + 10 * 60 * 1000,
          ).toISOString(),
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
  const { data: leaseToken, error: leaseError } = await supabase.rpc(
    "claim_maintenance_tick",
    { p_lease_seconds: 240 },
  );
  if (leaseError) throw new Error(leaseError.message);
  if (!leaseToken) {
    return {
      ok: true,
      partial: false,
      skipped: true,
      skippedReason: "maintenance_tick_already_running",
      failedSteps: [],
      steps: {},
    };
  }
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
      batchSize: 100,
      maxAttempts: 5,
      includeReconciliation: false,
    }),
  );
  await runStep("syncJobs", () =>
    processSyncJobsBatch({
      supabase,
      limit: 10,
      getAdminClient: getOfflineAdminClient,
    }),
  );
  await runStep("shopRedactions", () =>
    processShopRedactionJobsBatch({
      supabase,
      sessionStore: prisma,
      batchSize: 2,
    }),
  );
  await runStep("staleRecovery", () => recoverStaleJobs(supabase));
  await runStep("reconciliation", () => enqueueDueReconciliations(supabase));
  await runStep("cleanup", () => cleanupHistory(supabase));
  const failedSteps = Object.entries(steps)
    .filter(([, step]) => !step.ok)
    .map(([name]) => name);
  const tickSucceeded = failedSteps.length === 0;
  const { data: leaseReleased, error: healthError } = await supabase.rpc(
    "finish_maintenance_tick",
    {
      p_lease_token: leaseToken,
      p_succeeded: tickSucceeded,
      p_error: tickSucceeded
        ? null
        : `Failed steps: ${failedSteps.join(", ")}`,
    },
  );
  if (healthError) throw new Error(healthError.message);
  if (!leaseReleased) throw new Error("Maintenance tick lease was lost.");
  return {
    ok: tickSucceeded,
    partial:
      failedSteps.length > 0 && failedSteps.length < Object.keys(steps).length,
    failedSteps,
    steps,
  };
}
