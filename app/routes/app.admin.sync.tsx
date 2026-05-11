import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";

type TableCount = {
  table: string;
  count: number;
  error?: string;
};

type SyncRun = {
  id: string;
  sync_type: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  error_message?: string | null;
};

type LoaderData = {
  shop: string;
  counts: TableCount[];
  lastSyncRuns: SyncRun[];
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  const counts = await Promise.all([
    getTableCount({ table: "locations", shop: session.shop, supabase }),
    getTableCount({ table: "products", shop: session.shop, supabase }),
    getTableCount({ table: "variants", shop: session.shop, supabase }),
    getTableCount({ table: "inventory_levels", shop: session.shop, supabase }),
    getTableCount({ table: "orders", shop: session.shop, supabase }),
    getTableCount({ table: "order_lines", shop: session.shop, supabase }),
    getTableCount({ table: "fixed_expenses", shop: session.shop, supabase }),
    getTableCount({ table: "user_location_access", shop: session.shop, supabase }),
  ]);

  const { data: syncRuns } = await supabase
    .from("sync_runs")
    .select("id, sync_type, status, started_at, finished_at, error_message")
    .eq("shop_domain", session.shop)
    .order("started_at", { ascending: false })
    .limit(10);

  return {
    shop: session.shop,
    counts,
    lastSyncRuns: (syncRuns ?? []) as SyncRun[],
  };
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
      }}
    >
      {children}
    </Link>
  );
}

export default function AdminSyncPage() {
  const { shop, counts, lastSyncRuns } = useLoaderData<LoaderData>();

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
          <div style={{ color: "#616161", fontSize: 14, marginBottom: 6 }}>
            Admin
          </div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Data sync center</h1>
          <p style={{ color: "#616161" }}>
            Shop: <strong>{shop}</strong>
          </p>
        </header>

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
              <ButtonLink to="/app/admin/sync-locations">
                Refresh locations
              </ButtonLink>

              <ButtonLink to="/app/admin/sync-products">
                Refresh products & variants
              </ButtonLink>

              <ButtonLink to="/app/admin/sync-inventory">
                Refresh inventory
              </ButtonLink>

              <ButtonLink to="/app/admin/sync-orders">
                Refresh orders by date range
              </ButtonLink>
            </div>
          </Card>

          <Card title="Recommended sync order">
            <ol style={{ marginTop: 0, lineHeight: 1.8 }}>
              <li>Refresh locations</li>
              <li>Refresh products & variants</li>
              <li>Refresh inventory</li>
              <li>Refresh orders month by month</li>
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
              For orders, use date ranges of one month or less to avoid Shopify
              query cost and timeout issues.
            </div>
          </Card>
        </div>

        <Card title="Last sync runs">
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 14,
              }}
            >
              <thead>
                <tr>
                  {["Type", "Status", "Started", "Finished", "Error"].map(
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
                {lastSyncRuns.map((run) => (
                  <tr key={run.id}>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {run.sync_type}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {run.status}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {formatDateTime(run.started_at)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {formatDateTime(run.finished_at)}
                    </td>
                    <td style={{ padding: "10px", borderBottom: "1px solid #eee" }}>
                      {run.error_message ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </main>
  );
}