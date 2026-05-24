import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import {
  runFullSync,
  syncStaffMembers,
} from "../lib/sync/shopify-sync.server";
import { AppButton, AppButtonLink } from "../components/ui/AppButton";
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
};

type ActionData = {
  ok: boolean;
  message: string;
  details?: unknown;
};

type SyncTypeConfig = {
  syncType: string;
  label: string;
  actionLabel: string;
  href?: string;
  formIntent?: string;
};

const freshnessMs = 24 * 60 * 60 * 1000;
const syncTypeConfigs: SyncTypeConfig[] = [
  {
    syncType: "locations",
    label: "Locations",
    actionLabel: "Refresh locations",
    href: "/app/admin/sync-locations",
  },
  {
    syncType: "products",
    label: "Products",
    actionLabel: "Refresh products",
    href: "/app/admin/sync-products",
  },
  {
    syncType: "inventory",
    label: "Inventory",
    actionLabel: "Refresh inventory",
    href: "/app/admin/sync-inventory",
  },
  {
    syncType: "orders",
    label: "Orders",
    actionLabel: "Refresh orders",
    href: "/app/admin/sync-orders",
  },
  {
    syncType: "staff_members",
    label: "Staff",
    actionLabel: "Sync staff members",
    formIntent: "sync_staff_members",
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
      return [
        details.productsSynced === undefined
          ? null
          : `${details.productsSynced} products`,
        details.variantsSynced === undefined
          ? null
          : `${details.variantsSynced} variants`,
      ]
        .filter(Boolean)
        .join(", ") || "-";
    case "inventory":
      return [
        details.inventoryItemsProcessed === undefined
          ? null
          : `${details.inventoryItemsProcessed} items`,
        details.inventoryLevelsSynced === undefined
          ? null
          : `${details.inventoryLevelsSynced} levels`,
      ]
        .filter(Boolean)
        .join(", ") || "-";
    case "staff_members":
      return details.syncedCount === undefined
        ? "-"
        : `${details.syncedCount} staff members`;
    case "orders":
      return [
        details.ordersSynced === undefined ? null : `${details.ordersSynced} orders`,
        details.orderLinesSynced === undefined
          ? null
          : `${details.orderLinesSynced} lines`,
        details.pagesProcessed === undefined ? null : `${details.pagesProcessed} pages`,
        details.startDate && details.endDate
          ? `${details.startDate} to ${details.endDate}`
          : null,
      ]
        .filter(Boolean)
        .join(", ") || "-";
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
      return [
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
        .join(" · ") || "No count details recorded yet.";
    case "inventory":
      return [
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
        .join(" · ") || "No count details recorded yet.";
    case "staff_members":
      return details.syncedCount === undefined
        ? "No count details recorded yet."
        : `${details.syncedCount} staff members`;
    case "orders":
      return [
        details.ordersSynced === undefined ? null : `${details.ordersSynced} orders`,
        details.orderLinesSynced === undefined
          ? null
          : `${details.orderLinesSynced} lines`,
        details.pagesProcessed === undefined ? null : `${details.pagesProcessed} pages`,
      ]
        .filter(Boolean)
        .join(" · ") || "No count details recorded yet.";
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
    getTableCount({ table: "user_location_access", shop: session.shop, supabase }),
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

  return {
    shop: session.shop,
    counts,
    lastSyncRuns: (syncRuns ?? []) as SyncRun[],
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "sync_staff_members") {
    const result = await syncStaffMembers({
      admin,
      shop: session.shop,
      supabase,
      source: "manual_admin_sync",
    });

    return {
      ok: result.ok,
      message: result.ok
        ? `Synced ${result.syncedCount} staff members.`
        : `Staff sync failed: ${"error" in result ? result.error : "Unknown error"}`,
      details: result,
    } satisfies ActionData;
  }

  if (intent !== "refresh_all") {
    return {
      ok: false,
      message: "Unknown action.",
    } satisfies ActionData;
  }

  try {
    const result = await runFullSync({
      admin,
      shop: session.shop,
      source: "manual_admin_sync",
    });

    if (!result.ok) {
      return {
        ok: false,
        message: "Full sync failed.",
        details: result,
      } satisfies ActionData;
    }

    return {
      ok: true,
      message: "Full data refresh completed successfully.",
      details: result,
    } satisfies ActionData;
  } catch (error) {
    return {
      ok: false,
      message: "Full sync failed.",
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
  search,
  isSyncingStaff,
}: {
  config: SyncTypeConfig;
  runs: SyncRun[];
  search: string;
  isSyncingStaff: boolean;
}) {
  const summary = getSyncTypeSummary(runs, config.syncType);
  const latestRun = summary.latestRun;
  const duration = formatDuration(latestRun?.started_at, latestRun?.finished_at);

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
        {latestRun ? (
          <StatusBadge variant={getSyncStatusVariant(latestRun.status)}>
            {latestRun.status}
          </StatusBadge>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 6, color: "#616161", fontSize: 13 }}>
        {summary.lastSuccess?.finished_at ? (
          <div>
            <strong>Last success:</strong>{" "}
            {formatDateTime(summary.lastSuccess.finished_at)}
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

      {config.href ? (
        <AppButtonLink
          to={`${config.href}${search}`}
          variant="secondary"
          compact
          fullWidth
        >
          {config.actionLabel}
        </AppButtonLink>
      ) : (
        <Form method="post">
          <input type="hidden" name="intent" value={config.formIntent} />
          <AppButton
            type="submit"
            disabled={isSyncingStaff}
            variant="secondary"
            compact
            fullWidth
          >
            {isSyncingStaff ? "Syncing staff..." : config.actionLabel}
          </AppButton>
        </Form>
      )}
    </section>
  );
}

export default function AdminSyncPage() {
  const { shop, counts, lastSyncRuns } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const navigation = useNavigation();
  const search = location.search;

  const isRefreshing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "refresh_all";
  const isSyncingStaff =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "sync_staff_members";
  const lastSuccessfulSync = lastSyncRuns.find(
    (run) => run.status === "success" && run.finished_at,
  );

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
                search={search}
                isSyncingStaff={isSyncingStaff}
              />
            ))}
          </div>
        </section>

        <div style={{ marginBottom: 24 }}>
          <Card title="Refresh data">
            <div style={{ display: "grid", gap: 12 }}>
              <Form method="post">
                <input type="hidden" name="intent" value="refresh_all" />
                <AppButton
                  type="submit"
                  disabled={isRefreshing}
                  fullWidth
                >
                  {isRefreshing ? "Refreshing all data..." : "Refresh all data"}
                </AppButton>
              </Form>

              {actionData ? (
                <InlineResult variant={actionData.ok ? "success" : "error"}>
                  {actionData.message}
                </InlineResult>
              ) : null}

              <HelperText>
                Recommended order: Locations → Products → Inventory → Staff → Orders.
              </HelperText>
            </div>
          </Card>
        </div>

        <Card title="Database records">
          <HelperText>Current stored records for support and troubleshooting.</HelperText>
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

        <Card title="Last sync runs">
          <HelperText>Recent sync history for troubleshooting. Showing the 10 most recent runs.</HelperText>
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
                {lastSyncRuns.slice(0, 10).map((run) => (
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
