import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import type { DashboardLoaderData } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "commercial" | "negative" | "neutral";
}) {
  return (
    <div className="shopops-adjustment-row" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
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
      subtitle="Net sales subtract discounts and merchandise returns. Cash refunds are shown separately, not deducted twice."
    >
      <Row
        label="Gross sales"
        tone="commercial"
        value={formatCurrency(grossSales)}
      />
      <Row
        label={`Discounts (${discountPercent} of gross)`}
        tone="negative"
        value={`-${formatCurrency(discounts)}`}
      />
      <Row
        label={`Merchandise returns deducted (${formatNumber(
          kpis.returnedQuantity ?? 0,
        )} units · ${formatNumber(kpis.returnedOrdersCount ?? 0)} orders)`}
        tone="negative"
        value={`-${formatCurrency(kpis.returns ?? 0)}`}
      />
      <Row
        label="Net sales"
        tone="commercial"
        value={formatCurrency(kpis.revenue)}
      />
      <Row
        label={`Cash refunds shown separately (${formatNumber(
          kpis.refundTransactionsCount ?? 0,
        )} tx · ${formatNumber(kpis.refundedOrdersCount ?? 0)} orders)`}
        value={formatCurrency(kpis.refunds ?? 0)}
      />
      {kpis.refundAllocationWarning ? (
        <div className="shopops-adjustment-warning">
          {kpis.refundAllocationWarning}
        </div>
      ) : null}
    </SectionCard>
  );
}
