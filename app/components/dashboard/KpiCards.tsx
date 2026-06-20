import type { ReactNode } from "react";

import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  DashboardLoaderData,
  FinancialMetricsVersion,
} from "../../lib/dashboard/dashboard-types";

function KpiCard({
  title,
  value,
  subtitle,
  explanation,
}: {
  title: string;
  value: string;
  subtitle: ReactNode;
  explanation: string;
}) {
  return (
    <section
      title={explanation}
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
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
}: {
  kpis: DashboardLoaderData["kpis"];
  financialMetricsVersion: FinancialMetricsVersion;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const grossSales = kpis.grossSales ?? kpis.revenue;
  const discounts = kpis.discounts ?? 0;
  const discountPercent =
    grossSales > 0 ? `${((discounts / grossSales) * 100).toFixed(1)}%` : "0.0%";

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16,
        marginBottom: 22,
      }}
    >
      <KpiCard
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
            ? "Net Sales is Gross Sales minus Discounts and Returns. Refunds are tracked separately as cash movement."
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
            explanation="Cash refunded during the selected date range based on successful refund transactions. Refunds are not subtracted from Net Sales."
          />
          <KpiCard
            title="Returns"
            value={formatCurrency(kpis.returns ?? 0)}
            subtitle={`${formatNumber(kpis.returnedQuantity ?? 0)} units · ${formatNumber(kpis.returnedOrdersCount ?? 0)} orders`}
            explanation="Returned merchandise on sales in selected period."
          />
        </>
      ) : null}
      <KpiCard
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
        subtitle="Product costs"
        explanation="COGS uses the latest Shopify Cost per item. Missing costs appear as MISSING_COST."
      />
      <KpiCard
        title="Gross profit"
        value={formatCurrency(kpis.grossProfit)}
        subtitle={
          isFinancialMetricsV2 ? "Net Sales minus COGS" : "Revenue minus COGS"
        }
        explanation={
          isFinancialMetricsV2
            ? "Net Sales minus COGS. COGS uses cost at sale when available, with legacy COGS fallback."
            : "Revenue minus COGS. COGS uses the latest Shopify Cost per item. Missing costs appear as MISSING_COST."
        }
      />
      <KpiCard
        title="Gross margin"
        value={formatPercent(kpis.grossMarginPct)}
        subtitle={
          isFinancialMetricsV2
            ? "Gross profit / Net Sales"
            : "Gross profit / revenue"
        }
        explanation={
          isFinancialMetricsV2
            ? "Gross profit as a percentage of Net Sales."
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
        subtitle="Gross profit minus expenses"
        explanation="Gross profit minus configured fixed expenses."
      />
    </section>
  );
}
