import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import {
  createManualSyncJob,
  type SyncJobRow,
  type SyncJobType,
} from "../lib/sync/sync-jobs.server";
import { hasConfiguredScope } from "../lib/shopify/scopes.server";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";
import { PageNotice } from "../components/ui/PageNotice";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
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
  hasReadUsersScope: boolean;
};

type ActionData = {
  ok: boolean;
  message: string;
};

type SyncTypeConfig = {
  syncType: string;
  label: string;
  note?: string;
};

const freshnessMs = 24 * 60 * 60 * 1000;
const syncTypeConfigs: SyncTypeConfig[] = [
  {
    syncType: "locations",
    label: "Locations",
  },
  {
    syncType: "products",
    label: "Products",
  },
  {
    syncType: "inventory",
    label: "Inventory",
  },
  {
    syncType: "orders",
    label: "Orders",
  },
];
const manualSyncActions: Array<{ jobType: SyncJobType; label: string }> = [
  { jobType: "locations", label: "Sync locations" },
  { jobType: "products", label: "Sync products" },
  { jobType: "inventory", label: "Sync inventory" },
  { jobType: "orders", label: "Sync orders" },
  { jobType: "full", label: "Full refresh job" },
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

function formatMilliseconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }

  const seconds = value / 1000;

  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  return remainingSeconds > 0
    ? `${minutes}m ${remainingSeconds}s`
    : `${minutes}m`;
}

function getDurationDetails(run?: SyncRun | null) {
  const duration = run?.details?.duration;

  return duration && typeof duration === "object"
    ? (duration as Record<string, unknown>)
    : {};
}

function getTotalDuration(run: SyncRun) {
  const duration = getDurationDetails(run);
  const fromDetails = formatMilliseconds(duration.totalMs);

  return fromDetails === "-"
    ? formatDuration(run.started_at, run.finished_at)
    : fromDetails;
}

function getCogsDuration(run: SyncRun) {
  return formatMilliseconds(getDurationDetails(run).cogsRecomputeMs);
}

function getBulkOperationId(run: SyncRun) {
  const value = run.details?.bulkOperationId;

  return typeof value === "string" && value ? value : "-";
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
  await ensureShopInitialized({
    route: "app.admin.sync",
    shop: session.shop,
    supabase,
  });

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
  if (
    counts.every((row) => row.count === 0) &&
    (syncRuns ?? []).length === 0 &&
    typedRecentJobs.length === 0
  ) {
    logEmptyDataState({
      route: "app.admin.sync",
      shop: session.shop,
      reason: "fresh_business_database",
      counts: Object.fromEntries(counts.map((row) => [row.table, row.count])),
    });
  }

  return {
    shop: session.shop,
    counts,
    lastSyncRuns: (syncRuns ?? []) as SyncRun[],
    activeJob: selectCurrentSyncJob(typedRecentJobs),
    recentJobs: typedRecentJobs,
    hasReadUsersScope: hasConfiguredScope("read_users"),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.sync.action",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const jobType = String(formData.get("jobType") ?? "") as SyncJobType;
  const allowedJobTypes = new Set(manualSyncActions.map((action) => action.jobType));

  if (!allowedJobTypes.has(jobType)) {
    return {
      ok: false,
      message: "Unknown sync action.",
    } satisfies ActionData;
  }

  const result = await createManualSyncJob({
    supabase,
    shop: session.shop,
    jobType,
  });

  console.info("[fresh-install:sync-action]", {
    route: "app.admin.sync.action",
    shop: session.shop,
    jobType,
    reused: result.reused,
  });

  return {
    ok: true,
    message: result.reused
      ? `Existing ${jobType} sync job is already queued or running.`
      : `Queued ${jobType} sync job.`,
  } satisfies ActionData;
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
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
  activeJob,
}: {
  config: SyncTypeConfig;
  runs: SyncRun[];
  activeJob?: SyncJobRow | null;
}) {
  const summary = getSyncTypeSummary(runs, config.syncType);
  const latestRun = summary.latestRun;
  const duration = latestRun ? getTotalDuration(latestRun) : "-";
  const isRunning =
    isActiveJob(activeJob) &&
    (activeJob?.job_type === config.syncType || activeJob?.job_type === "full");
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
        {latestRun && getCogsDuration(latestRun) !== "-" ? (
          <div>
            <strong>COGS RPC:</strong> {getCogsDuration(latestRun)}
          </div>
        ) : null}
        {latestRun && getBulkOperationId(latestRun) !== "-" ? (
          <div>
            <strong>Bulk operation:</strong> {getBulkOperationId(latestRun)}
          </div>
        ) : null}
        {config.note ? (
          <div>
            <strong>Note:</strong> {config.note}
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
    </section>
  );
}

export default function AdminSyncPage() {
  const { shop, counts, lastSyncRuns, activeJob, recentJobs, hasReadUsersScope } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const liveJob = selectCurrentSyncJob([activeJob]);
  const isSubmitting = navigation.state !== "idle";
  const lastSuccessfulSync = lastSyncRuns.find(
    (run) => run.status === "success" && run.finished_at,
  );
  const businessRecordCount = counts
    .filter((row) =>
      ["locations", "products", "variants", "inventory_levels", "orders", "order_lines"].includes(
        row.table,
      ),
    )
    .reduce((sum, row) => sum + row.count, 0);
  const shouldShowFirstRunStatus =
    !lastSuccessfulSync ||
    businessRecordCount === 0 ||
    (lastSyncRuns.length === 0 && recentJobs.length === 0);
  const fullRefreshCommand = `npm run sync:local -- --shop ${shop} --steps locations,products,inventory,orders`;
  const visibleSyncTypeConfigs = hasReadUsersScope
    ? [
        ...syncTypeConfigs,
        {
          syncType: "staff_members",
          label: "Staff directory",
          note: "Optional staff directory sync is enabled for this environment.",
        },
      ]
    : [
        ...syncTypeConfigs,
        {
          syncType: "staff_members",
          label: "Staff directory",
          note: "Public App Store builds do not request read_users; staff sync is future/custom-only and permissions use manual email assignments.",
        },
      ];

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
          <h1 style={{ margin: 0, fontSize: 32 }}>Sync Center</h1>
          <p style={{ color: "#616161", margin: "8px 0 0" }}>
            Admin/support diagnostic view for sync jobs, freshness, and
            troubleshooting.
          </p>
          <div style={{ color: "#8a8f93", fontSize: 12, marginTop: 8 }}>
            Shop: {shop}
          </div>
        </header>

        {shouldShowFirstRunStatus ? (
          <PageNotice
            title="First run status"
            message="Data may still be preparing. Reports populate after Shopify locations, products, inventory, and orders sync into ShopOps Studio."
            bullets={[
              "This page is for monitoring sync health, freshness, and troubleshooting history.",
              "No reviewer-facing full sync trigger is available here.",
              "When sync completes, Dashboard, Locations, and Data Health will show richer reporting.",
            ]}
            tone="info"
          />
        ) : null}

        {actionData ? (
          <InlineResult variant={actionData.ok ? "success" : "error"}>
            {actionData.message}
          </InlineResult>
        ) : null}

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            display: "grid",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 800 }}>Manual sync actions</div>
            <HelperText>
              Queue sync jobs for marketplace setup and reviewer-safe onboarding.
              Staff directory sync is skipped when `read_users` is not configured.
            </HelperText>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {manualSyncActions.map((syncAction) => (
              <Form key={syncAction.jobType} method="post">
                <input type="hidden" name="jobType" value={syncAction.jobType} />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    background: "#202223",
                    border: "1px solid #202223",
                    borderRadius: 8,
                    color: "white",
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                    fontWeight: 700,
                    opacity: isSubmitting ? 0.65 : 1,
                    padding: "8px 12px",
                  }}
                >
                  {syncAction.label}
                </button>
              </Form>
            ))}
          </div>
        </section>

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
            display: "grid",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 800 }}>Official full refresh command</div>
            <HelperText>
              Use local refresh for full database reloads. Webhooks keep Shopify
              changes updated afterward. This page is for monitoring only.
            </HelperText>
          </div>
          <pre
            style={{
              background: "#202223",
              borderRadius: 10,
              color: "white",
              margin: 0,
              overflowX: "auto",
              padding: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {fullRefreshCommand}
          </pre>
        </section>

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
            {visibleSyncTypeConfigs.map((config) => (
              <SyncTypeStatusCard
                key={config.syncType}
                config={config}
                runs={lastSyncRuns}
                activeJob={liveJob}
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
          </section>
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
            Legacy/manual job status retained for troubleshooting history.
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
                    "Duration",
                    "COGS RPC",
                    "Bulk operation",
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
                      {getTotalDuration(run)}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {getCogsDuration(run)}
                    </td>
                    <td
                      style={{
                        padding: "10px",
                        borderBottom: "1px solid #eee",
                        maxWidth: 220,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {getBulkOperationId(run)}
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
                      colSpan={10}
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
