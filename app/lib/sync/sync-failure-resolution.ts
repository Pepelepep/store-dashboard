type SyncRunForResolution = {
  id?: string;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  details?: Record<string, unknown> | null;
};

type SyncJobForResolution = {
  id?: string;
  job_type: string;
  status: string;
  current_step?: string | null;
  created_at: string;
  started_at?: string | null;
  updated_at: string;
  finished_at?: string | null;
  details?: Record<string, unknown> | null;
};

type WebhookEventForResolution = {
  id?: string;
  topic: string;
  status: string;
  attempt_count?: number;
  received_at: string;
  processed_at?: string | null;
};

type SyncResource =
  | "locations"
  | "products"
  | "inventory"
  | "orders"
  | "staff_members"
  | "financial_backfill";

type Failure = {
  occurredAt: number;
  resource: SyncResource | null;
  requiresCompletedJob: boolean;
  attemptKey: string;
  countsAsDistinctAttempt: boolean;
  repeatedAttempt: boolean;
  authenticationRequired: boolean;
};

type Recovery = {
  completedAt: number;
  resources: Set<SyncResource>;
  completedJob: boolean;
};

const CORE_SYNC_RESOURCES: SyncResource[] = [
  "locations",
  "products",
  "inventory",
  "orders",
];

export const SYNC_FAILURE_WARNING_THRESHOLD_MS = 15 * 60 * 1000;

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeResource(value: string | null | undefined) {
  if (!value) return null;
  if (value === "locations") return "locations";
  if (value === "products") return "products";
  if (value === "inventory") return "inventory";
  if (value === "orders" || value === "orders_reconciliation_48h") {
    return "orders";
  }
  if (value === "staff_members") return "staff_members";
  if (value === "financial_backfill_30d") return "financial_backfill";
  return null;
}

function resourcesCoveredByJob(jobType: string) {
  if (jobType === "full" || jobType === "full_refresh") {
    return new Set<SyncResource>(CORE_SYNC_RESOURCES);
  }

  const resource = normalizeResource(jobType);
  return new Set<SyncResource>(resource ? [resource] : []);
}

function resourceForWebhookTopic(topic: string) {
  const normalized = topic.toLowerCase().replaceAll("_", "-");
  if (normalized.startsWith("orders/")) return "orders";
  if (normalized.startsWith("products/")) return "products";
  if (
    normalized.startsWith("inventory/") ||
    normalized.startsWith("inventory-")
  ) {
    return "inventory";
  }
  return null;
}

function isCovered(failure: Failure, recovery: Recovery) {
  if (recovery.completedAt <= failure.occurredAt) {
    return false;
  }
  if (failure.requiresCompletedJob && !recovery.completedJob) {
    return false;
  }
  return Boolean(
    failure.resource && recovery.resources.has(failure.resource),
  );
}

export function getUnresolvedSyncFailureState({
  runs,
  jobs,
  webhookEvents,
}: {
  runs: SyncRunForResolution[];
  jobs: SyncJobForResolution[];
  webhookEvents: WebhookEventForResolution[];
}) {
  const failures: Failure[] = [];
  const recoveries: Recovery[] = [];

  for (const run of runs) {
    const occurredAt = timestamp(run.finished_at ?? run.started_at);
    const resource = normalizeResource(run.sync_type);
    if (occurredAt === null || !resource) continue;

    if (run.status === "error") {
      const parentJobId =
        typeof run.details?.jobId === "string" ? run.details.jobId : null;
      failures.push({
        occurredAt,
        resource,
        requiresCompletedJob: Boolean(parentJobId),
        attemptKey:
          parentJobId ??
          `run:${run.id ?? `${run.sync_type}:${occurredAt}`}`,
        countsAsDistinctAttempt: true,
        repeatedAttempt: false,
        authenticationRequired: false,
      });
    } else if (run.status === "success" && !run.details?.jobId) {
      recoveries.push({
        completedAt: occurredAt,
        resources: new Set([resource]),
        completedJob: false,
      });
    }
  }

  for (const job of jobs) {
    const occurredAt = timestamp(
      job.finished_at ?? job.updated_at ?? job.started_at ?? job.created_at,
    );
    if (occurredAt === null) continue;

    const resources = resourcesCoveredByJob(job.job_type);
    if (resources.size === 0) continue;

    if (job.status === "error") {
      const attemptKey = `job:${job.id ?? `${job.job_type}:${occurredAt}`}`;
      const staleRetryCount = Number(job.details?.staleRetryCount ?? 0);
      const authenticationRequired =
        job.details?.authenticationRequired === true ||
        job.details?.errorCode === "shopify_authentication_required";
      for (const resource of resources) {
        failures.push({
          occurredAt,
          resource,
          requiresCompletedJob: true,
          attemptKey,
          countsAsDistinctAttempt: true,
          repeatedAttempt:
            Number.isFinite(staleRetryCount) && staleRetryCount > 0,
          authenticationRequired,
        });
      }
    } else if (job.status === "success" && job.finished_at) {
      recoveries.push({
        completedAt: occurredAt,
        resources,
        completedJob: true,
      });
    }
  }

  for (const event of webhookEvents) {
    if (event.status !== "error") continue;
    const occurredAt = timestamp(event.processed_at ?? event.received_at);
    if (occurredAt === null) continue;

    failures.push({
      occurredAt,
      resource: resourceForWebhookTopic(event.topic),
      requiresCompletedJob: true,
      attemptKey: `webhook:${event.id ?? `${event.topic}:${occurredAt}`}`,
      countsAsDistinctAttempt: false,
      repeatedAttempt: Number(event.attempt_count ?? 0) >= 2,
      authenticationRequired: false,
    });
  }

  const unresolvedFailures = failures.filter(
    (failure) =>
      !recoveries.some((recovery) => isCovered(failure, recovery)),
  );
  const latestUnresolvedFailure = unresolvedFailures.reduce(
    (latest, failure) => Math.max(latest, failure.occurredAt),
    Number.NEGATIVE_INFINITY,
  );
  const oldestUnresolvedFailure = unresolvedFailures.reduce(
    (oldest, failure) => Math.min(oldest, failure.occurredAt),
    Number.POSITIVE_INFINITY,
  );
  const attemptKeysByResource = new Map<string, Set<string>>();
  for (const failure of unresolvedFailures) {
    if (!failure.resource || !failure.countsAsDistinctAttempt) continue;
    const attempts =
      attemptKeysByResource.get(failure.resource) ?? new Set<string>();
    attempts.add(failure.attemptKey);
    attemptKeysByResource.set(failure.resource, attempts);
  }
  const hasRepeatedUnresolvedFailures =
    unresolvedFailures.some((failure) => failure.repeatedAttempt) ||
    [...attemptKeysByResource.values()].some((attempts) => attempts.size >= 2);

  return {
    hasUnresolvedFailure: unresolvedFailures.length > 0,
    latestUnresolvedFailureAt: Number.isFinite(latestUnresolvedFailure)
      ? new Date(latestUnresolvedFailure).toISOString()
      : null,
    oldestUnresolvedFailureAt: Number.isFinite(oldestUnresolvedFailure)
      ? new Date(oldestUnresolvedFailure).toISOString()
      : null,
    hasRepeatedUnresolvedFailures,
    hasUnresolvedAuthenticationFailure: unresolvedFailures.some(
      (failure) => failure.authenticationRequired,
    ),
  };
}

export type SyncFailureResolutionState = ReturnType<
  typeof getUnresolvedSyncFailureState
>;

export function getSyncFailureBannerState({
  resolution,
  canAdmin,
  now = Date.now(),
}: {
  resolution: SyncFailureResolutionState;
  canAdmin: boolean;
  now?: number;
}) {
  if (!resolution.hasUnresolvedFailure) {
    return {
      kind: "hidden" as const,
      showReconnectAction: false as const,
    };
  }

  if (resolution.hasUnresolvedAuthenticationFailure) {
    return {
      kind: "authentication_required" as const,
      title: "Some Shopify data may be delayed.",
      message: canAdmin
        ? "Shopify needs to be reconnected before syncing can continue."
        : "Shopify data will resume after an app admin restores the connection.",
      showReconnectAction: canAdmin,
    };
  }

  const oldestFailureAt = timestamp(resolution.oldestUnresolvedFailureAt);
  const persistent =
    oldestFailureAt === null ||
    now - oldestFailureAt >= SYNC_FAILURE_WARNING_THRESHOLD_MS;
  if (!persistent && !resolution.hasRepeatedUnresolvedFailures) {
    return {
      kind: "hidden" as const,
      showReconnectAction: false as const,
    };
  }

  return {
    kind: "delayed_data" as const,
    title: "Some Shopify data may be delayed.",
    message: "ShopOps is retrying automatically. No action is required.",
    showReconnectAction: false,
  };
}
