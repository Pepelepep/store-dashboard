import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
export {
  formatCurrencyAxis,
  formatIntegerAxis,
  formatNonZeroCurrencyLabel,
  formatNonZeroIntegerLabel,
  hasMirrorChartActivity,
} from "../../lib/dashboard/chart-formatters";

export const SHOP_OPS_CHART_MARGIN = {
  top: 24,
  right: 16,
  bottom: 12,
  left: 4,
} as const;

export const SHOP_OPS_GRID_PROPS = {
  stroke: "#e5e7eb",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

type ShopOpsTooltipDatum = {
  tooltipLabel?: string;
  sales?: number;
  productSales?: number;
  netSales?: number;
  comparisonSales?: number;
  orders?: number;
  unitsSold?: number;
};

export function ShopOpsChartTooltip({
  active,
  payload,
  label,
  labelLabel,
  valueKey,
  valueLabel,
  comparisonLabel,
}: TooltipContentProps & {
  labelLabel?: string;
  valueKey: "sales" | "productSales" | "netSales";
  valueLabel: string;
  comparisonLabel?: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const datum = payload[0]?.payload as ShopOpsTooltipDatum | undefined;
  const value = Number(datum?.[valueKey] ?? 0);

  return (
    <div className="shopops-chart-tooltip">
      <strong>
        {labelLabel ? `${labelLabel}: ` : ""}
        {datum?.tooltipLabel ?? String(label ?? "")}
      </strong>
      <div>
        {valueLabel}: {formatCurrency(value)}
      </div>
      {comparisonLabel && datum?.comparisonSales !== undefined ? (
        <div>
          {comparisonLabel}: {formatCurrency(datum.comparisonSales)}
        </div>
      ) : null}
      <div>Orders: {formatNumber(Number(datum?.orders ?? 0))}</div>
      <div>Units sold: {formatNumber(Number(datum?.unitsSold ?? 0))}</div>
    </div>
  );
}

export function ShopOpsChartEmptyState({ children }: { children: ReactNode }) {
  return <div className="shopops-chart-empty">{children}</div>;
}
