import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import type { DashboardLoaderData } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 0",
        fontSize: 14,
      }}
    >
      <span style={{ color: "#5c5f62" }}>{label}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

export function SalesAdjustmentsCard({
  kpis,
}: {
  kpis: DashboardLoaderData["kpis"];
}) {
  const grossSales = kpis.grossSales ?? kpis.revenue;
  const discounts = kpis.discounts ?? 0;
  const discountPercent =
    grossSales > 0
      ? formatPercent((discounts / grossSales) * 100)
      : formatPercent(0);

  return (
    <SectionCard
      title="Sales adjustments"
      subtitle="How gross sales became net sales this period."
    >
      <Row label="Gross sales" value={formatCurrency(grossSales)} />
      <Row
        label={`Discounts (${discountPercent} of gross)`}
        value={`-${formatCurrency(discounts)}`}
      />
      <Row
        label={`Refunds (${formatNumber(
          kpis.refundTransactionsCount ?? 0,
        )} tx · ${formatNumber(kpis.refundedOrdersCount ?? 0)} orders)`}
        value={`-${formatCurrency(kpis.refunds ?? 0)}`}
      />
      <Row
        label={`Returns (${formatNumber(
          kpis.returnedQuantity ?? 0,
        )} units · ${formatNumber(kpis.returnedOrdersCount ?? 0)} orders)`}
        value={`-${formatCurrency(kpis.returns ?? 0)}`}
      />
      {kpis.refundAllocationWarning ? (
        <div style={{ color: "#7a4b00", fontSize: 12, marginTop: 8 }}>
          {kpis.refundAllocationWarning}
        </div>
      ) : null}
    </SectionCard>
  );
}
