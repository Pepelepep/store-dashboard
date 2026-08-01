import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  DashboardLoaderData,
  FinancialMetricsVersion,
} from "../../lib/dashboard/dashboard-types";

const metricDefinitions = {
  grossSales: "Gross Sales: product sales before discounts and returns.",
  discounts:
    "Discounts: Shopify discount allocations applied to orders and line items.",
  netSales: "Net Sales: Gross Sales minus Discounts and Returns.",
  cogs: "COGS: cost of goods sold from synced Shopify inventory item cost data where available.",
  grossProfit: "Gross Profit: Net Sales minus COGS.",
  margin: "Margin: Gross Profit divided by Net Sales.",
  refunds:
    "Refunds: cash refunded on Shopify orders, reported separately from returns.",
  returns:
    "Returns: returned line-item value used in net sales calculations where available.",
};

function KpiCard({
  title,
  value,
  subtitle,
  explanation,
  accent,
}: {
  title: string;
  value: string;
  subtitle: ReactNode;
  explanation: string;
  accent?: "sales" | "orders";
}) {
  return (
    <section
      title={explanation}
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        borderTop: accent
          ? `3px solid ${accent === "sales" ? "var(--shopops-accent, #2563eb)" : "var(--shopops-teal, #0f766e)"}`
          : undefined,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
        minHeight: 132,
      }}
    >
      <div
        style={{
          color: "#5f6368",
          fontSize: 14,
          fontWeight: 700,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        {value}
      </div>
      <div style={{ color: "#707070", fontSize: 13, lineHeight: 1.35 }}>
        {subtitle}
      </div>
    </section>
  );
}

export function KpiCards({
  kpis,
  financialMetricsVersion,
  canAdmin,
}: {
  kpis: DashboardLoaderData["kpis"];
  financialMetricsVersion: FinancialMetricsVersion;
  canAdmin: boolean;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const location = useLocation();
  const productCostsSearch = new URLSearchParams(location.search);
  productCostsSearch.set("tab", "products");
  const expensesSearch = new URLSearchParams(location.search);
  expensesSearch.set("tab", "expenses");
  const productCostsPath = `/app/costs?${productCostsSearch.toString()}`;
  const expensesPath = `/app/costs?${expensesSearch.toString()}`;
  const grossSales = kpis.grossSales ?? kpis.revenue;
  const discounts = kpis.discounts ?? 0;
  const discountPercent =
    grossSales > 0 ? `${((discounts / grossSales) * 100).toFixed(1)}%` : "0.0%";
  const grossProfitSubtitle = kpis.cogsIncomplete ? (
    <div
      role="status"
      style={{
        background: "#fff8e5",
        border: "1px solid #e5c07b",
        borderRadius: 8,
        color: "#5c4813",
        padding: "8px 9px",
      }}
    >
      <div>
        {formatNumber(kpis.missingCogsLineCount)} sales{" "}
        {kpis.missingCogsLineCount === 1 ? "line is" : "lines are"} missing
        product costs.
      </div>
      {canAdmin ? (
        <Link
          style={{ color: "#1d4ed8", display: "inline-block", marginTop: 5 }}
          to={productCostsPath}
        >
          Review product costs
        </Link>
      ) : null}
    </div>
  ) : kpis.includesEstimatedCogs ? (
    <div
      role="status"
      style={{
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: 8,
        color: "#1e3a5f",
        padding: "8px 9px",
      }}
    >
      <div>Includes estimated product costs</div>
      {canAdmin ? (
        <Link
          style={{ color: "#1d4ed8", display: "inline-block", marginTop: 5 }}
          to={productCostsPath}
        >
          Review product costs
        </Link>
      ) : null}
    </div>
  ) : isFinancialMetricsV2 ? (
    "Net Sales minus COGS"
  ) : (
    "Revenue minus COGS"
  );

  return (
    <>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 12,
        }}
      >
        <KpiCard
          accent="sales"
          title={isFinancialMetricsV2 ? "Net Sales" : "Revenue"}
          value={formatCurrency(kpis.revenue)}
          subtitle={
            isFinancialMetricsV2 ? (
              <>
                <div>After discounts &amp; returns</div>
                <div>
                  Discounts applied: {formatCurrency(discounts)} (
                  {discountPercent} of Gross)
                </div>
              </>
            ) : (
              "Synced retail sales"
            )
          }
          explanation={
            isFinancialMetricsV2
              ? metricDefinitions.netSales
              : "Total synced sales revenue for the selected location and date range."
          }
        />
        {isFinancialMetricsV2 ? (
          <>
            <KpiCard
              title="Refunds"
              value={formatCurrency(kpis.refunds ?? 0)}
              subtitle={
                <>
                  <div>
                    {formatNumber(kpis.refundTransactionsCount ?? 0)} refund
                    transactions · {formatNumber(kpis.refundedOrdersCount ?? 0)}{" "}
                    orders
                  </div>
                  {kpis.refundAllocationWarning ? (
                    <div>{kpis.refundAllocationWarning}</div>
                  ) : null}
                </>
              }
              explanation={metricDefinitions.refunds}
            />
            <KpiCard
              title="Returns"
              value={formatCurrency(kpis.returns ?? 0)}
              subtitle={`${formatNumber(kpis.returnedQuantity ?? 0)} units · ${formatNumber(kpis.returnedOrdersCount ?? 0)} orders`}
              explanation={metricDefinitions.returns}
            />
          </>
        ) : null}
        <KpiCard
          accent="orders"
          title="Orders"
          value={formatNumber(kpis.ordersCount)}
          subtitle="Unique orders for this location"
          explanation="Unique Shopify orders represented in the selected location and date range."
        />
        <KpiCard
          title="Units sold"
          value={formatNumber(kpis.unitsSold)}
          subtitle="Quantity sold from order lines"
          explanation="Total quantity sold across synced order lines in the selected range."
        />
        <KpiCard
          title="COGS"
          value={formatCurrency(kpis.cogs)}
          subtitle={
            <>
              <div>
                Actual: {formatCurrency(kpis.actualCogs)} · Estimated:{" "}
                {formatCurrency(kpis.estimatedCogs)}
              </div>
              {kpis.missingCogsLineCount > 0 ? (
                <div>
                  {formatNumber(kpis.missingCogsLineCount)} sales lines missing
                  costs
                </div>
              ) : null}
            </>
          }
          explanation={metricDefinitions.cogs}
        />
        <KpiCard
          title="Gross profit"
          value={
            kpis.grossProfit === null ? "—" : formatCurrency(kpis.grossProfit)
          }
          subtitle={grossProfitSubtitle}
          explanation={
            isFinancialMetricsV2
              ? metricDefinitions.grossProfit
              : "Revenue minus COGS. COGS uses the latest Shopify Cost per item. Missing costs appear as MISSING_COST."
          }
        />
        <KpiCard
          title="Gross margin"
          value={formatPercent(kpis.grossMarginPct)}
          subtitle={
            kpis.cogsIncomplete
              ? "Requires complete product costs"
              : isFinancialMetricsV2
                ? "Gross profit / Net Sales"
                : "Gross profit / revenue"
          }
          explanation={
            isFinancialMetricsV2
              ? metricDefinitions.margin
              : "Gross profit as a percentage of revenue. COGS uses the latest Shopify Cost per item. Missing costs appear as MISSING_COST."
          }
        />
        <KpiCard
          title="Expenses"
          value={
            kpis.expenses === null
              ? "Not configured"
              : formatCurrency(kpis.expenses)
          }
          subtitle="Fixed expenses from DB"
          explanation="Fixed expenses allocated to the selected location and date range."
        />
        <KpiCard
          title="Net profit"
          value={
            kpis.netProfit === null
              ? "Not available"
              : formatCurrency(kpis.netProfit)
          }
          subtitle={
            kpis.cogsIncomplete ? (
              "Requires complete product costs"
            ) : !kpis.hasOperatingExpenses && canAdmin ? (
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #d9dee5",
                  borderRadius: 8,
                  color: "#4b5563",
                  padding: "8px 9px",
                }}
              >
                <div>No operating expenses configured.</div>
                <Link
                  style={{
                    color: "#1d4ed8",
                    display: "inline-block",
                    marginTop: 5,
                  }}
                  to={expensesPath}
                >
                  Add expenses
                </Link>
              </div>
            ) : (
              "Gross profit minus expenses"
            )
          }
          explanation="Gross profit minus configured fixed expenses."
        />
      </section>
      {isFinancialMetricsV2 ? (
        <details
          style={{
            color: "#616161",
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 22,
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>
            Metric definitions
          </summary>
          <div style={{ marginTop: 8 }}>
            {metricDefinitions.grossSales} {metricDefinitions.discounts}{" "}
            {metricDefinitions.netSales} {metricDefinitions.cogs}{" "}
            {metricDefinitions.grossProfit} {metricDefinitions.margin}{" "}
            {metricDefinitions.refunds} {metricDefinitions.returns}
          </div>
        </details>
      ) : null}
    </>
  );
}
