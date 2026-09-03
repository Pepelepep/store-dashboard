import { getSupabaseAdminClient } from "../db/supabase.server";
import { mapWithConcurrency } from "../db/batch-query.server";
import {
  isShopifyAuthenticationRequiredError,
  SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE,
} from "../shopify/offline-admin.server";
import type { SyncBatchResult, SyncSource } from "./shopify-sync.server";
import {
  syncFinancialBackfill30dBatch,
  syncInventoryBatch,
  syncInventoryBulkStep,
  syncLocations,
  syncOrdersBatch,
  syncOrdersReconciliation48hBatch,
  syncProductsBatch,
  syncProductsBulkStep,
} from "./shopify-sync.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

export type SyncJobType =
  | "locations"
  | "products"
  | "inventory"
  | "orders"
  | "orders_reconciliation_48h"
  | "financial_backfill_30d"
  | "full_refresh"
  | "full";

export type SyncJobStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "cancelled";

export type SyncJobRow = {
  id: string;
  shop_domain: string;
  job_type: SyncJobType;
  status: SyncJobStatus;
  current_step: string | null;
  progress: Record<string, unknown> | null;
  counts: Record<string, unknown> | null;
  error_message: string | null;
  details: Record<string, unknown> | null;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
  created_at: string;
};

type ProcessManualSyncJobResult = {
  job: SyncJobRow;
  processed: boolean;
  skippedReason?: string | null;
};

const fullSyncSteps = ["locations", "products", "inventory", "orders"];
const marketplaceSyncJobTypes: SyncJobType[] = [
  "locations",
  "products",
  "inventory",
  "orders",
  "orders_reconciliation_48h",
  "financial_backfill_30d",
  "full",
  "full_refresh",
];
const STALE_ACTIVE_JOB_MS = 15 * 60 * 1000;
const MAX_STALE_RETRY_COUNT = 3;
const MAX_STEP_BATCHES_PER_TICK = 5;
const ORDERS_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ORDERS_RECONCILIATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const FINANCIAL_BACKFILL_RECENT_SUCCESS_MS = 24 * 60 * 60 * 1000;
const FINANCIAL_BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function getInitialStep(jobType: SyncJobType) {
  return jobType === "full" || jobType === "full_refresh"
    ? fullSyncSteps[0]
    : jobType;
}

function getNextFullStep(currentStep: string | null) {
  const currentIndex = fullSyncSteps.indexOf(currentStep ?? "");

  if (currentIndex === -1) {
    return fullSyncSteps[0];
  }

  return fullSyncSteps[currentIndex + 1] ?? null;
}

function setStepCounts(
  existing: Record<string, unknown> | null | undefined,
  step: string,
  batchCounts: Record<string, unknown>,
) {
  return {
    ...(existing ?? {}),
    [step]: batchCounts,
  };
}

function addBatchCounts(
  existing: Record<string, unknown>,
  batchCounts: Record<string, unknown>,
) {
  const next = { ...existing };

  for (const [key, value] of Object.entries(batchCounts)) {
    if (typeof value === "number") {
      next[key] = Number(next[key] ?? 0) + value;
      continue;
    }

    next[key] = value;
  }

  return next;
}

function getErrorDetails(error: unknown) {
  if (error && typeof error === "object" && "details" in error) {
    return (error as { details?: unknown }).details;
  }

  return null;
}

function getSyncJobSource(job: SyncJobRow): SyncSource {
  const source =
    job.details && typeof job.details.source === "string"
      ? job.details.source
      : null;

  return source === "cron" ||
    source === "webhook" ||
    source === "local_manual_refresh" ||
    source === "manual_internal" ||
    source === "manual_admin_sync"
    ? source
    : "manual_admin_sync";
}

function getOrdersReconciliationWindow(now = new Date()) {
  return {
    windowStart: new Date(
      now.getTime() - ORDERS_RECONCILIATION_WINDOW_MS,
    ).toISOString(),
    windowEnd: now.toISOString(),
  };
}

function getFinancialBackfillWindow(now = new Date()) {
  return {
    windowStart: new Date(
      now.getTime() - FINANCIAL_BACKFILL_WINDOW_MS,
    ).toISOString(),
    windowEnd: now.toISOString(),
  };
}

function getProgressForStep(job: SyncJobRow, step: string) {
  return (
    ((job.progress ?? {})[step] as Record<string, unknown> | undefined) ?? {}
  );
}

function isStaleActiveJob(job: SyncJobRow) {
  if (job.status !== "running") {
    return false;
  }

  const activityTime = new Date(
    job.updated_at ?? job.started_at ?? job.created_at,
  ).getTime();

  return Number.isFinite(activityTime)
    ? Date.now() - activityTime > STALE_ACTIVE_JOB_MS
    : false;
}

function isTerminalStatus(status: string) {
  return status === "success" || status === "error" || status === "cancelled";
}

function getSafeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return message.slice(0, 1000);
}

export async function markSyncJobAuthenticationRequired({
  supabase,
  job,
}: {
  supabase: SupabaseAdminClient;
  job: SyncJobRow;
}) {
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("sync_jobs")
    .update({
      status: "error",
      error_message: SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE,
      details: {
        ...(job.details ?? {}),
        errorCode: "shopify_authentication_required",
        authenticationRequired: true,
      },
      updated_at: finishedAt,
      finished_at: finishedAt,
    })
    .eq("shop_domain", job.shop_domain)
    .eq("id", job.id)
    .in("status", ["pending", "running"])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SyncJobRow | null) ?? job;
}

function summarizeCounts(counts: Record<string, unknown> | null | undefined) {
  const summary: Record<string, unknown> = {};

  for (const [step, value] of Object.entries(counts ?? {})) {
    if (!value || typeof value !== "object") {
      continue;
    }

    summary[step] = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([, entryValue]) =>
          typeof entryValue === "number" ||
          typeof entryValue === "string" ||
          typeof entryValue === "boolean" ||
          entryValue === null,
      ),
    );
  }

  return summary;
}

function hasCounts(counts: Record<string, unknown> | null | undefined) {
  return Object.keys(counts ?? {}).length > 0;
}

function hasContinuationProgress(job: SyncJobRow) {
  const step = job.current_step ?? getInitialStep(job.job_type);
  const progress = getProgressForStep(job, step);

  if (typeof progress.cursor === "string" && progress.cursor) {
    return true;
  }

  if (typeof progress.offset === "number" && progress.offset > 0) {
    return true;
  }

  return false;
}

function logJobTransition({
  job,
  previousStatus,
  finalStatus,
  startedAtMs,
  finalized = false,
}: {
  job: SyncJobRow;
  previousStatus: string;
  finalStatus: string;
  startedAtMs: number;
  finalized?: boolean;
}) {
  console.info("[sync-jobs] job transition", {
    jobId: job.id,
    shop: job.shop_domain,
    jobType: job.job_type,
    previousStatus,
    finalStatus,
    durationMs: Date.now() - startedAtMs,
    finalized,
    counts: summarizeCounts(job.counts),
  });
}

async function cancelStaleActiveJobs({
  supabase,
  shop,
  jobTypes,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  jobTypes: string[];
}) {
  const staleBefore = new Date(Date.now() - STALE_ACTIVE_JOB_MS).toISOString();
  const { error } = await supabase
    .from("sync_jobs")
    .update({
      status: "cancelled",
      error_message:
        "Sync job was cancelled because it was stale and no longer processing.",
      details: {
        stale: true,
        staleTimeoutMinutes: STALE_ACTIVE_JOB_MS / 60000,
      },
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    .eq("shop_domain", shop)
    .in("job_type", jobTypes)
    .in("status", ["pending", "running"])
    .lt("updated_at", staleBefore);

  if (error) {
    throw new Error(error.message);
  }
}

async function insertSyncRun({
  supabase,
  shop,
  syncType,
  status,
  source,
  startedAt,
  errorMessage,
  details,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  syncType: string;
  status: "success" | "error";
  source: SyncSource;
  startedAt: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}) {
  await supabase.from("sync_runs").insert({
    shop_domain: shop,
    sync_type: syncType,
    status,
    source,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    error_message: errorMessage ?? null,
    details: details ?? null,
  });
}

async function getActiveBlockingJob({
  supabase,
  shop,
  jobType,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  jobType: SyncJobType;
}) {
  const blockingTypes =
    jobType === "full" || jobType === "full_refresh"
      ? [
          ...fullSyncSteps,
          "full",
          "full_refresh",
          "orders_reconciliation_48h",
          "financial_backfill_30d",
        ]
      : jobType === "orders_reconciliation_48h"
        ? [
            "orders_reconciliation_48h",
            "orders",
            "full",
            "full_refresh",
            "financial_backfill_30d",
          ]
        : jobType === "financial_backfill_30d"
          ? [
              "financial_backfill_30d",
              "orders_reconciliation_48h",
              "orders",
              "full",
              "full_refresh",
            ]
          : [jobType, "full", "full_refresh"];

  await cancelStaleActiveJobs({
    supabase,
    shop,
    jobTypes: blockingTypes,
  });

  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("shop_domain", shop)
    .in("job_type", blockingTypes)
    .in("status", ["pending", "running"])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  return ((data ?? [])[0] ?? null) as SyncJobRow | null;
}

export async function createManualSyncJob({
  supabase,
  shop,
  jobType,
  trigger = "manual",
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  jobType: SyncJobType;
  trigger?: "manual" | "initial_setup" | "support";
}) {
  const activeJob = await getActiveBlockingJob({ supabase, shop, jobType });

  if (activeJob) {
    return {
      job: activeJob,
      reused: true,
    };
  }

  const { data, error } = await supabase
    .from("sync_jobs")
    .insert({
      shop_domain: shop,
      job_type: jobType,
      status: "pending",
      current_step: getInitialStep(jobType),
      progress:
        jobType === "full_refresh" ? { orders: { fullHistory: true } } : {},
      counts: {},
      details: {
        source: "manual_admin_sync",
        trigger,
      },
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const racedJob = await getActiveBlockingJob({ supabase, shop, jobType });
      if (racedJob) return { job: racedJob, reused: true };
    }
    throw new Error(error.message);
  }

  return {
    job: data as SyncJobRow,
    reused: false,
  };
}

export async function enqueueOrdersReconciliation48hJob({
  supabase,
  shop,
  now = new Date(),
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  now?: Date;
}) {
  const activeJob = await getActiveBlockingJob({
    supabase,
    shop,
    jobType: "orders_reconciliation_48h",
  });

  if (activeJob) {
    return {
      job: activeJob,
      enqueued: false,
      skippedReason: "active_job",
    };
  }

  const dailySince = new Date(
    now.getTime() - ORDERS_RECONCILIATION_INTERVAL_MS,
  ).toISOString();
  const { data: recentSuccessfulJobs, error: recentSuccessfulError } =
    await supabase
      .from("sync_jobs")
      .select("*")
      .eq("shop_domain", shop)
      .eq("job_type", "orders_reconciliation_48h")
      .eq("status", "success")
      .gte("finished_at", dailySince)
      .order("finished_at", { ascending: false })
      .limit(1);

  if (recentSuccessfulError) {
    throw new Error(recentSuccessfulError.message);
  }

  const recentSuccessfulJob = ((recentSuccessfulJobs ?? [])[0] ??
    null) as SyncJobRow | null;

  if (recentSuccessfulJob) {
    return {
      job: recentSuccessfulJob,
      enqueued: false,
      skippedReason: "recent_success",
    };
  }

  const { data: recentSuccessfulRuns, error: recentSuccessfulRunsError } =
    await supabase
      .from("sync_runs")
      .select("id")
      .eq("shop_domain", shop)
      .eq("sync_type", "orders_reconciliation_48h")
      .eq("status", "success")
      .gte("finished_at", dailySince)
      .order("finished_at", { ascending: false })
      .limit(1);

  if (recentSuccessfulRunsError) {
    throw new Error(recentSuccessfulRunsError.message);
  }

  if ((recentSuccessfulRuns ?? []).length > 0) {
    return {
      job: null,
      enqueued: false,
      skippedReason: "recent_success",
    };
  }

  const window = getOrdersReconciliationWindow(now);
  const { data, error } = await supabase
    .from("sync_jobs")
    .insert({
      shop_domain: shop,
      job_type: "orders_reconciliation_48h",
      status: "pending",
      current_step: "orders_reconciliation_48h",
      progress: {
        orders_reconciliation_48h: window,
      },
      counts: {},
      details: {
        source: "cron",
        cadence: "6_hours",
        window,
      },
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    job: data as SyncJobRow,
    enqueued: true,
    skippedReason: null,
  };
}

export async function getRunnableOrdersReconciliation48hJobs({
  supabase,
  limit,
}: {
  supabase: SupabaseAdminClient;
  limit: number;
}) {
  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("job_type", "orders_reconciliation_48h")
    .in("status", ["pending", "running"])
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SyncJobRow[];
}

export async function enqueueFinancialBackfill30dJob({
  supabase,
  shop,
  force = false,
  now = new Date(),
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  force?: boolean;
  now?: Date;
}) {
  const activeJob = await getActiveBlockingJob({
    supabase,
    shop,
    jobType: "financial_backfill_30d",
  });

  if (activeJob) {
    return {
      job: activeJob,
      enqueued: false,
      skippedReason: "active_job",
    };
  }

  if (!force) {
    const recentSince = new Date(
      now.getTime() - FINANCIAL_BACKFILL_RECENT_SUCCESS_MS,
    ).toISOString();
    const { data: recentSuccessfulJobs, error: recentSuccessfulError } =
      await supabase
        .from("sync_jobs")
        .select("*")
        .eq("shop_domain", shop)
        .eq("job_type", "financial_backfill_30d")
        .eq("status", "success")
        .gte("finished_at", recentSince)
        .order("finished_at", { ascending: false })
        .limit(1);

    if (recentSuccessfulError) {
      throw new Error(recentSuccessfulError.message);
    }

    const recentSuccessfulJob = ((recentSuccessfulJobs ?? [])[0] ??
      null) as SyncJobRow | null;

    if (recentSuccessfulJob) {
      return {
        job: recentSuccessfulJob,
        enqueued: false,
        skippedReason: "recent_success",
      };
    }

    const { data: recentSuccessfulRuns, error: recentSuccessfulRunsError } =
      await supabase
        .from("sync_runs")
        .select("id")
        .eq("shop_domain", shop)
        .eq("sync_type", "financial_backfill_30d")
        .eq("status", "success")
        .gte("finished_at", recentSince)
        .order("finished_at", { ascending: false })
        .limit(1);

    if (recentSuccessfulRunsError) {
      throw new Error(recentSuccessfulRunsError.message);
    }

    if ((recentSuccessfulRuns ?? []).length > 0) {
      return {
        job: null,
        enqueued: false,
        skippedReason: "recent_success",
      };
    }
  }

  const window = getFinancialBackfillWindow(now);
  const { data, error } = await supabase
    .from("sync_jobs")
    .insert({
      shop_domain: shop,
      job_type: "financial_backfill_30d",
      status: "pending",
      current_step: "financial_backfill_30d",
      progress: {
        financial_backfill_30d: window,
      },
      counts: {},
      details: {
        source: "manual_internal",
        window,
      },
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    job: data as SyncJobRow,
    enqueued: true,
    skippedReason: null,
  };
}

export async function getRunnableFinancialBackfill30dJobs({
  supabase,
  shop,
  limit,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  limit: number;
}) {
  const { data, error } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("shop_domain", shop)
    .eq("job_type", "financial_backfill_30d")
    .in("status", ["pending", "running"])
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SyncJobRow[];
}

export async function getRunnableMarketplaceSyncJobs({
  supabase,
  limit,
}: {
  supabase: SupabaseAdminClient;
  limit: number;
}) {
  const safeLimit = Math.max(1, limit);
  const staleBefore = new Date(Date.now() - STALE_ACTIVE_JOB_MS).toISOString();
  const { data: pendingJobs, error: pendingError } = await supabase
    .from("sync_jobs")
    .select("*")
    .in("job_type", marketplaceSyncJobTypes)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(safeLimit);

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  const jobs = (pendingJobs ?? []) as SyncJobRow[];
  const remainingLimit = safeLimit - jobs.length;

  if (remainingLimit <= 0) {
    return jobs;
  }

  const { data: staleRunningJobs, error: staleRunningError } = await supabase
    .from("sync_jobs")
    .select("*")
    .in("job_type", marketplaceSyncJobTypes)
    .eq("status", "running")
    .or(`updated_at.lt.${staleBefore},started_at.lt.${staleBefore}`)
    .order("updated_at", { ascending: true })
    .limit(remainingLimit);

  if (staleRunningError) {
    throw new Error(staleRunningError.message);
  }

  return [...jobs, ...((staleRunningJobs ?? []) as SyncJobRow[])];
}

async function markStepCompleted({
  supabase,
  shop,
  job,
  step,
  counts,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  job: SyncJobRow;
  step: string;
  counts: Record<string, unknown>;
}) {
  if (step === "locations") {
    return;
  }

  await insertSyncRun({
    supabase,
    shop,
    syncType: step,
    status: "success",
    source: getSyncJobSource(job),
    startedAt: job.started_at ?? job.created_at,
    details: {
      jobId: job.id,
      batchJobType: job.job_type,
      ...counts,
    },
  });
}

async function runStepBatch({
  admin,
  shop,
  supabase,
  step,
  progress,
  jobType,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  step: string;
  progress: Record<string, unknown> | null;
  jobType: SyncJobType;
}): Promise<SyncBatchResult> {
  // Only full/full_refresh jobs (the historical-import path) use Shopify's
  // Bulk Operations API for products/inventory instead of paginated batch
  // calls — it's ~10-100x fewer round trips for a large catalog and isn't
  // bounded by MAX_STEP_BATCHES_PER_TICK, which is what made a full rebuild
  // take hours for shops with large inventories. Standalone "products"/
  // "inventory" job types (e.g. from the admin "Retry" button) keep using
  // the batch path — bulk operations are overkill for a single retry.
  const useBulk = jobType === "full" || jobType === "full_refresh";

  if (step === "locations") {
    const result = await syncLocations({
      admin,
      shop,
      supabase,
      source: "manual_admin_sync",
    });

    return {
      done: true,
      progress: {},
      counts: result,
    };
  }

  if (step === "products") {
    if (useBulk) {
      return syncProductsBulkStep({
        admin,
        shop,
        supabase,
        progress:
          (progress?.products as
            | { bulkOperationId?: string | null }
            | undefined) ?? null,
      });
    }

    return syncProductsBatch({
      admin,
      shop,
      supabase,
      progress:
        (progress?.products as { cursor?: string | null } | undefined) ?? null,
    });
  }

  if (step === "inventory") {
    if (useBulk) {
      return syncInventoryBulkStep({
        admin,
        shop,
        supabase,
        progress:
          (progress?.inventory as
            | { bulkOperationId?: string | null }
            | undefined) ?? null,
      });
    }

    return syncInventoryBatch({
      admin,
      shop,
      supabase,
      progress:
        (progress?.inventory as { offset?: number } | undefined) ?? null,
    });
  }

  if (step === "orders") {
    return syncOrdersBatch({
      admin,
      shop,
      supabase,
      progress:
        (progress?.orders as
          | {
              cursor?: string | null;
              startDate?: string | null;
              endDate?: string | null;
              fullHistory?: boolean;
              staffAttributionAvailable?: boolean;
            }
          | undefined) ?? null,
    });
  }

  if (step === "orders_reconciliation_48h") {
    return syncOrdersReconciliation48hBatch({
      admin,
      shop,
      supabase,
      progress:
        (progress?.orders_reconciliation_48h as
          | {
              cursor?: string | null;
              windowStart?: string | null;
              windowEnd?: string | null;
              staffAttributionAvailable?: boolean;
            }
          | undefined) ?? null,
    });
  }

  if (step === "financial_backfill_30d") {
    return syncFinancialBackfill30dBatch({
      admin,
      shop,
      supabase,
      progress:
        (progress?.financial_backfill_30d as
          | {
              cursor?: string | null;
              windowStart?: string | null;
              windowEnd?: string | null;
              staffAttributionAvailable?: boolean;
            }
          | undefined) ?? null,
    });
  }

  throw new Error(`Unknown sync job step: ${step}`);
}

async function runStepToCompletion({
  admin,
  shop,
  supabase,
  step,
  progress,
  jobType,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  step: string;
  progress: Record<string, unknown> | null;
  jobType: SyncJobType;
}) {
  const isBulkStep =
    (jobType === "full" || jobType === "full_refresh") &&
    (step === "products" || step === "inventory");
  let currentProgress = progress;
  let accumulatedCounts: Record<string, unknown> = {};
  let batchesProcessed = 0;

  while (batchesProcessed < MAX_STEP_BATCHES_PER_TICK) {
    const batchResult = await runStepBatch({
      admin,
      shop,
      supabase,
      step,
      jobType,
      progress: {
        [step]: currentProgress,
      },
    });

    batchesProcessed += 1;
    currentProgress = batchResult.progress;
    accumulatedCounts = addBatchCounts(accumulatedCounts, batchResult.counts);

    if (batchResult.done) {
      return {
        done: true,
        progress: currentProgress,
        counts: accumulatedCounts,
        batchesProcessed,
      };
    }

    // A bulk operation still running server-side won't change status within
    // the same tick — retrying immediately would just repeat the same status
    // check up to MAX_STEP_BATCHES_PER_TICK times for no benefit. Yield back
    // to "pending" now; the next tick (cron or manual) checks again.
    if (isBulkStep) {
      break;
    }
  }

  return {
    done: false,
    progress: currentProgress,
    counts: accumulatedCounts,
    batchesProcessed,
  };
}

export async function processManualSyncJobBatch({
  admin,
  supabase,
  shop,
  jobId,
  preserveQueuedOnFailure = false,
}: {
  admin: ShopifyAdminClient;
  supabase: SupabaseAdminClient;
  shop: string;
  jobId: string;
  preserveQueuedOnFailure?: boolean;
}): Promise<ProcessManualSyncJobResult> {
  const { data: jobData, error: jobError } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("shop_domain", shop)
    .eq("id", jobId)
    .single();

  if (jobError) {
    throw new Error(jobError.message);
  }

  const job = jobData as SyncJobRow;

  if (isTerminalStatus(job.status)) {
    return {
      job,
      processed: false,
      skippedReason: "terminal_status",
    };
  }

  const isStaleRetry = isStaleActiveJob(job);
  if (job.status === "running" && !isStaleRetry) {
    return {
      job,
      processed: false,
      skippedReason: "already_running",
    };
  }

  const previousStatus = job.status;
  const startedAt = job.started_at ?? new Date().toISOString();
  const processingStartedAtMs = Date.now();
  const staleRetryCount =
    typeof job.details?.staleRetryCount === "number"
      ? job.details.staleRetryCount + (isStaleRetry ? 1 : 0)
      : isStaleRetry
        ? 1
        : 0;

  if (
    isStaleRetry &&
    hasCounts(job.counts) &&
    !job.error_message &&
    !hasContinuationProgress(job)
  ) {
    const { data: finalizedJob, error: finalizedJobError } = await supabase
      .from("sync_jobs")
      .update({
        status: "success",
        error_message: null,
        details: {
          ...(job.details ?? {}),
          finalized: true,
          finalizedFromStaleRunning: true,
        },
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("shop_domain", shop)
      .eq("id", job.id)
      .select("*")
      .single();

    if (finalizedJobError) {
      throw new Error(finalizedJobError.message);
    }

    const finalJob = finalizedJob as SyncJobRow;
    logJobTransition({
      job: finalJob,
      previousStatus,
      finalStatus: finalJob.status,
      startedAtMs: processingStartedAtMs,
      finalized: true,
    });

    return {
      job: finalJob,
      processed: true,
    };
  }

  if (isStaleRetry && staleRetryCount > MAX_STALE_RETRY_COUNT) {
    const { data: failedJob, error: failedJobError } = await supabase
      .from("sync_jobs")
      .update({
        status: "error",
        error_message: "Sync job exceeded stale retry limit.",
        details: {
          ...(job.details ?? {}),
          staleRetryCount,
          staleRetryLimit: MAX_STALE_RETRY_COUNT,
        },
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("shop_domain", shop)
      .eq("id", job.id)
      .select("*")
      .single();

    if (failedJobError) {
      throw new Error(failedJobError.message);
    }

    const finalJob = failedJob as SyncJobRow;
    logJobTransition({
      job: finalJob,
      previousStatus,
      finalStatus: finalJob.status,
      startedAtMs: processingStartedAtMs,
      finalized: finalJob.status === "success",
    });

    return {
      job: finalJob,
      processed: true,
    };
  }
  const { data: claimedJobs, error: claimError } = await supabase
    .from("sync_jobs")
    .update({
      status: "running",
      started_at: startedAt,
      finished_at: null,
      error_message: null,
      details: {
        ...(job.details ?? {}),
        ...(isStaleRetry
          ? {
              staleRetryCount,
              staleRetriedAt: new Date().toISOString(),
            }
          : {}),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("shop_domain", shop)
    .eq("id", job.id)
    .eq("updated_at", job.updated_at)
    .eq("status", previousStatus)
    .select("*")
    .limit(1);

  if (claimError) {
    throw new Error(claimError.message);
  }

  const claimedJob = ((claimedJobs ?? [])[0] ?? null) as SyncJobRow | null;

  if (!claimedJob) {
    const { data: latestJob, error: latestJobError } = await supabase
      .from("sync_jobs")
      .select("*")
      .eq("shop_domain", shop)
      .eq("id", job.id)
      .single();

    if (latestJobError) {
      throw new Error(latestJobError.message);
    }

    return {
      job: latestJob as SyncJobRow,
      processed: false,
      skippedReason: "claim_lost",
    };
  }

  const step = claimedJob.current_step ?? getInitialStep(claimedJob.job_type);
  let failedStep = step;

  try {
    let currentStep: string | null = step;
    let nextProgress = { ...(claimedJob.progress ?? {}) };
    let nextCounts = { ...(claimedJob.counts ?? {}) };
    const completedSteps: string[] = [];

    while (currentStep) {
      failedStep = currentStep;
      const stepResult = await runStepToCompletion({
        admin,
        shop,
        supabase,
        step: currentStep,
        jobType: claimedJob.job_type,
        progress: getProgressForStep(
          { ...claimedJob, progress: nextProgress },
          currentStep,
        ),
      });

      nextProgress = {
        ...nextProgress,
        [currentStep]: stepResult.progress,
      };
      const existingStepCounts =
        (nextCounts[currentStep] as Record<string, unknown> | undefined) ?? {};
      nextCounts = setStepCounts(nextCounts, currentStep, {
        ...addBatchCounts(existingStepCounts, stepResult.counts),
        batchesProcessed:
          Number(existingStepCounts.batchesProcessed ?? 0) +
          stepResult.batchesProcessed,
      });

      if (!stepResult.done) {
        const { data: continuedJob, error: continuationError } = await supabase
          .from("sync_jobs")
          .update({
            status: "pending",
            current_step: currentStep,
            progress: nextProgress,
            counts: nextCounts,
            details: {
              ...(claimedJob.details ?? {}),
              continued: true,
            },
            updated_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("shop_domain", shop)
          .eq("id", job.id)
          .eq("status", "running")
          .select("*")
          .single();
        if (continuationError) throw new Error(continuationError.message);
        return { job: continuedJob as SyncJobRow, processed: true };
      }
      completedSteps.push(currentStep);

      await markStepCompleted({
        supabase,
        shop,
        job: claimedJob,
        step: currentStep,
        counts: (nextCounts[currentStep] as Record<string, unknown>) ?? {},
      });

      currentStep =
        claimedJob.job_type === "full" || claimedJob.job_type === "full_refresh"
          ? getNextFullStep(currentStep)
          : null;
    }

    const { data: updatedJob, error: updateError } = await supabase
      .from("sync_jobs")
      .update({
        status: "success",
        current_step: completedSteps.at(-1) ?? step,
        progress: nextProgress,
        counts: nextCounts,
        details: {
          ...(claimedJob.details ?? {}),
          completedSteps,
          finalized: true,
        },
        started_at: startedAt,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("shop_domain", shop)
      .eq("id", job.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    const finalJob = updatedJob as SyncJobRow;
    logJobTransition({
      job: finalJob,
      previousStatus,
      finalStatus: finalJob.status,
      startedAtMs: processingStartedAtMs,
      finalized: true,
    });

    return {
      job: finalJob,
      processed: true,
    };
  } catch (error) {
    const errorMessage = getSafeErrorMessage(error);
    const errorDetails = getErrorDetails(error);
    const authenticationRequired =
      isShopifyAuthenticationRequiredError(error);
    const keepQueued = preserveQueuedOnFailure && !authenticationRequired;

    try {
      await insertSyncRun({
        supabase,
        shop,
        syncType: failedStep,
        status: "error",
        source: getSyncJobSource(claimedJob),
        startedAt,
        errorMessage,
        details: {
          jobId: claimedJob.id,
          batchJobType: claimedJob.job_type,
          failedStep,
          ...getProgressForStep(claimedJob, failedStep),
          errorDetails,
        },
      });
    } catch (historyError) {
      console.error("[sync-jobs] failed to record error history", {
        jobId: claimedJob.id,
        shop,
        error: getSafeErrorMessage(historyError),
      });
    }

    const { data: updatedJob, error: updateError } = await supabase
      .from("sync_jobs")
      .update({
        status: keepQueued ? "pending" : "error",
        current_step: failedStep,
        error_message: keepQueued ? null : errorMessage,
        details: {
          ...(claimedJob.details ?? {}),
          failedStep,
          errorDetails,
          ...(authenticationRequired
            ? {
                errorCode: "shopify_authentication_required",
                authenticationRequired: true,
              }
            : {}),
          ...(keepQueued
            ? {
                immediatePassFailedAt: new Date().toISOString(),
                immediatePassError: errorMessage,
              }
            : {}),
        },
        started_at: startedAt,
        updated_at: new Date().toISOString(),
        finished_at: keepQueued ? null : new Date().toISOString(),
      })
      .eq("shop_domain", shop)
      .eq("id", job.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    const finalJob = updatedJob as SyncJobRow;
    logJobTransition({
      job: finalJob,
      previousStatus,
      finalStatus: finalJob.status,
      startedAtMs: processingStartedAtMs,
    });

    return {
      job: finalJob,
      processed: true,
    };
  }
}

export type ProcessSyncJobsSummary = {
  processed: number;
  completed: number;
  failed: number;
  skipped: number;
  jobs: Array<{
    id: string;
    type: string;
    previousStatus: string;
    finalStatus: string;
    processed: boolean;
    skippedReason?: string | null;
    errorMessage?: string | null;
  }>;
};

export async function processSyncJobsBatch({
  supabase,
  limit = 5,
  getAdminClient,
}: {
  supabase: SupabaseAdminClient;
  limit?: number;
  getAdminClient: (shop: string) => Promise<ShopifyAdminClient>;
}): Promise<ProcessSyncJobsSummary> {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 10) : 5;
  const jobs = await getRunnableMarketplaceSyncJobs({
    supabase,
    limit: safeLimit,
  });
  const summary: ProcessSyncJobsSummary = {
    processed: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    jobs: [],
  };

  const jobsByShop = new Map<string, SyncJobRow[]>();
  for (const job of jobs) {
    const lane = jobsByShop.get(job.shop_domain) ?? [];
    lane.push(job);
    jobsByShop.set(job.shop_domain, lane);
  }

  const laneResults = await mapWithConcurrency(
    Array.from(jobsByShop.values()),
    3,
    async (shopJobs) => {
      const results: Array<{
        processed: number;
        completed: number;
        failed: number;
        skipped: number;
        job: ProcessSyncJobsSummary["jobs"][number];
      }> = [];

      // A shop's jobs stay ordered to avoid competing Shopify pagination and
      // write streams, while different shops can progress in parallel.
      for (const job of shopJobs) {
        const previousStatus = job.status;
        try {
          const admin = await getAdminClient(job.shop_domain);
          const result = await processManualSyncJobBatch({
            admin,
            supabase,
            shop: job.shop_domain,
            jobId: job.id,
          });
          results.push({
            processed: result.processed ? 1 : 0,
            completed: result.job.status === "success" ? 1 : 0,
            failed: result.job.status === "error" ? 1 : 0,
            skipped: result.processed ? 0 : 1,
            job: {
              id: result.job.id,
              type: result.job.job_type,
              previousStatus,
              finalStatus: result.job.status,
              processed: result.processed,
              skippedReason: result.skippedReason ?? null,
              errorMessage: result.job.error_message,
            },
          });
        } catch (error) {
          const errorMessage = getSafeErrorMessage(error);
          if (isShopifyAuthenticationRequiredError(error)) {
            const failedJob = await markSyncJobAuthenticationRequired({
              supabase,
              job,
            });
            results.push({
              processed: 1,
              completed: 0,
              failed: 1,
              skipped: 0,
              job: {
                id: failedJob.id,
                type: failedJob.job_type,
                previousStatus,
                finalStatus: "error",
                processed: true,
                skippedReason: null,
                errorMessage: SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE,
              },
            });
          } else {
            results.push({
              processed: 0,
              completed: 0,
              failed: 1,
              skipped: 0,
              job: {
                id: job.id,
                type: job.job_type,
                previousStatus,
                finalStatus: "error",
                processed: false,
                skippedReason: null,
                errorMessage,
              },
            });
          }
        }
      }

      return results;
    },
  );

  for (const result of laneResults.flat()) {
    summary.processed += result.processed;
    summary.completed += result.completed;
    summary.failed += result.failed;
    summary.skipped += result.skipped;
    summary.jobs.push(result.job);
  }

  return summary;
}
