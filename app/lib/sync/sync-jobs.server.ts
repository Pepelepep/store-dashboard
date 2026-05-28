import { getSupabaseAdminClient } from "../db/supabase.server";
import type {
  SyncBatchResult,
  SyncSource,
} from "./shopify-sync.server";
import {
  syncInventoryBatch,
  syncLocations,
  syncOrdersBatch,
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
  locked_by: string | null;
  locked_at: string | null;
  attempts: number | null;
  max_attempts: number | null;
  last_heartbeat_at: string | null;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
  created_at: string;
};

const fullSyncSteps = ["locations", "products", "inventory", "orders"];
const STALE_ACTIVE_JOB_MS = 30 * 60 * 1000;
const STALE_WORKER_LOCK_MS = 5 * 60 * 1000;

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

async function releaseStaleWorkerLocks({
  supabase,
}: {
  supabase: SupabaseAdminClient;
}) {
  const staleBefore = new Date(Date.now() - STALE_WORKER_LOCK_MS).toISOString();
  const { error } = await supabase
    .from("sync_jobs")
    .update({
      locked_by: null,
      locked_at: null,
      updated_at: new Date().toISOString(),
      details: {
        staleWorkerLockReleased: true,
        staleLockTimeoutMinutes: STALE_WORKER_LOCK_MS / 60000,
      },
    })
    .in("status", ["pending", "running"])
    .not("locked_at", "is", null)
    .lt("locked_at", staleBefore);

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
    jobType === "full" ? [...fullSyncSteps, "full"] : [jobType, "full"];

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

export async function claimNextSyncJobForWorker({
  supabase,
  workerId,
}: {
  supabase: SupabaseAdminClient;
  workerId: string;
}) {
  await releaseStaleWorkerLocks({ supabase });

  for (const status of ["running", "pending"] as const) {
    const { data: candidates, error: candidatesError } = await supabase
      .from("sync_jobs")
      .select("*")
      .eq("status", status)
      .is("locked_by", null)
      .order("created_at", { ascending: true })
      .limit(10);

    if (candidatesError) {
      throw new Error(candidatesError.message);
    }

    for (const candidate of (candidates ?? []) as SyncJobRow[]) {
      const startedAt = candidate.started_at ?? new Date().toISOString();
      const { data: claimedJobs, error: claimError } = await supabase
        .from("sync_jobs")
        .update({
          status: "running",
          locked_by: workerId,
          locked_at: new Date().toISOString(),
          last_heartbeat_at: new Date().toISOString(),
          started_at: startedAt,
          attempts:
            candidate.status === "pending"
              ? Number(candidate.attempts ?? 0) + 1
              : Number(candidate.attempts ?? 0),
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .eq("updated_at", candidate.updated_at)
        .is("locked_by", null)
        .in("status", ["pending", "running"])
        .select("*")
        .limit(1);

      if (claimError) {
        throw new Error(claimError.message);
      }

      const claimedJob = ((claimedJobs ?? [])[0] ?? null) as SyncJobRow | null;

      if (claimedJob) {
        return claimedJob;
      }
    }
  }

  return null;
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
    source: "manual_admin_sync",
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

  throw new Error(`Unknown sync job step: ${step}`);
}

export async function processClaimedSyncJobBatch({
  admin,
  supabase,
  job,
  workerId,
}: {
  admin: ShopifyAdminClient;
  supabase: SupabaseAdminClient;
  job: SyncJobRow;
  workerId: string;
}) {
  if (job.locked_by !== workerId) {
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
        locked_by: null,
        locked_at: null,
        error_message:
          "Sync job was cancelled because it was stale and no longer processing.",
        details: {
          stale: true,
          staleTimeoutMinutes: STALE_ACTIVE_JOB_MS / 60000,
        },
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("locked_by", workerId)
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

  const step = job.current_step ?? getInitialStep(job.job_type);
  const startedAt = job.started_at ?? new Date().toISOString();

  try {
    const batchResult = await runStepBatch({
      admin,
      shop: job.shop_domain,
      supabase,
      step,
      progress: job.progress ?? {},
    });
    const nextProgress = {
      ...(job.progress ?? {}),
      [step]: batchResult.progress,
    };
    const nextCounts = mergeCounts(job.counts, step, batchResult.counts);
    const nextStep =
      batchResult.done && job.job_type === "full"
        ? getNextFullStep(step)
        : step;
    const isDone = batchResult.done && (!nextStep || job.job_type !== "full");

    if (batchResult.done) {
      await markStepCompleted({
        supabase,
        shop: job.shop_domain,
        job,
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
          lastBatch: {
            step,
            done: batchResult.done,
            counts: batchResult.counts,
            workerId,
          },
        },
        locked_by: null,
        locked_at: null,
        last_heartbeat_at: new Date().toISOString(),
        started_at: startedAt,
        updated_at: new Date().toISOString(),
        finished_at: isDone ? new Date().toISOString() : null,
      })
      .eq("id", job.id)
      .eq("locked_by", workerId)
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
      shop: job.shop_domain,
      syncType: step,
      status: "error",
      source: "manual_admin_sync",
      startedAt,
      errorMessage,
      details: {
        jobId: job.id,
        batchJobType: job.job_type,
        failedStep: step,
        workerId,
        errorDetails,
      },
    });

    const { data: updatedJob, error: updateError } = await supabase
      .from("sync_jobs")
      .update({
        status: "error",
        current_step: step,
        locked_by: null,
        locked_at: null,
        error_message: errorMessage,
        details: {
          failedStep: step,
          workerId,
          errorDetails,
        },
        started_at: startedAt,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("locked_by", workerId)
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
