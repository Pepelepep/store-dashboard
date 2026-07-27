import { MirrorSalesChart } from "./MirrorSalesChart";

export type NetSalesTrendPoint = {
  period: string;
  label: string;
  revenue: number;
  ordersCount: number;
  unitsSold: number;
};

export function NetSalesTrendPlot({
  rows,
  revenueLabel,
  selectedPeriod,
  onSelectPeriod,
}: {
  rows: NetSalesTrendPoint[];
  revenueLabel: string;
  selectedPeriod?: string | null;
  onSelectPeriod?: (row: NetSalesTrendPoint) => void;
}) {
  const chartPoints = rows.map((row) => ({
    key: row.period,
    axisLabel: row.label,
    tooltipLabel: row.period,
    sales: row.revenue,
    orders: row.ordersCount,
    unitsSold: row.unitsSold,
  }));

  return (
    <MirrorSalesChart
      ariaLabel={`${revenueLabel} above and Orders below in aligned periods.`}
      emptyMessage="No net sales or orders match the current filters."
      labelMode="always"
      onSelectPoint={(_, index) => onSelectPeriod?.(rows[index])}
      points={chartPoints}
      salesLabel={revenueLabel}
      selectedKey={selectedPeriod}
      tooltipBucketLabel="Period"
    />
  );
}
