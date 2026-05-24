import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import type { DashboardLoaderData } from "../../lib/dashboard/dashboard-types";

function KpiCard({
  title,
  value,
  subtitle,
  explanation,
}: {
  title: string;
  value: string;
  subtitle: string;
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
      <div style={{ color: "#5f6368", fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
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
  selectedLocationName,
  startDate,
  endDate,
}: {
  kpis: DashboardLoaderData["kpis"];
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
}) {
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
        title="Revenue"
        value={formatCurrency(kpis.revenue)}
        subtitle="Synced retail sales"
        explanation="Total synced sales revenue for the selected location and date range."
      />
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
        explanation="Cost of goods sold from product cost data attached to order lines."
      />
      <KpiCard
        title="Gross profit"
        value={formatCurrency(kpis.grossProfit)}
        subtitle="Revenue minus COGS"
        explanation="Revenue minus cost of goods sold for the selected range."
      />
      <KpiCard
        title="Gross margin"
        value={formatPercent(kpis.grossMarginPct)}
        subtitle="Gross profit / revenue"
        explanation="Gross profit as a percentage of revenue."
      />
      <KpiCard
        title="Expenses"
        value={
          kpis.expenses === null ? "Not configured" : formatCurrency(kpis.expenses)
        }
        subtitle="Fixed expenses from DB"
        explanation="Fixed expenses allocated to the selected location and date range."
      />
      <KpiCard
        title="Net profit"
        value={
          kpis.netProfit === null ? "Not available" : formatCurrency(kpis.netProfit)
        }
        subtitle="Gross profit minus expenses"
        explanation="Gross profit minus configured fixed expenses."
      />
    </section>
  );
}
