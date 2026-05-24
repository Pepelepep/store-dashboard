import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { AppButtonLink } from "../components/ui/AppButton";
import { HelperText } from "../components/ui/HelperText";
import { StatusBadge } from "../components/ui/StatusBadge";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import {
  buildShopifyOrderUrl,
  formatCurrency,
  formatNumber,
  formatStoreDateTime,
} from "../lib/dashboard/dashboard-metrics";
import type { LocationRow, OrderLineDbRow } from "../lib/dashboard/dashboard-types";
import { authenticate } from "../shopify.server";

type ExpenseRow = {
  shopify_location_id: string | null;
  is_active: boolean;
};

type SampleRow = {
  orderName: string;
  orderUrl: string | null;
  date: string;
  location: string;
  product: string;
  sku: string;
  revenue: number;
};

type QualityCheck = {
  count: number;
  affectedRevenue: number;
  affectedRevenuePct?: number;
  samples: SampleRow[];
};

type ExpenseCoverageRow = {
  locationName: string;
  status: "Covered" | "Missing";
};

type SyncFreshnessRow = {
  label: string;
  status: "Fresh" | "Stale" | "Unknown";
  finishedAt: string | null;
};

type LoaderData = {
  preservedSearch: string;
  missingCosts: QualityCheck;
  missingStaff: QualityCheck;
  missingVendor: QualityCheck;
  expenseCoverage: ExpenseCoverageRow[];
  syncFreshness: SyncFreshnessRow[];
  errors: string[];
};

const sampleLimit = 10;
const freshnessMs = 24 * 60 * 60 * 1000;
const syncTypes = ["locations", "products", "inventory", "orders", "staff"];

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function isMissingText(value: string | null | undefined) {
  return !value || value.trim() === "";
}

function createSamples({
  rows,
  shop,
}: {
  rows: OrderLineDbRow[];
  shop: string;
}) {
  return rows.slice(0, sampleLimit).map((row) => ({
    orderName: row.order_name || "-",
    orderUrl: row.shopify_order_id
      ? buildShopifyOrderUrl(shop, row.shopify_order_id)
      : null,
    date: row.created_at_shopify,
    location: row.retail_location_name || "-",
    product: row.product_title || "Unknown product",
    sku: row.sku || "-",
    revenue: numberValue(row.revenue),
  }));
}

function createQualityCheck({
  rows,
  totalRevenue,
  shop,
  includeRevenuePct = false,
}: {
  rows: OrderLineDbRow[];
  totalRevenue: number;
  shop: string;
  includeRevenuePct?: boolean;
}): QualityCheck {
  const affectedRevenue = rows.reduce(
    (sum, row) => sum + numberValue(row.revenue),
    0,
  );

  return {
    count: rows.length,
    affectedRevenue,
    affectedRevenuePct:
      includeRevenuePct && totalRevenue > 0
        ? (affectedRevenue / totalRevenue) * 100
        : undefined,
    samples: createSamples({ rows, shop }),
  };
}

function getSyncType(run: Record<string, unknown>) {
  const candidateKeys = [
    "sync_type",
    "type",
    "resource",
    "job_type",
    "name",
    "operation",
  ];
  const rawText = candidateKeys
    .map((key) => String(run[key] ?? ""))
    .join(" ")
    .toLowerCase();
  const fullText = `${rawText} ${JSON.stringify(run).toLowerCase()}`;

  return syncTypes.find((type) => fullText.includes(type)) ?? null;
}

function getFinishedAt(run: Record<string, unknown>) {
  const value =
    run.finished_at || run.completed_at || run.updated_at || run.created_at || null;

  return typeof value === "string" ? value : null;
}

function getFreshnessStatus(finishedAt: string | null) {
  if (!finishedAt) return "Unknown";

  const timestamp = new Date(finishedAt).getTime();
  if (Number.isNaN(timestamp)) return "Unknown";

  return Date.now() - timestamp <= freshnessMs ? "Fresh" : "Stale";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  const permissions = await assertAdminAccess({ request, session, supabase });
  const url = new URL(request.url);
  const preservedSearch = url.search;
  const errors: string[] = [];

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name, is_active")
    .eq("shop_domain", session.shop)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (locationsError) errors.push(locationsError.message);

  const allLocations = (locationsData ?? []) as LocationRow[];
  const accessibleLocations = permissions.isAdmin
    ? allLocations
    : allLocations.filter((location) =>
        permissions.allowedLocationIds.has(location.shopify_location_id),
      );

  if (!permissions.isAdmin && accessibleLocations.length === 0) {
    throw new Response("Forbidden: no location access configured", {
      status: 403,
    });
  }

  const accessibleLocationIds = accessibleLocations.map(
    (location) => location.shopify_location_id,
  );

  const [orderLinesResult, expensesResult, syncRunsResult] = await Promise.all([
    accessibleLocationIds.length > 0
      ? supabase
          .from("order_lines")
          .select(
            "order_name, shopify_order_id, created_at_shopify, retail_location_id, retail_location_name, product_title, variant_title, sku, vendor, quantity, unit_price, revenue, unit_cost, cogs, gross_profit, cost_source, staff_member_id, staff_member_name, staff_member_email, staff_source",
          )
          .eq("shop_domain", session.shop)
          .in("retail_location_id", accessibleLocationIds)
          .order("created_at_shopify", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("fixed_expenses")
      .select("shopify_location_id, is_active")
      .eq("shop_domain", session.shop)
      .eq("is_active", true),
    supabase
      .from("sync_runs")
      .select("*")
      .eq("shop_domain", session.shop)
      .eq("status", "success")
      .order("finished_at", { ascending: false }),
  ]);

  if (orderLinesResult.error) errors.push(orderLinesResult.error.message);
  if (expensesResult.error) errors.push(expensesResult.error.message);
  if (syncRunsResult.error) errors.push(syncRunsResult.error.message);

  const orderLines = (orderLinesResult.data ?? []) as OrderLineDbRow[];
  const expenses = (expensesResult.data ?? []) as ExpenseRow[];
  const syncRuns = (syncRunsResult.data ?? []) as Array<Record<string, unknown>>;
  const totalRevenue = orderLines.reduce(
    (sum, row) => sum + numberValue(row.revenue),
    0,
  );
  const missingCostRows = orderLines.filter(
    (row) => row.cogs === null || numberValue(row.cogs) <= 0,
  );
  const missingStaffRows = orderLines.filter(
    (row) =>
      isMissingText(row.staff_member_id) &&
      isMissingText(row.staff_member_email) &&
      isMissingText(row.staff_member_name),
  );
  const missingVendorRows = orderLines.filter((row) => isMissingText(row.vendor));
  const coveredLocationIds = new Set(
    expenses
      .map((expense) => expense.shopify_location_id)
      .filter((value): value is string => Boolean(value)),
  );
  const latestSyncByType = new Map<string, string | null>();

  for (const run of syncRuns) {
    const type = getSyncType(run);
    if (!type || latestSyncByType.has(type)) continue;
    latestSyncByType.set(type, getFinishedAt(run));
  }

  return {
    preservedSearch,
    missingCosts: createQualityCheck({
      rows: missingCostRows,
      totalRevenue,
      shop: session.shop,
    }),
    missingStaff: createQualityCheck({
      rows: missingStaffRows,
      totalRevenue,
      shop: session.shop,
      includeRevenuePct: true,
    }),
    missingVendor: createQualityCheck({
      rows: missingVendorRows,
      totalRevenue,
      shop: session.shop,
    }),
    expenseCoverage: accessibleLocations.map((location) => ({
      locationName: location.name,
      status: coveredLocationIds.has(location.shopify_location_id)
        ? "Covered"
        : "Missing",
    })),
    syncFreshness: syncTypes.map((type) => {
      const finishedAt = latestSyncByType.get(type) ?? null;

      return {
        label: type[0].toUpperCase() + type.slice(1),
        status: getFreshnessStatus(finishedAt),
        finishedAt,
      };
    }),
    errors,
  } satisfies LoaderData;
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        background: "#f6f6f7",
        border: "1px solid #e3e3e3",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div style={{ color: "#616161", fontSize: 12, fontWeight: 800 }}>
        {label}
      </div>
      <div style={{ color: "#202223", fontSize: 20, fontWeight: 800 }}>
        {value}
      </div>
    </div>
  );
}

function statusVariant(status: string) {
  if (status === "Fresh" || status === "Covered") return "success";
  if (status === "Stale") return "warning";
  if (status === "Missing") return "warning";
  return "neutral";
}

function QualitySection({
  title,
  impact,
  check,
  showPercent,
}: {
  title: string;
  impact: string;
  check: QualityCheck;
  showPercent?: boolean;
}) {
  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>{title}</h2>
          <HelperText>{impact}</HelperText>
        </div>
        <StatusBadge variant={check.count > 0 ? "warning" : "success"}>
          {check.count > 0 ? "Needs review" : "Looks good"}
        </StatusBadge>
      </div>

      <div style={metricGridStyle}>
        <SummaryMetric label="Affected rows" value={formatNumber(check.count)} />
        <SummaryMetric
          label="Revenue affected"
          value={formatCurrency(check.affectedRevenue)}
        />
        {showPercent ? (
          <SummaryMetric
            label="Revenue affected"
            value={
              check.affectedRevenuePct === undefined
                ? "-"
                : `${check.affectedRevenuePct.toFixed(1)}%`
            }
          />
        ) : null}
      </div>

      <SampleTable rows={check.samples} />
    </section>
  );
}

function SampleTable({ rows }: { rows: SampleRow[] }) {
  if (rows.length === 0) {
    return (
      <div style={emptyStateStyle}>No sample rows to show.</div>
    );
  }

  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {["Order", "Date", "Location", "Product", "SKU", "Revenue"].map(
              (header) => (
                <th key={header} style={thStyle}>
                  {header}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.orderName}-${index}`}>
              <td style={tdStyle}>
                {row.orderUrl ? (
                  <a href={row.orderUrl} target="_blank" rel="noreferrer">
                    {row.orderName}
                  </a>
                ) : (
                  row.orderName
                )}
              </td>
              <td style={tdStyle}>{formatStoreDateTime(row.date)}</td>
              <td style={tdStyle}>{row.location}</td>
              <td style={tdStyle}>{row.product}</td>
              <td style={tdStyle}>{row.sku}</td>
              <td style={tdStyle}>{formatCurrency(row.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpensesCoverageSection({
  rows,
  preservedSearch,
}: {
  rows: ExpenseCoverageRow[];
  preservedSearch: string;
}) {
  const missingCount = rows.filter((row) => row.status === "Missing").length;

  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>Expenses coverage</h2>
          <HelperText>
            Locations without expenses may have overstated net profit.
          </HelperText>
        </div>
        <AppButtonLink to={`/app/admin/expenses${preservedSearch}`} compact>
          Open Expenses
        </AppButtonLink>
      </div>

      <div style={metricGridStyle}>
        <SummaryMetric label="Locations missing expenses" value={formatNumber(missingCount)} />
      </div>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.locationName}>
                <td style={tdStyle}>{row.locationName}</td>
                <td style={tdStyle}>
                  <StatusBadge variant={statusVariant(row.status)}>
                    {row.status}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SyncFreshnessSection({
  rows,
  preservedSearch,
}: {
  rows: SyncFreshnessRow[];
  preservedSearch: string;
}) {
  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>Sync freshness</h2>
          <HelperText>
            Fresh means the last successful sync finished within 24 hours.
          </HelperText>
        </div>
        <AppButtonLink to={`/app/admin/sync${preservedSearch}`} compact>
          Open Data Sync
        </AppButtonLink>
      </div>

      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Data type</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Last successful sync</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={tdStyle}>{row.label}</td>
                <td style={tdStyle}>
                  <StatusBadge variant={statusVariant(row.status)}>
                    {row.status}
                  </StatusBadge>
                </td>
                <td style={tdStyle}>
                  {row.finishedAt ? formatStoreDateTime(row.finishedAt) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const cardStyle = {
  background: "white",
  border: "1px solid #e3e3e3",
  borderRadius: 14,
  padding: 18,
} as const;

const sectionHeaderStyle = {
  alignItems: "start",
  display: "flex",
  gap: 14,
  justifyContent: "space-between",
  marginBottom: 14,
} as const;

const sectionTitleStyle = {
  fontSize: 18,
  margin: "0 0 4px",
} as const;

const metricGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  marginBottom: 14,
} as const;

const tableWrapStyle = {
  border: "1px solid #f0f0f0",
  borderRadius: 12,
  overflowX: "auto",
} as const;

const tableStyle = {
  borderCollapse: "collapse",
  fontSize: 14,
  width: "100%",
} as const;

const thStyle = {
  background: "white",
  borderBottom: "1px solid #dcdcdc",
  color: "#616161",
  fontWeight: 800,
  padding: "12px 10px",
  textAlign: "left",
  whiteSpace: "nowrap",
} as const;

const tdStyle = {
  borderBottom: "1px solid #f0f0f0",
  padding: "12px 10px",
  verticalAlign: "top",
} as const;

const emptyStateStyle = {
  border: "1px solid #f0f0f0",
  borderRadius: 12,
  color: "#707070",
  padding: 16,
} as const;

export default function DataQualityPage() {
  const {
    preservedSearch,
    missingCosts,
    missingStaff,
    missingVendor,
    expenseCoverage,
    syncFreshness,
    errors,
  } = useLoaderData<LoaderData>();

  return (
    <main
      style={{
        background: "#f6f6f7",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        minHeight: "100vh",
        padding: 28,
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: 1360 }}>
        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 16,
            marginBottom: 20,
            padding: 20,
          }}
        >
          <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0 }}>
            Data Quality
          </h1>
          <p style={{ color: "#616161", margin: "6px 0 0" }}>
            Find missing or outdated data that can affect your reporting.
          </p>
        </section>

        {errors.length > 0 ? (
          <section
            style={{
              background: "#fff4f4",
              border: "1px solid #f2b8b5",
              borderRadius: 14,
              marginBottom: 20,
              padding: 18,
            }}
          >
            <strong>Errors</strong>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(errors, null, 2)}
            </pre>
          </section>
        ) : null}

        <div style={{ display: "grid", gap: 20 }}>
          <QualitySection
            title="Missing product costs"
            impact="Missing costs can understate COGS and overstate gross profit."
            check={missingCosts}
          />
          <QualitySection
            title="Missing staff attribution"
            impact="Missing staff attribution makes Sales by Staff incomplete."
            check={missingStaff}
            showPercent
          />
          <QualitySection
            title="Missing vendor"
            impact="Missing vendors make vendor performance incomplete."
            check={missingVendor}
          />
          <ExpensesCoverageSection
            rows={expenseCoverage}
            preservedSearch={preservedSearch}
          />
          <SyncFreshnessSection
            rows={syncFreshness}
            preservedSearch={preservedSearch}
          />
        </div>
      </div>
    </main>
  );
}
