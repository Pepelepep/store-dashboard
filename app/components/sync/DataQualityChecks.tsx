import { AppButtonLink } from "../ui/AppButton";
import { HelperText } from "../ui/HelperText";
import { StatusBadge } from "../ui/StatusBadge";
import { formatNumber, formatStoreDateTime } from "../../lib/dashboard/dashboard-metrics";
import { buildShopifyOrderUrl } from "../../lib/shopify/order-url";
import { getDataSyncPath } from "../../lib/navigation/sync-status";
import type {
  DataQualityReport,
  IssueSample,
  QualityIssue,
} from "../../lib/data-quality/data-quality-report.server";

function statusVariant(status: string) {
  if (status === "OK" || status === "Covered") return "success";
  if (status === "Critical") return "error";
  if (status === "Warning" || status === "Missing") return "warning";
  return "neutral";
}

function getIssueCta(issue: QualityIssue, preservedSearch: string) {
  if (issue.key === "ordersWithoutOrderLines") {
    return {
      to: `/app/admin/financial-qa${preservedSearch}`,
      label: "Open order diagnostics",
    };
  }
  return {
    to: getDataSyncPath(preservedSearch),
    label: "Open Sync Status",
  };
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
                  header === "order_name" &&
                  typeof row.shopify_order_id === "string";

                return (
                  <td key={header} style={tdStyle}>
                    {isOrder ? (
                      <a
                        href={
                          buildShopifyOrderUrl(
                            shop,
                            row.shopify_order_id as string,
                          ) ?? undefined
                        }
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

function QualityIssueSection({
  issue,
  shop,
  preservedSearch,
}: {
  issue: QualityIssue;
  shop: string;
  preservedSearch: string;
}) {
  const cta = getIssueCta(issue, preservedSearch);

  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h3 style={sectionTitleStyle}>
            {issue.title}
            {issue.optional ? " (optional)" : ""}
          </h3>
          <HelperText>{issue.explanation}</HelperText>
        </div>
        <StatusBadge variant={statusVariant(issue.status)}>
          {issue.status}
        </StatusBadge>
      </div>

      <div style={{ marginBottom: 12 }}>
        Affected rows: <strong>{formatNumber(issue.count)}</strong>
      </div>
      {issue.count > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <AppButtonLink to={cta.to} compact>
            {cta.label}
          </AppButtonLink>
        </div>
      ) : null}

      <SampleTable rows={issue.samples} shop={shop} />
    </section>
  );
}

function ExpensesCoverageSection({
  rows,
  missing,
  preservedSearch,
}: {
  rows: DataQualityReport["expenseCoverage"]["rows"];
  missing: number;
  preservedSearch: string;
}) {
  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <h3 style={sectionTitleStyle}>Expenses coverage</h3>
          <HelperText>
            Locations without expenses may have overstated net profit.
          </HelperText>
        </div>
        <AppButtonLink
          to={`/app/costs?tab=expenses${preservedSearch ? `&${preservedSearch.slice(1)}` : ""}`}
          compact
        >
          Open Expense Setup
        </AppButtonLink>
      </div>

      <div style={{ marginBottom: 12 }}>
        Locations missing expenses:{" "}
        <StatusBadge variant={missing > 0 ? "warning" : "success"}>
          {formatNumber(missing)}
        </StatusBadge>
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

export function DataQualityChecks({
  report,
  shop,
  preservedSearch,
}: {
  report: DataQualityReport;
  shop: string;
  preservedSearch: string;
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {report.errors.length > 0 ? (
        <div style={{ color: "#b42318", fontSize: 13 }}>
          Some data quality checks could not be loaded: {report.errors.join(", ")}
        </div>
      ) : null}
      {report.issues.map((issue) => (
        <QualityIssueSection
          key={issue.key}
          issue={issue}
          shop={shop}
          preservedSearch={preservedSearch}
        />
      ))}
      <ExpensesCoverageSection
        rows={report.expenseCoverage.rows}
        missing={report.expenseCoverage.missing}
        preservedSearch={preservedSearch}
      />
      {report.optionalIssues.map((issue) => (
        <QualityIssueSection
          key={issue.key}
          issue={issue}
          shop={shop}
          preservedSearch={preservedSearch}
        />
      ))}
    </div>
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
  fontSize: 16,
  margin: "0 0 4px",
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
