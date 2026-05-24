import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
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
};

type ActionData = {
  ok: boolean;
  message: string;
  details?: unknown;
};

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

function getSyncStatusVariant(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "success") return "success";
  if (normalized === "error" || normalized === "failed") return "error";
  if (normalized === "running") return "info";
  if (normalized === "partial") return "warning";

  return "neutral";
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
    .limit(10);

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

function ButtonLink({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      style={{
        display: "inline-block",
        border: "1px solid #202223",
        background: "#202223",
        color: "white",
        borderRadius: 10,
        padding: "10px 14px",
        fontWeight: 700,
        textDecoration: "none",
        textAlign: "center",
      }}
    >
      {children}
    </Link>
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
          }}
        >
          <div style={{ fontWeight: 800 }}>Last successful sync</div>
          <HelperText>
            {lastSuccessfulSync?.finished_at
              ? formatDateTime(lastSuccessfulSync.finished_at)
              : "No successful sync run recorded yet."}
          </HelperText>
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          {counts.map((row) => (
            <Card key={row.table} title={row.table}>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{row.count}</div>
              {row.error ? (
                <div style={{ color: "#b42318", marginTop: 8 }}>
                  {row.error}
                </div>
              ) : null}
            </Card>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
            gap: 20,
            marginBottom: 24,
          }}
        >
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

              <div
                style={{
                  height: 1,
                  background: "#e3e3e3",
                  margin: "4px 0",
                }}
              />

              <ButtonLink to={`/app/admin/sync-locations${search}`}>
                Refresh locations
              </ButtonLink>

              <ButtonLink to={`/app/admin/sync-products${search}`}>
                Refresh products & variants
              </ButtonLink>

              <ButtonLink to={`/app/admin/sync-inventory${search}`}>
                Refresh inventory
              </ButtonLink>

              <ButtonLink to={`/app/admin/sync-orders${search}`}>
                Refresh orders by date range
              </ButtonLink>

              <Form method="post">
                <input type="hidden" name="intent" value="sync_staff_members" />
                <AppButton
                  type="submit"
                  disabled={isSyncingStaff}
                  variant="secondary"
                  fullWidth
                >
                  {isSyncingStaff ? "Syncing staff..." : "Sync staff members"}
                </AppButton>
              </Form>
            </div>
          </Card>

          <Card title="Recommended sync order">
            <ol style={{ marginTop: 0, lineHeight: 1.8 }}>
              <li>Refresh locations</li>
              <li>Refresh products & variants</li>
              <li>Refresh inventory</li>
              <li>Sync staff members</li>
              <li>Refresh orders</li>
            </ol>

            <div
              style={{
                background: "#fff8e5",
                border: "1px solid #f1c96b",
                borderRadius: 12,
                padding: 14,
                color: "#5f4200",
                marginTop: 16,
              }}
            >
              The full refresh uses the same flow as the scheduled daily cron.
              Use it when the admin needs to force an immediate update.
            </div>
          </Card>
        </div>

        <Card title="Last sync runs">
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
                {lastSyncRuns.map((run) => (
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
