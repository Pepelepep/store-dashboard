import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
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
import type {
  FinancialMetricsVersion,
  SalesByHourRow,
} from "../../lib/dashboard/dashboard-types";
import {
  formatCurrencyAxis,
  formatIntegerAxis,
  SHOP_OPS_CHART_MARGIN,
  SHOP_OPS_GRID_PROPS,
  ShopOpsChartTooltip,
} from "./ShopOpsChart";
import { SectionCard } from "./SectionCard";

const CHART_HEIGHT = 276;

function formatHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function getHourDetail(row: SalesByHourRow, revenueLabel: string) {
  return [
    `Time: ${formatHourLabel(row.hour)}`,
    `${revenueLabel}: ${formatCurrency(row.revenue)}`,
    `Orders: ${formatNumber(row.ordersCount)}`,
    `Units sold: ${formatNumber(row.unitsSold)}`,
  ].join(". ");
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
  const [focusedHour, setFocusedHour] = useState<number | null>(null);
  const rows = useMemo(() => normalizeHourlyRows(salesByHour), [salesByHour]);
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const revenueLabel = isFinancialMetricsV2 ? "Product sales" : "Revenue";
  const hasActivity = rows.some(
    (row) => row.revenue !== 0 || row.ordersCount > 0,
  );
  const chartData = rows.map((row) => ({
    ...row,
    time: formatHourLabel(row.hour),
    tooltipLabel: formatHourLabel(row.hour),
    productSales: row.revenue,
    orders: row.ordersCount,
  }));
  const highlightedHour = focusedHour ?? selectedHour ?? null;
  const highlightedTime =
    highlightedHour === null ? null : formatHourLabel(highlightedHour);

  return (
    <SectionCard
      title={isFinancialMetricsV2 ? "Hourly product sales" : "Sales by hour"}
      subtitle={
        isFinancialMetricsV2
          ? "Product sales by store hour; order-level cash refunds are excluded."
          : "Revenue and distinct Shopify orders by store hour."
      }
    >
      <div
        aria-label={`${revenueLabel} bars and distinct Orders line for every store-day hour from 00:00 through 23:00.`}
        className="shopops-recharts shopops-chart-scroll"
        role="group"
        style={{ overflowX: "auto", position: "relative" }}
      >
        {!hasActivity ? (
          <p
            style={{
              color: "#6b7280",
              fontSize: 12,
              margin: "0 0 6px 64px",
            }}
          >
            No hourly sales for the current filters. All 24 hours remain
            available.
          </p>
        ) : null}
        <div style={{ height: CHART_HEIGHT, minWidth: 720, width: "100%" }}>
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart
              accessibilityLayer
              barCategoryGap="34%"
              data={chartData}
              margin={SHOP_OPS_CHART_MARGIN}
              onClick={(state) => {
                const index = Number(state.activeTooltipIndex);
                const row = Number.isInteger(index) ? rows[index] : null;
                if (row) onSelectHour?.(row.hour);
              }}
              style={{ cursor: onSelectHour ? "pointer" : undefined }}
            >
              <CartesianGrid {...SHOP_OPS_GRID_PROPS} />
              <XAxis
                axisLine={{ stroke: "#9ca3af" }}
                dataKey="time"
                interval={2}
                minTickGap={16}
                tick={{ fill: "#6b7280", fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                allowDataOverflow={false}
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
                    valueKey="productSales"
                    valueLabel={revenueLabel}
                  />
                )}
                cursor={{ fill: "#eff6ff" }}
                isAnimationActive={false}
              />
              <ReferenceLine
                stroke="#9ca3af"
                strokeWidth={1.5}
                y={0}
                yAxisId="sales"
              />
              {highlightedTime ? (
                <ReferenceLine
                  stroke="#2563eb"
                  strokeDasharray="3 3"
                  strokeWidth={2}
                  x={highlightedTime}
                  yAxisId="sales"
                />
              ) : null}
              <Bar
                dataKey="productSales"
                fill="#2563eb"
                isAnimationActive={false}
                name={revenueLabel}
                radius={[4, 4, 0, 0]}
                yAxisId="sales"
              >
                {rows.map((row) => (
                  <Cell
                    fill={
                      selectedHour === row.hour
                        ? "#1d4ed8"
                        : focusedHour === row.hour
                          ? "#3b82f6"
                          : "#2563eb"
                    }
                    key={row.hour}
                  />
                ))}
              </Bar>
              <Line
                activeDot={{ fill: "#0f766e", r: 5, stroke: "white" }}
                dataKey="orders"
                dot={{ fill: "white", r: 3, stroke: "#0f766e", strokeWidth: 2 }}
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
          aria-label="Hourly chart keyboard controls"
          className="shopops-chart-keyboard-controls"
        >
          {rows.map((row) => (
            <button
              aria-label={getHourDetail(row, revenueLabel)}
              aria-pressed={selectedHour === row.hour}
              key={row.hour}
              onBlur={() => setFocusedHour(null)}
              onClick={() => onSelectHour?.(row.hour)}
              onFocus={() => setFocusedHour(row.hour)}
              type="button"
            >
              {formatHourLabel(row.hour)}
            </button>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
