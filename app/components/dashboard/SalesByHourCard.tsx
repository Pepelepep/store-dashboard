import { useMemo } from "react";

import type {
  FinancialMetricsVersion,
  SalesByHourRow,
} from "../../lib/dashboard/dashboard-types";
import { MirrorSalesChart } from "./MirrorSalesChart";
import { SectionCard } from "./SectionCard";

function formatHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function normalizeHourlyRows(rows: SalesByHourRow[]) {
  const rowsByHour = new Map(rows.map((row) => [row.hour, row]));

  return Array.from({ length: 24 }, (_, hour) => {
    const row = rowsByHour.get(hour);

    return row
      ? { ...row, hour }
      : {
          hour,
          revenue: 0,
          unitsSold: 0,
          ordersCount: 0,
          averageOrderValue: 0,
        };
  });
}

export function SalesByHourCard({
  salesByHour,
  financialMetricsVersion,
  selectedHour,
  onSelectHour,
}: {
  salesByHour: SalesByHourRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  selectedHour?: number | null;
  onSelectHour?: (hour: number) => void;
}) {
  const rows = useMemo(() => normalizeHourlyRows(salesByHour), [salesByHour]);
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const revenueLabel = isFinancialMetricsV2 ? "Product sales" : "Revenue";
  const chartPoints = rows.map((row) => ({
    key: String(row.hour),
    axisLabel: formatHourLabel(row.hour),
    tooltipLabel: formatHourLabel(row.hour),
    sales: row.revenue,
    orders: row.ordersCount,
    unitsSold: row.unitsSold,
  }));

  return (
    <SectionCard
      title={isFinancialMetricsV2 ? "Hourly product sales" : "Sales by hour"}
      subtitle={
        isFinancialMetricsV2
          ? "Product sales by store hour; order-level cash refunds are excluded."
          : "Revenue and distinct Shopify orders by store hour."
      }
    >
      <MirrorSalesChart
        ariaLabel={`${revenueLabel} above and distinct Orders below for every store-day hour from 00:00 through 23:00.`}
        emptyMessage="No hourly product sales or orders match the current filters."
        labelMode="always"
        maximumTickLabels={8}
        minimumBucketWidth={36}
        minimumWidth={864}
        onSelectPoint={(_, index) => onSelectHour?.(rows[index].hour)}
        points={chartPoints}
        salesLabel={revenueLabel}
        selectedKey={
          selectedHour === null || selectedHour === undefined
            ? null
            : String(selectedHour)
        }
        tooltipBucketLabel="Hour"
      />
    </SectionCard>
  );
}
