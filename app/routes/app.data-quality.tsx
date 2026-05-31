import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { AppButtonLink } from "../components/ui/AppButton";
import { HelperText } from "../components/ui/HelperText";
import { StatusBadge } from "../components/ui/StatusBadge";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import {
  buildShopifyOrderUrl,
  formatNumber,
  formatStoreDateTime,
} from "../lib/dashboard/dashboard-metrics";
import type { LocationRow } from "../lib/dashboard/dashboard-types";
import { authenticate } from "../shopify.server";

type HealthStatus = "OK" | "Warning" | "Critical";

type ExpenseRow = {
  shopify_location_id: string | null;
  is_active: boolean;
};

type SyncFreshnessRow = {
  label: string;
  status: HealthStatus | "Unknown";
  finishedAt: string | null;
};

type IssueSample = Record<string, unknown>;

type QualityIssue = {
  key: string;
  title: string;
  explanation: string;
  count: number;
  status: HealthStatus;
  optional?: boolean;
  samples: IssueSample[];
};

type SyncHealth = {
  failedLast24h: number;
  failedLast7d: number;
};

type LoaderData = {
  shop: string;
  preservedSearch: string;
  syncHealth: SyncHealth;
  syncFreshness: SyncFreshnessRow[];
  issues: QualityIssue[];
  optionalIssues: QualityIssue[];
  expenseCoverage: {
    covered: number;
    missing: number;
    rows: Array<{ locationName: string; status: "Covered" | "Missing" }>;
  };
  errors: string[];
};

const sampleLimit = 10;
const freshnessMs = 24 * 60 * 60 * 1000;
const syncTypes = ["locations", "products", "inventory", "orders"];

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function getFreshnessStatus(finishedAt: string | null): SyncFreshnessRow["status"] {
  if (!finishedAt) return "Unknown";

  const timestamp = new Date(finishedAt).getTime();
  if (Number.isNaN(timestamp)) return "Unknown";

  return Date.now() - timestamp <= freshnessMs ? "OK" : "Warning";
}

function statusVariant(status: string) {
  if (status === "OK" || status === "Covered") return "success";
  if (status === "Critical") return "error";
  if (status === "Warning" || status === "Missing") return "warning";
  return "neutral";
}

function reportIssue(
  report: Record<string, unknown>,
  key: string,
): { count: number; samples: IssueSample[] } {
  const rawIssue = report[key];

  if (!rawIssue || typeof rawIssue !== "object") {
    return { count: 0, samples: [] };
  }

  const issue = rawIssue as Record<string, unknown>;
  const samples = Array.isArray(issue.samples)
    ? (issue.samples as IssueSample[]).slice(0, sampleLimit)
    : [];

  return {
    count: numberValue(issue.count),
    samples,
  };
}

function buildIssue({
  report,
  key,
  title,
  explanation,
  severity,
  optional = false,
}: {
  report: Record<string, unknown>;
  key: string;
  title: string;
  explanation: string;
  severity: "warning" | "critical";
  optional?: boolean;
}): QualityIssue {
  const issue = reportIssue(report, key);

  return {
    key,
    title,
    explanation,
    count: issue.count,
    status: issue.count > 0 ? (severity === "critical" ? "Critical" : "Warning") : "OK",
    optional,
    samples: issue.samples,
  };
}

async function getFailedSyncCount({
  supabase,
  shop,
  since,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  shop: string;
  since: string;
}) {
  const { count, error } = await supabase
    .from("sync_runs")
    .select("*", { count: "exact", head: true })
    .eq("shop_domain", shop)
    .eq("status", "error")
    .gte("started_at", since);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
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
  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    expensesResult,
    syncRunsResult,
    reportResult,
    failed24hResult,
    failed7dResult,
  ] = await Promise.allSettled([
    supabase
      .from("fixed_expenses")
      .select("shopify_location_id, is_active")
      .eq("shop_domain", session.shop)
      .eq("is_active", true),
    supabase
      .from("sync_runs")
      .select("sync_type, status, source, finished_at, started_at")
      .eq("shop_domain", session.shop)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(100),
    supabase.rpc("get_data_quality_report", {
      p_shop_domain: session.shop,
      p_location_ids: accessibleLocationIds,
    }),
    getFailedSyncCount({ supabase, shop: session.shop, since: since24h }),
    getFailedSyncCount({ supabase, shop: session.shop, since: since7d }),
  ]);

  const expenses =
    expensesResult.status === "fulfilled" && !expensesResult.value.error
      ? ((expensesResult.value.data ?? []) as ExpenseRow[])
      : [];
  const syncRuns =
    syncRunsResult.status === "fulfilled" && !syncRunsResult.value.error
      ? ((syncRunsResult.value.data ?? []) as Array<Record<string, unknown>>)
      : [];
  const report =
    reportResult.status === "fulfilled" && !reportResult.value.error
      ? ((reportResult.value.data ?? {}) as Record<string, unknown>)
      : {};
  const failedLast24h =
    failed24hResult.status === "fulfilled" ? failed24hResult.value : 0;
  const failedLast7d =
    failed7dResult.status === "fulfilled" ? failed7dResult.value : 0;

  if (expensesResult.status === "fulfilled" && expensesResult.value.error) {
    errors.push(expensesResult.value.error.message);
  }
  if (syncRunsResult.status === "fulfilled" && syncRunsResult.value.error) {
    errors.push(syncRunsResult.value.error.message);
  }
  if (reportResult.status === "fulfilled" && reportResult.value.error) {
    errors.push(reportResult.value.error.message);
  }
  if (failed24hResult.status === "rejected") {
    errors.push(failed24hResult.reason?.message ?? String(failed24hResult.reason));
  }
  if (failed7dResult.status === "rejected") {
    errors.push(failed7dResult.reason?.message ?? String(failed7dResult.reason));
  }

  const latestSyncByType = new Map<string, string | null>();

  for (const run of syncRuns) {
    const type = String(run.sync_type ?? "").toLowerCase();

    if (!syncTypes.includes(type) || latestSyncByType.has(type)) {
      continue;
    }

    latestSyncByType.set(
      type,
      typeof run.finished_at === "string" ? run.finished_at : null,
    );
  }

  const coveredLocationIds = new Set(
    expenses
      .map((expense) => expense.shopify_location_id)
      .filter((value): value is string => Boolean(value)),
  );
  const expenseRows = accessibleLocations.map((location) => ({
    locationName: location.name,
    status: coveredLocationIds.has(location.shopify_location_id)
      ? ("Covered" as const)
      : ("Missing" as const),
  }));
  const issues = [
    buildIssue({
      report,
      key: "productsWithoutVariants",
      title: "Products without variants",
      explanation: "Products without variants cannot map cleanly into sales or inventory reporting.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "variantsMissingInventoryItemId",
      title: "Variants missing inventory item ID",
      explanation: "Missing inventory item IDs prevent inventory levels and cost snapshots from linking reliably.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "variantsMissingUnitCost",
      title: "Variants missing unit cost",
      explanation: "Missing current cost forces order lines to use fallback or missing-cost handling.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "orderLinesMissingCogs",
      title: "Order lines missing COGS",
      explanation: "These rows do not currently have cost of goods sold after the latest recompute.",
      severity: "critical",
    }),
    buildIssue({
      report,
      key: "orderLinesUsingFallbackCost",
      title: "Order lines using fallback cost",
      explanation: "These rows use the 50% fallback because no current cost exists.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "ordersWithoutOrderLines",
      title: "Orders without order lines",
      explanation: "Orders without lines usually indicate an incomplete orders sync.",
      severity: "critical",
    }),
    buildIssue({
      report,
      key: "inventoryLevelsWithoutMatchingVariantOrProduct",
      title: "Inventory levels without matching variant/product",
      explanation: "Inventory rows that cannot join to variant/product data can distort stock reporting.",
      severity: "critical",
    }),
  ];
  const optionalIssues = [
    buildIssue({
      report,
      key: "orderLinesMissingStaffAttribution",
      title: "Missing staff attribution",
      explanation: "Optional/non-blocking. Shopify does not always provide staff attribution.",
      severity: "warning",
      optional: true,
    }),
  ];

  return {
    shop: session.shop,
    preservedSearch,
    syncHealth: {
      failedLast24h,
      failedLast7d,
    },
    syncFreshness: syncTypes.map((type) => {
      const finishedAt = latestSyncByType.get(type) ?? null;

      return {
        label: type[0].toUpperCase() + type.slice(1),
        status: getFreshnessStatus(finishedAt),
        finishedAt,
      };
    }),
    issues,
    optionalIssues,
    expenseCoverage: {
      covered: expenseRows.filter((row) => row.status === "Covered").length,
      missing: expenseRows.filter((row) => row.status === "Missing").length,
      rows: expenseRows,
    },
    errors,
  } satisfies LoaderData;
}

function SummaryMetric({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: HealthStatus;
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
      <div
        style={{
          alignItems: "center",
          color: "#202223",
          display: "flex",
          fontSize: 20,
          fontWeight: 800,
          gap: 8,
        }}
      >
        {value}
        {status ? (
          <StatusBadge variant={statusVariant(status)}>{status}</StatusBadge>
        ) : null}
      </div>
    </div>
  );
}

function SyncHealthSection({ syncHealth }: { syncHealth: SyncHealth }) {
  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>Sync failures</h2>
          <HelperText>Failed sync runs should be reviewed before trusting reports.</HelperText>
        </div>
      </div>
      <div style={metricGridStyle}>
        <SummaryMetric
          label="Failed syncs in last 24h"
          value={formatNumber(syncHealth.failedLast24h)}
          status={syncHealth.failedLast24h > 0 ? "Critical" : "OK"}
        />
        <SummaryMetric
          label="Failed syncs in last 7d"
          value={formatNumber(syncHealth.failedLast7d)}
          status={syncHealth.failedLast7d > 0 ? "Warning" : "OK"}
        />
      </div>
    </section>
  );
}

function QualityIssueSection({
  issue,
  shop,
}: {
  issue: QualityIssue;
  shop: string;
}) {
  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h2 style={sectionTitleStyle}>
            {issue.title}
            {issue.optional ? " (optional)" : ""}
          </h2>
          <HelperText>{issue.explanation}</HelperText>
        </div>
        <StatusBadge variant={statusVariant(issue.status)}>
          {issue.status}
        </StatusBadge>
      </div>

      <div style={metricGridStyle}>
        <SummaryMetric label="Affected rows" value={formatNumber(issue.count)} />
      </div>

      <SampleTable rows={issue.samples} shop={shop} />
    </section>
  );
}

function formatSampleValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (key.includes("created_at") && typeof value === "string") {
    return formatStoreDateTime(value);
  }

  if (typeof value === "number") {
    return formatNumber(value);
  }

  return String(value);
}

function SampleTable({ rows, shop }: { rows: IssueSample[]; shop: string }) {
  if (rows.length === 0) {
    return <div style={emptyStateStyle}>No sample rows to show.</div>;
  }

  const headers = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row))),
  ).slice(0, 8);

  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} style={thStyle}>
                {header.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {headers.map((header) => {
                const value = row[header];
                const isOrder =
                  header === "order_name" && typeof row.shopify_order_id === "string";

                return (
                  <td key={header} style={tdStyle}>
                    {isOrder ? (
                      <a
                        href={buildShopifyOrderUrl(shop, row.shopify_order_id as string)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {formatSampleValue(header, value)}
                      </a>
                    ) : (
                      formatSampleValue(header, value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpensesCoverageSection({
  rows,
  missing,
  preservedSearch,
}: {
  rows: LoaderData["expenseCoverage"]["rows"];
  missing: number;
  preservedSearch: string;
}) {
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
        <SummaryMetric
          label="Locations missing expenses"
          value={formatNumber(missing)}
          status={missing > 0 ? "Warning" : "OK"}
        />
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
          Open Sync Monitor
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
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
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
  textTransform: "capitalize",
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
    shop,
    preservedSearch,
    syncHealth,
    syncFreshness,
    issues,
    optionalIssues,
    expenseCoverage,
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
            Fast health checks for sync freshness, costs, orders, variants, and inventory joins.
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
          <SyncHealthSection syncHealth={syncHealth} />
          <SyncFreshnessSection
            rows={syncFreshness}
            preservedSearch={preservedSearch}
          />
          {issues.map((issue) => (
            <QualityIssueSection key={issue.key} issue={issue} shop={shop} />
          ))}
          <ExpensesCoverageSection
            rows={expenseCoverage.rows}
            missing={expenseCoverage.missing}
            preservedSearch={preservedSearch}
          />
          {optionalIssues.map((issue) => (
            <QualityIssueSection key={issue.key} issue={issue} shop={shop} />
          ))}
        </div>
      </div>
    </main>
  );
}
