import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";

import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
export {
  formatCurrencyAxis,
  formatIntegerAxis,
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
  upperValue?: number;
  productSales?: number;
  netSales?: number;
  orders?: number;
  unitsSold?: number;
};

export function ShopOpsChartTooltip({
  active,
  payload,
  label,
  valueKey,
  valueLabel,
}: TooltipContentProps & {
  valueKey: "upperValue" | "productSales" | "netSales";
  valueLabel: string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  const datum = payload[0]?.payload as ShopOpsTooltipDatum | undefined;
  const value = Number(datum?.[valueKey] ?? 0);

  return (
    <div
      className="shopops-chart-tooltip"
      style={{
        background: "rgba(17, 24, 39, 0.96)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.18)",
        color: "white",
        fontSize: 12,
        lineHeight: 1.5,
        padding: "9px 11px",
      }}
    >
      <strong>{datum?.tooltipLabel ?? String(label ?? "")}</strong>
      <div>
        {valueLabel}: {formatCurrency(value)}
      </div>
      <div>Orders: {formatNumber(Number(datum?.orders ?? 0))}</div>
      <div>Units sold: {formatNumber(Number(datum?.unitsSold ?? 0))}</div>
    </div>
  );
}

export function ShopOpsChartEmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      className="shopops-chart-empty"
      style={{
        alignItems: "center",
        background: "#fafafa",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        color: "#707070",
        display: "flex",
        minHeight: 220,
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}
