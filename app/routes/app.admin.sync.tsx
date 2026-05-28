import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import {
  createManualSyncJob,
  processManualSyncJobBatch,
} from "../lib/sync/sync-jobs.server";
import type {
  SyncJobRow,
  SyncJobType,
} from "../lib/sync/sync-jobs.server";
import { AppButton } from "../components/ui/AppButton";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";
import { StatusBadge } from "../components/ui/StatusBadge";

type TableCount = {
  table: string;
  count: number;
  error?: string;
};

type SyncRun = {
  id: string;
  sync_type: string;
  status: string;
  source: string | null;
  started_at: string;
  finished_at?: string | null;
  error_message?: string | null;
  details?: Record<string, unknown> | null;
};

type LoaderData = {
  shop: string;
  counts: TableCount[];
  lastSyncRuns: SyncRun[];
  activeJob: SyncJobRow | null;
  recentJobs: SyncJobRow[];
};

type ActionData = {
  ok: boolean;
  message: string;
  intent?: string;
  failedStep?: string | null;
  details?: unknown;
  job?: SyncJobRow;
};

type SyncTypeConfig = {
  syncType: string;
  label: string;
  actionLabel: string;
  intent: string;
};

const freshnessMs = 24 * 60 * 60 * 1000;
const syncTypeConfigs: SyncTypeConfig[] = [
  {
    syncType: "locations",
    label: "Locations",
    actionLabel: "Sync Locations",
    intent: "sync_locations",
  },
  {
    syncType: "products",
    label: "Products",
    actionLabel: "Start Products Sync",
    intent: "sync_products",
  },
  {
    syncType: "inventory",
    label: "Inventory",
    actionLabel: "Start Inventory Sync",
    intent: "sync_inventory",
  },
  {
    syncType: "orders",
    label: "Orders",
    actionLabel: "Start Orders Sync",
    intent: "sync_orders",
  },
];

async function getTableCount({
  table,
  shop,
  supabase,
}: {
  table: string;
  shop: string;
  supabase: ReturnType<typeof getSupabaseAdminClient>;
}): Promise<TableCount> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("shop_domain", shop);

  return {
    table,
    count: count ?? 0,
    error: error?.message,
  };
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt || !finishedAt) {
    return "-";
  }

  const started = new Date(startedAt).getTime();
  const finished = new Date(finishedAt).getTime();

  if (Number.isNaN(started) || Number.isNaN(finished) || finished < started) {
    return "-";
  }

  const seconds = Math.round((finished - started) / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

function getFreshness(run?: SyncRun | null) {
  if (!run?.finished_at) {
    return "Unknown";
  }

  const finished = new Date(run.finished_at).getTime();

  if (Number.isNaN(finished)) {
    return "Unknown";
  }

  return Date.now() - finished <= freshnessMs ? "Fresh" : "Stale";
}

function getFreshnessVariant(status: string) {
  if (status === "Fresh") return "success";
  if (status === "Stale") return "warning";
  return "neutral";
}

function getSyncStatusVariant(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "success") return "success";
  if (normalized === "error" || normalized === "failed") return "error";
  if (normalized === "running") return "info";
  if (normalized === "partial") return "warning";

  return "neutral";
}

function isErrorStatus(status?: string | null) {
  const normalized = (status ?? "").toLowerCase();
  return normalized === "error" || normalized === "failed";
}

function formatSyncRunDetails(run: SyncRun) {
  const details = run.details;

  if (!details) {
    return "-";
  }

  switch (run.sync_type) {
    case "locations":
      return details.syncedCount === undefined
        ? "-"
        : `${details.syncedCount} locations`;
    case "products":
      return (
        [
          details.productsSynced === undefined
            ? null
            : `${details.productsSynced} products`,
          details.variantsSynced === undefined
            ? null
            : `${details.variantsSynced} variants`,
          details.orderLinesCogsRecomputed === undefined
            ? null
            : `${details.orderLinesCogsRecomputed} COGS recalculated`,
        ]
          .filter(Boolean)
          .join(", ") || "-"
      );
    case "inventory":
      return (
        [
          details.inventoryItemsProcessed === undefined
            ? null
            : `${details.inventoryItemsProcessed} items`,
          details.inventoryLevelsSynced === undefined
            ? null
            : `${details.inventoryLevelsSynced} levels`,
          details.orderLinesCogsRecomputed === undefined
            ? null
            : `${details.orderLinesCogsRecomputed} COGS recalculated`,
        ]
          .filter(Boolean)
          .join(", ") || "-"
      );
    case "staff_members":
      return details.syncedCount === undefined
        ? "-"
        : `${details.syncedCount} staff members`;
    case "orders":
      return (
        [
          details.ordersSynced === undefined
            ? null
            : `${details.ordersSynced} orders`,
          details.orderLinesSynced === undefined
            ? null
            : `${details.orderLinesSynced} lines`,
          details.pagesProcessed === undefined
            ? null
            : `${details.pagesProcessed} pages`,
          details.startDate && details.endDate
            ? `${details.startDate} to ${details.endDate}`
            : null,
        ]
          .filter(Boolean)
          .join(", ") || "-"
      );
    default:
      return "-";
  }
}

function formatDetailSummary(run?: SyncRun | null) {
  if (!run?.details) return "No count details recorded yet.";

  const details = run.details;

  switch (run.sync_type) {
    case "locations":
      return details.syncedCount === undefined
        ? "No count details recorded yet."
        : `${details.syncedCount} locations`;
    case "products":
      return (
        [
          details.productsSynced === undefined
            ? null
            : `${details.productsSynced} products`,
          details.variantsSynced === undefined
            ? null
            : `${details.variantsSynced} variants`,
          details.orderLinesCogsRecomputed === undefined
            ? null
            : `${details.orderLinesCogsRecomputed} COGS recalculated`,
        ]
          .filter(Boolean)
          .join(" · ") || "No count details recorded yet."
      );
    case "inventory":
      return (
        [
          details.inventoryItemsProcessed === undefined
            ? null
            : `${details.inventoryItemsProcessed} inventory items`,
          details.inventoryLevelsSynced === undefined
            ? null
            : `${details.inventoryLevelsSynced} levels`,
          details.orderLinesCogsRecomputed === undefined
            ? null
            : `${details.orderLinesCogsRecomputed} COGS recalculated`,
        ]
          .filter(Boolean)
          .join(" · ") || "No count details recorded yet."
      );
    case "staff_members":
      return details.syncedCount === undefined
        ? "No count details recorded yet."
        : `${details.syncedCount} staff members`;
    case "orders":
      return (
        [
          details.ordersSynced === undefined
            ? null
            : `${details.ordersSynced} orders`,
          details.orderLinesSynced === undefined
            ? null
            : `${details.orderLinesSynced} lines`,
          details.pagesProcessed === undefined
            ? null
            : `${details.pagesProcessed} pages`,
        ]
          .filter(Boolean)
          .join(" · ") || "No count details recorded yet."
      );
    default:
      return "No count details recorded yet.";
  }
}

function getActionDetailSummary(actionData?: ActionData) {
  const details = actionData?.details;

  if (!details || typeof details !== "object") {
    return null;
  }

  if ("failedStep" in details && typeof details.failedStep === "string") {
    return `Failed step: ${details.failedStep}`;
  }

  const syncResult = details as Record<string, unknown>;

  return [
    typeof syncResult.syncedCount === "number"
      ? `${syncResult.syncedCount} records synced`
      : null,
    typeof syncResult.productsSynced === "number"
      ? `${syncResult.productsSynced} products`
      : null,
    typeof syncResult.variantsSynced === "number"
      ? `${syncResult.variantsSynced} variants`
      : null,
    typeof syncResult.inventoryItemsProcessed === "number"
      ? `${syncResult.inventoryItemsProcessed} inventory items`
      : null,
    typeof syncResult.inventoryLevelsSynced === "number"
      ? `${syncResult.inventoryLevelsSynced} inventory levels`
      : null,
    typeof syncResult.ordersSynced === "number"
      ? `${syncResult.ordersSynced} orders`
      : null,
    typeof syncResult.orderLinesSynced === "number"
      ? `${syncResult.orderLinesSynced} lines`
      : null,
    typeof syncResult.orderLinesCogsRecomputed === "number"
      ? `${syncResult.orderLinesCogsRecomputed} COGS recalculated`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function getSyncTypeSummary(runs: SyncRun[], syncType: string) {
  const typeRuns = runs.filter((run) => run.sync_type === syncType);
  const latestRun = typeRuns[0] ?? null;
  const lastSuccess =
    typeRuns.find((run) => run.status === "success" && run.finished_at) ?? null;
  const lastError = typeRuns.find((run) => isErrorStatus(run.status)) ?? null;

  return {
    latestRun,
    lastSuccess,
    lastError,
    freshness: getFreshness(lastSuccess),
  };
}

function getRunningLabel(intent?: string | null) {
  switch (intent) {
    case "sync_locations":
      return "Syncing locations...";
    case "sync_products":
      return "Syncing products...";
    case "sync_inventory":
      return "Syncing inventory...";
    case "sync_orders":
      return "Syncing orders...";
    default:
      return "Syncing...";
  }
}

function getJobTypeForIntent(intent: string): SyncJobType | null {
  switch (intent) {
    case "sync_locations":
      return "locations";
    case "sync_products":
      return "products";
    case "sync_inventory":
      return "inventory";
    case "sync_orders":
      return "orders";
    default:
      return null;
  }
}

function getJobActionResponse({
  intent,
  job,
}: {
  intent: string;
  job: SyncJobRow;
}): ActionData {
  const status = job.status;
  const label = job.job_type;

  return {
    ok: status !== "error" && status !== "cancelled",
    intent,
    message:
      status === "success"
        ? `${label} sync completed.`
        : status === "error"
          ? `${label} sync failed at ${job.current_step}: ${job.error_message}`
          : status === "cancelled"
            ? `${label} sync was cancelled.`
            : `${label} sync batch completed. Continue to process the next batch.`,
    failedStep: status === "error" ? job.current_step : null,
    details: job.counts,
    job,
  };
}

function isActiveJob(job?: SyncJobRow | null): job is SyncJobRow {
  return job?.status === "pending" || job?.status === "running";
}

function getJobStatusPriority(status?: string | null) {
  switch (status) {
    case "running":
      return 0;
    case "pending":
      return 1;
    case "error":
      return 2;
    case "success":
      return 3;
    case "cancelled":
      return 4;
    default:
      return 5;
  }
}

function selectCurrentSyncJob(jobs: Array<SyncJobRow | null | undefined>) {
  return (
    [...jobs]
      .filter((job): job is SyncJobRow => Boolean(job))
      .sort((a, b) => {
        const priorityDiff =
          getJobStatusPriority(a.status) - getJobStatusPriority(b.status);

        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        return (
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      })[0] ?? null
  );
}

function getJobProgressSummary(job?: SyncJobRow | null) {
  if (!job?.counts) {
    return "No batch counts recorded yet.";
  }

  return Object.entries(job.counts)
    .map(([step, counts]) => {
      if (!counts || typeof counts !== "object") {
        return null;
      }

      const stepCounts = counts as Record<string, unknown>;
      const values = [
        typeof stepCounts.syncedCount === "number"
          ? `${stepCounts.syncedCount} records`
          : null,
        typeof stepCounts.productsSynced === "number"
          ? `${stepCounts.productsSynced} products`
          : null,
        typeof stepCounts.variantsSynced === "number"
          ? `${stepCounts.variantsSynced} variants`
          : null,
        typeof stepCounts.inventoryItemsProcessed === "number"
          ? `${stepCounts.inventoryItemsProcessed} inventory items`
          : null,
        typeof stepCounts.inventoryLevelsSynced === "number"
          ? `${stepCounts.inventoryLevelsSynced} levels`
          : null,
        typeof stepCounts.ordersSynced === "number"
          ? `${stepCounts.ordersSynced} orders`
          : null,
        typeof stepCounts.orderLinesSynced === "number"
          ? `${stepCounts.orderLinesSynced} lines`
          : null,
        typeof stepCounts.orderLinesCogsRecomputed === "number"
          ? `${stepCounts.orderLinesCogsRecomputed} COGS recalculated`
          : null,
      ]
        .filter(Boolean)
        .join(", ");

      return values ? `${step}: ${values}` : null;
    })
    .filter(Boolean)
    .join(" · ") || "No batch counts recorded yet.";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  const counts = await Promise.all([
    getTableCount({ table: "locations", shop: session.shop, supabase }),
    getTableCount({ table: "products", shop: session.shop, supabase }),
    getTableCount({ table: "variants", shop: session.shop, supabase }),
    getTableCount({ table: "inventory_levels", shop: session.shop, supabase }),
    getTableCount({ table: "orders", shop: session.shop, supabase }),
    getTableCount({ table: "order_lines", shop: session.shop, supabase }),
    getTableCount({ table: "fixed_expenses", shop: session.shop, supabase }),
    getTableCount({
      table: "user_location_access",
      shop: session.shop,
      supabase,
    }),
    getTableCount({ table: "staff_members", shop: session.shop, supabase }),
  ]);

  const { data: syncRuns } = await supabase
    .from("sync_runs")
    .select(
      "id, sync_type, status, source, started_at, finished_at, error_message, details",
    )
    .eq("shop_domain", session.shop)
    .order("started_at", { ascending: false })
    .limit(50);

  const { data: recentJobs } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("shop_domain", session.shop)
    .order("updated_at", { ascending: false })
    .limit(20);
  const typedRecentJobs = (recentJobs ?? []) as SyncJobRow[];

  return {
    shop: session.shop,
    counts,
    lastSyncRuns: (syncRuns ?? []) as SyncRun[],
    activeJob: selectCurrentSyncJob(typedRecentJobs),
    recentJobs: typedRecentJobs,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "continue_job") {
      const jobId = String(formData.get("jobId") ?? "");

      if (!jobId) {
        return {
          ok: false,
          intent,
          message: "Missing sync job id.",
        } satisfies ActionData;
      }

      const result = await processManualSyncJobBatch({
        admin,
        supabase,
        shop: session.shop,
        jobId,
      });

      return getJobActionResponse({
        intent,
        job: result.job,
      });
    }

    const jobType = getJobTypeForIntent(intent);

    if (jobType) {
      const { job } = await createManualSyncJob({
        supabase,
        shop: session.shop,
        jobType,
      });
      const result = await processManualSyncJobBatch({
        admin,
        supabase,
        shop: session.shop,
        jobId: job.id,
      });

      return getJobActionResponse({
        intent,
        job: result.job,
      });
    }

    return {
      ok: false,
      intent,
      message: "Unknown sync action.",
    } satisfies ActionData;
  } catch (error) {
    return {
      ok: false,
      intent,
      message: `${intent || "Sync"} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      details: error instanceof Error ? error.message : String(error),
    } satisfies ActionData;
  }
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 16,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function SyncTypeStatusCard({
  config,
  runs,
  activeIntent,
  activeJob,
  isAnyJobActive,
}: {
  config: SyncTypeConfig;
  runs: SyncRun[];
  activeIntent?: string | null;
  activeJob?: SyncJobRow | null;
  isAnyJobActive: boolean;
}) {
  const summary = getSyncTypeSummary(runs, config.syncType);
  const latestRun = summary.latestRun;
  const duration = formatDuration(
    latestRun?.started_at,
    latestRun?.finished_at,
  );
  const isRunning =
    activeIntent === config.intent ||
    (isActiveJob(activeJob) &&
      (activeJob?.job_type === config.syncType ||
        activeJob?.job_type === "full"));
  const canContinue =
    isActiveJob(activeJob) && activeJob.job_type === config.syncType;
  const isDisabled = Boolean(activeIntent) || (isAnyJobActive && !canContinue);
  const statusLabel = isRunning
    ? "running"
    : latestRun
      ? latestRun.status
      : "never synced";

  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 14,
        padding: 16,
        display: "grid",
        gap: 12,
      }}
    >
      <div
        style={{
          alignItems: "start",
          display: "flex",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>{config.label}</h3>
          <StatusBadge variant={getFreshnessVariant(summary.freshness)}>
            {summary.freshness}
          </StatusBadge>
        </div>
        <StatusBadge variant={getSyncStatusVariant(statusLabel)}>
          {statusLabel}
        </StatusBadge>
      </div>

      <div style={{ display: "grid", gap: 6, color: "#616161", fontSize: 13 }}>
        {summary.lastSuccess?.finished_at ? (
          <div>
            <strong>Last success:</strong>{" "}
            {formatDateTime(summary.lastSuccess.finished_at)}
          </div>
        ) : (
          <div>
            <strong>Last success:</strong> Never
          </div>
        )}
        {summary.lastError ? (
          <div>
            <strong>Last failed:</strong>{" "}
            {formatDateTime(
              summary.lastError.finished_at ?? summary.lastError.started_at,
            )}
          </div>
        ) : null}
        {latestRun?.source ? (
          <div>
            <strong>Source:</strong> {latestRun.source}
          </div>
        ) : null}
        {duration !== "-" ? (
          <div>
            <strong>Duration:</strong> {duration}
          </div>
        ) : null}
      </div>

      {summary.lastError?.error_message ? (
        <div
          style={{
            background: "#fff4f4",
            border: "1px solid #f2b8b5",
            borderRadius: 10,
            color: "#b42318",
            fontSize: 13,
            padding: 10,
          }}
        >
          {summary.lastError.error_message}
        </div>
      ) : null}

      <div
        style={{
          background: "#f6f6f7",
          border: "1px solid #e3e3e3",
          borderRadius: 10,
          color: "#202223",
          fontSize: 13,
          fontWeight: 700,
          padding: 10,
        }}
      >
        {formatDetailSummary(latestRun)}
      </div>

      <Form method="post">
        <input type="hidden" name="intent" value={config.intent} />
        <AppButton
          type="submit"
          disabled={isDisabled}
          variant="secondary"
          compact
          fullWidth
        >
          {canContinue
            ? `Continue ${config.label} Sync`
            : isRunning
              ? getRunningLabel(config.intent)
              : config.actionLabel}
        </AppButton>
      </Form>
    </section>
  );
}

export default function AdminSyncPage() {
  const { shop, counts, lastSyncRuns, activeJob, recentJobs } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const liveJob = selectCurrentSyncJob([
    activeJob,
    actionData?.job,
  ]);
  const activeIntent =
    navigation.state !== "idle"
      ? String(navigation.formData?.get("intent") ?? "")
      : null;
  const isAnyJobActive = isActiveJob(liveJob);
  const lastSuccessfulSync = lastSyncRuns.find(
    (run) => run.status === "success" && run.finished_at,
  );
  const actionDetailSummary = getActionDetailSummary(actionData);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f6f7",
        padding: 28,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 32 }}>Data Sync</h1>
          <p style={{ color: "#616161", margin: "8px 0 0" }}>
            Refresh Shopify data and monitor data freshness.
          </p>
          <div style={{ color: "#8a8f93", fontSize: 12, marginTop: 8 }}>
            Shop: {shop}
          </div>
        </header>

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 12,
            padding: 14,
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontWeight: 800 }}>Last successful sync</div>
            <HelperText>
              {lastSuccessfulSync?.finished_at
                ? formatDateTime(lastSuccessfulSync.finished_at)
                : "No successful sync run recorded yet."}
            </HelperText>
          </div>
          <StatusBadge
            variant={
              getFreshness(lastSuccessfulSync) === "Fresh"
                ? "success"
                : getFreshness(lastSuccessfulSync) === "Stale"
                  ? "warning"
                  : "neutral"
            }
          >
            {getFreshness(lastSuccessfulSync)}
          </StatusBadge>
        </section>

        <section style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>Sync status</h2>
            <HelperText>
              Fresh means the last successful sync finished within 24 hours.
            </HelperText>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
            }}
          >
            {syncTypeConfigs.map((config) => (
              <SyncTypeStatusCard
                key={config.syncType}
                config={config}
                runs={lastSyncRuns}
                activeIntent={activeIntent}
                activeJob={liveJob}
                isAnyJobActive={isAnyJobActive}
              />
            ))}
          </div>
        </section>

        {liveJob ? (
          <section
            style={{
              background: "white",
              border: "1px solid #e3e3e3",
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 800 }}>
                  Current sync job: {liveJob.job_type}
                </div>
                <HelperText>
                  Step: {liveJob.current_step ?? "-"} · Updated:{" "}
                  {formatDateTime(liveJob.updated_at)}
                </HelperText>
              </div>
              <StatusBadge variant={getSyncStatusVariant(liveJob.status)}>
                {liveJob.status}
              </StatusBadge>
            </div>
            <div
              style={{
                background: "#f6f6f7",
                border: "1px solid #e3e3e3",
                borderRadius: 10,
                fontSize: 13,
                padding: 10,
              }}
            >
              {getJobProgressSummary(liveJob)}
            </div>
            {liveJob.error_message ? (
              <InlineResult variant="error">{liveJob.error_message}</InlineResult>
            ) : null}
            {isActiveJob(liveJob) ? (
              <Form method="post">
                <input type="hidden" name="intent" value="continue_job" />
                <input type="hidden" name="jobId" value={liveJob.id} />
                <AppButton
                  type="submit"
                  disabled={Boolean(activeIntent)}
                  variant="secondary"
                  compact
                >
                  Continue Current Job
                </AppButton>
              </Form>
            ) : null}
          </section>
        ) : null}

        {actionData ? (
          <div style={{ marginBottom: 24 }}>
            <InlineResult variant={actionData.ok ? "success" : "error"}>
              {actionData.message}
            </InlineResult>
            {actionDetailSummary ? (
              <HelperText>{actionDetailSummary}</HelperText>
            ) : null}
          </div>
        ) : null}

        <Card title="Database records">
          <HelperText>
            Current stored records for support and troubleshooting.
          </HelperText>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 12,
            }}
          >
            {counts.map((row) => (
              <div
                key={row.table}
                title={row.error}
                style={{
                  background: row.error ? "#fff4f4" : "#f6f6f7",
                  border: `1px solid ${row.error ? "#f2b8b5" : "#e3e3e3"}`,
                  borderRadius: 999,
                  color: row.error ? "#b42318" : "#202223",
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "6px 10px",
                }}
              >
                {row.table}: {row.error ? "Error" : row.count}
              </div>
            ))}
          </div>
        </Card>

        <div style={{ height: 24 }} />

        <Card title="Recent sync jobs">
          <HelperText>
            Live manual job status. Each job is processed in small server
            batches from this page.
          </HelperText>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  {["Type", "Status", "Step", "Updated", "Progress", "Error"].map(
                    (header) => (
                      <th
                        key={header}
                        style={{
                          textAlign: "left",
                          padding: "10px",
                          borderBottom: "1px solid #ddd",
                        }}
                      >
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr key={job.id}>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {job.job_type}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      <StatusBadge variant={getSyncStatusVariant(job.status)}>
                        {job.status}
                      </StatusBadge>
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {job.current_step ?? "-"}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {formatDateTime(job.updated_at)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {getJobProgressSummary(job)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {job.error_message ?? "-"}
                    </td>
                  </tr>
                ))}

                {recentJobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      style={{
                        padding: "14px 10px",
                        color: "#616161",
                      }}
                    >
                      No sync jobs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ height: 24 }} />

        <Card title="Recent sync history">
          <HelperText>
            Recent sync history for troubleshooting. Showing the 20 most recent
            runs.
          </HelperText>
          <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  {[
                    "Type",
                    "Status",
                    "Source",
                    "Started",
                    "Finished",
                    "Details",
                    "Error",
                  ].map((header) => (
                    <th
                      key={header}
                      style={{
                        textAlign: "left",
                        padding: "10px",
                        borderBottom: "1px solid #ddd",
                      }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lastSyncRuns.slice(0, 20).map((run) => (
                  <tr key={run.id}>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {run.sync_type}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      <StatusBadge variant={getSyncStatusVariant(run.status)}>
                        {run.status}
                      </StatusBadge>
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {run.source ?? "-"}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {formatDateTime(run.started_at)}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {formatDateTime(run.finished_at)}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {formatSyncRunDetails(run)}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {run.error_message ?? "-"}
                    </td>
                  </tr>
                ))}

                {lastSyncRuns.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      style={{
                        padding: "14px 10px",
                        color: "#616161",
                      }}
                    >
                      No sync runs yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </main>
  );
}
