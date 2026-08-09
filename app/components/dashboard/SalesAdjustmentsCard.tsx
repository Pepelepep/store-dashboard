import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import type { DashboardLoaderData } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="shopops-adjustment-row">
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
        <div className="shopops-adjustment-warning">
          {kpis.refundAllocationWarning}
        </div>
      ) : null}
    </SectionCard>
  );
}
