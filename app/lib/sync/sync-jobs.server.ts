import { getSupabaseAdminClient } from "../db/supabase.server";
import type { SyncBatchResult, SyncSource } from "./shopify-sync.server";
import {
  syncFinancialBackfill30dBatch,
  syncInventoryBatch,
  syncLocations,
  syncOrdersBatch,
  syncOrdersReconciliation48hBatch,
  syncProductsBatch,
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

const fullSyncSteps = ["locations", "products", "inventory", "orders"];
const STALE_ACTIVE_JOB_MS = 30 * 60 * 1000;
const ORDERS_RECONCILIATION_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ORDERS_RECONCILIATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const FINANCIAL_BACKFILL_RECENT_SUCCESS_MS = 24 * 60 * 60 * 1000;
const FINANCIAL_BACKFILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function getInitialStep(jobType: SyncJobType) {
  return jobType === "full" ? fullSyncSteps[0] : jobType;
}

function getNextFullStep(currentStep: string | null) {
  const currentIndex = fullSyncSteps.indexOf(currentStep ?? "");

  if (currentIndex === -1) {
    return fullSyncSteps[0];
  }

  return fullSyncSteps[currentIndex + 1] ?? null;
}

function mergeCounts(
  existing: Record<string, unknown> | null | undefined,
  step: string,
  batchCounts: Record<string, unknown>,
) {
  const next = { ...(existing ?? {}) };
  const stepCounts = {
    ...(((next[step] as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >),
  };

  for (const [key, value] of Object.entries(batchCounts)) {
    if (typeof value === "number") {
      stepCounts[key] = Number(stepCounts[key] ?? 0) + value;
      continue;
    }

    stepCounts[key] = value;
  }

  next[step] = stepCounts;

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
  if (job.status !== "pending" && job.status !== "running") {
    return false;
  }

  const activityTime = new Date(job.updated_at ?? job.created_at).getTime();

  return Number.isFinite(activityTime)
    ? Date.now() - activityTime > STALE_ACTIVE_JOB_MS
    : false;
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
    jobType === "full"
      ? [
          ...fullSyncSteps,
          "full",
          "orders_reconciliation_48h",
          "financial_backfill_30d",
        ]
      : jobType === "orders_reconciliation_48h"
        ? [
            "orders_reconciliation_48h",
            "orders",
            "full",
            "financial_backfill_30d",
          ]
        : jobType === "financial_backfill_30d"
          ? [
              "financial_backfill_30d",
              "orders_reconciliation_48h",
              "orders",
              "full",
            ]
          : [jobType, "full"];

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

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? [])[0] ?? null) as SyncJobRow | null;
}

export async function createManualSyncJob({
  supabase,
  shop,
  jobType,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  jobType: SyncJobType;
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
      progress: {},
      counts: {},
      details: {
        source: "manual_admin_sync",
      },
    })
    .select("*")
    .single();

  if (error) {
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
    now.getTime() - ORDERS_RECONCILIATION_DAILY_INTERVAL_MS,
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
        cadence: "daily",
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
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  step: string;
  progress: Record<string, unknown> | null;
}): Promise<SyncBatchResult> {
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
    return syncProductsBatch({
      admin,
      shop,
      supabase,
      progress:
        (progress?.products as { cursor?: string | null } | undefined) ?? null,
    });
  }

  if (step === "inventory") {
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

export async function processManualSyncJobBatch({
  admin,
  supabase,
  shop,
  jobId,
}: {
  admin: ShopifyAdminClient;
  supabase: SupabaseAdminClient;
  shop: string;
  jobId: string;
}) {
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

  if (["success", "error", "cancelled"].includes(job.status)) {
    return {
      job,
      processed: false,
    };
  }

  if (isStaleActiveJob(job)) {
    const { data: cancelledJob, error: cancelError } = await supabase
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
      .eq("id", job.id)
      .select("*")
      .single();

    if (cancelError) {
      throw new Error(cancelError.message);
    }

    return {
      job: cancelledJob as SyncJobRow,
      processed: false,
    };
  }

  const startedAt = job.started_at ?? new Date().toISOString();
  const { data: claimedJobs, error: claimError } = await supabase
    .from("sync_jobs")
    .update({
      status: "running",
      started_at: startedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_domain", shop)
    .eq("id", job.id)
    .eq("updated_at", job.updated_at)
    .in("status", ["pending", "running"])
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
    };
  }

  const step = claimedJob.current_step ?? getInitialStep(claimedJob.job_type);

  try {
    const batchResult = await runStepBatch({
      admin,
      shop,
      supabase,
      step,
      progress: claimedJob.progress ?? {},
    });
    const nextProgress = {
      ...(claimedJob.progress ?? {}),
      [step]: batchResult.progress,
    };
    const nextCounts = mergeCounts(claimedJob.counts, step, batchResult.counts);
    const nextStep =
      batchResult.done && claimedJob.job_type === "full"
        ? getNextFullStep(step)
        : step;
    const isDone =
      batchResult.done && (!nextStep || claimedJob.job_type !== "full");

    if (batchResult.done) {
      await markStepCompleted({
        supabase,
        shop,
        job: claimedJob,
        step,
        counts: (nextCounts[step] as Record<string, unknown>) ?? {},
      });
    }

    const { data: updatedJob, error: updateError } = await supabase
      .from("sync_jobs")
      .update({
        status: isDone ? "success" : "running",
        current_step: isDone ? step : nextStep,
        progress: nextProgress,
        counts: nextCounts,
        details: {
          ...(claimedJob.details ?? {}),
          lastBatch: {
            step,
            done: batchResult.done,
            counts: batchResult.counts,
          },
        },
        started_at: startedAt,
        updated_at: new Date().toISOString(),
        finished_at: isDone ? new Date().toISOString() : null,
      })
      .eq("shop_domain", shop)
      .eq("id", job.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      job: updatedJob as SyncJobRow,
      processed: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorDetails = getErrorDetails(error);

    await insertSyncRun({
      supabase,
      shop,
      syncType: step,
      status: "error",
      source: getSyncJobSource(claimedJob),
      startedAt,
      errorMessage,
      details: {
        jobId: claimedJob.id,
        batchJobType: claimedJob.job_type,
        failedStep: step,
        ...getProgressForStep(claimedJob, step),
        errorDetails,
      },
    });

    const { data: updatedJob, error: updateError } = await supabase
      .from("sync_jobs")
      .update({
        status: "error",
        current_step: step,
        error_message: errorMessage,
        details: {
          ...(claimedJob.details ?? {}),
          failedStep: step,
          errorDetails,
        },
        started_at: startedAt,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("shop_domain", shop)
      .eq("id", job.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      job: updatedJob as SyncJobRow,
      processed: true,
    };
  }
}
