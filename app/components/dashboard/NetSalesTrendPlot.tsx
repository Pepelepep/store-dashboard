import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import {
  formatCurrencyAxis,
  formatIntegerAxis,
  SHOP_OPS_CHART_MARGIN,
  SHOP_OPS_GRID_PROPS,
  ShopOpsChartEmptyState,
  ShopOpsChartTooltip,
} from "./ShopOpsChart";

export type NetSalesTrendPoint = {
  period: string;
  label: string;
  revenue: number;
  ordersCount: number;
  unitsSold: number;
};

const CHART_HEIGHT = 276;

function getPointDetail(row: NetSalesTrendPoint, revenueLabel: string) {
  return [
    `Period: ${row.period}`,
    `${revenueLabel}: ${formatCurrency(row.revenue)}`,
    `Orders: ${formatNumber(row.ordersCount)}`,
    `Units sold: ${formatNumber(row.unitsSold)}`,
  ].join(". ");
}

function getAxisInterval(pointCount: number) {
  return Math.max(0, Math.ceil(pointCount / 7) - 1);
}

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
  const [focusedPeriod, setFocusedPeriod] = useState<string | null>(null);
  const labelsByPeriod = useMemo(
    () => new Map(rows.map((row) => [row.period, row.label])),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <ShopOpsChartEmptyState>
        No sales available for this period.
      </ShopOpsChartEmptyState>
    );
  }

  const chartData = rows.map((row) => ({
    ...row,
    tooltipLabel: row.period,
    netSales: row.revenue,
    orders: row.ordersCount,
  }));
  const minimumChartWidth = Math.max(
    720,
    Math.min(Math.max(rows.length - 1, 1) * 24, 2400),
  );
  const highlightedPeriod = focusedPeriod ?? selectedPeriod ?? null;

  return (
    <div
      aria-label={`${revenueLabel} and Orders time-series chart.`}
      className="shopops-recharts shopops-chart-scroll"
      role="group"
      style={{ overflowX: "auto", position: "relative" }}
    >
      <div
        style={{
          alignItems: "center",
          color: "#4b5563",
          display: "flex",
          flexWrap: "wrap",
          fontSize: 12,
          fontWeight: 700,
          gap: 16,
          marginBottom: 8,
        }}
      >
        <span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              background: "#2563eb",
              borderRadius: 999,
              height: 3,
              width: 22,
            }}
          />
          {revenueLabel}
        </span>
        <span style={{ alignItems: "center", display: "inline-flex", gap: 6 }}>
          <span
            aria-hidden="true"
            style={{
              background: "#0f766e",
              borderRadius: 999,
              height: 2,
              width: 22,
            }}
          />
          Orders
        </span>
      </div>
      <div
        style={{
          height: CHART_HEIGHT,
          minWidth: minimumChartWidth,
          width: "100%",
        }}
      >
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart
            accessibilityLayer
            data={chartData}
            margin={SHOP_OPS_CHART_MARGIN}
            onClick={(state) => {
              const index = Number(state.activeTooltipIndex);
              const row = Number.isInteger(index) ? rows[index] : null;
              if (row) onSelectPeriod?.(row);
            }}
            style={{ cursor: onSelectPeriod ? "pointer" : undefined }}
          >
            <CartesianGrid {...SHOP_OPS_GRID_PROPS} />
            <XAxis
              axisLine={{ stroke: "#9ca3af" }}
              dataKey="period"
              interval={getAxisInterval(rows.length)}
              minTickGap={16}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              tickFormatter={(period) =>
                labelsByPeriod.get(String(period)) ?? String(period)
              }
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={[
                (dataMinimum: number) => Math.min(0, dataMinimum),
                (dataMaximum: number) =>
                  dataMaximum === 0 ? 1 : Math.max(0, dataMaximum),
              ]}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              tickFormatter={formatCurrencyAxis}
              tickLine={false}
              width={64}
              yAxisId="sales"
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              domain={[
                0,
                (dataMaximum: number) => Math.max(1, Math.ceil(dataMaximum)),
              ]}
              orientation="right"
              tick={{ fill: "#6b7280", fontSize: 11 }}
              tickFormatter={formatIntegerAxis}
              tickLine={false}
              width={44}
              yAxisId="orders"
            />
            <Tooltip
              content={(props) => (
                <ShopOpsChartTooltip
                  {...props}
                  valueKey="netSales"
                  valueLabel={revenueLabel}
                />
              )}
              cursor={{ stroke: "#bfdbfe", strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <ReferenceLine
              stroke="#9ca3af"
              strokeWidth={1.5}
              y={0}
              yAxisId="sales"
            />
            {highlightedPeriod ? (
              <ReferenceLine
                stroke="#2563eb"
                strokeDasharray="3 3"
                strokeWidth={2}
                x={highlightedPeriod}
                yAxisId="sales"
              />
            ) : null}
            <Area
              dataKey="netSales"
              fill="#dbeafe"
              fillOpacity={0.55}
              isAnimationActive={false}
              name={revenueLabel}
              stroke="none"
              type="linear"
              yAxisId="sales"
            />
            <Line
              activeDot={{ fill: "#2563eb", r: 5, stroke: "white" }}
              dataKey="netSales"
              dot={{ fill: "white", r: 3, stroke: "#2563eb", strokeWidth: 2 }}
              isAnimationActive={false}
              name={revenueLabel}
              stroke="#2563eb"
              strokeWidth={3}
              type="linear"
              yAxisId="sales"
            />
            <Line
              activeDot={{ fill: "#0f766e", r: 4, stroke: "white" }}
              dataKey="orders"
              dot={{ fill: "white", r: 2.5, stroke: "#0f766e", strokeWidth: 2 }}
              isAnimationActive={false}
              name="Orders"
              stroke="#0f766e"
              strokeWidth={2}
              type="linear"
              yAxisId="orders"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div
        aria-label="Trend chart keyboard controls"
        className="shopops-chart-keyboard-controls"
      >
        {rows.map((row) => (
          <button
            aria-label={getPointDetail(row, revenueLabel)}
            aria-pressed={selectedPeriod === row.period}
            key={row.period}
            onBlur={() => setFocusedPeriod(null)}
            onClick={() => onSelectPeriod?.(row)}
            onFocus={() => setFocusedPeriod(row.period)}
            type="button"
          >
            {row.period}
          </button>
        ))}
      </div>
    </div>
  );
}
