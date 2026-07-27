import { useId, useMemo, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
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
import { buildMirrorChartScale } from "../../lib/dashboard/mirror-sales-chart";
import {
  formatCurrencyAxis,
  formatIntegerAxis,
  SHOP_OPS_CHART_MARGIN,
  SHOP_OPS_GRID_PROPS,
  ShopOpsChartEmptyState,
  ShopOpsChartTooltip,
} from "./ShopOpsChart";

export type MirrorSalesChartPoint = {
  key: string;
  axisLabel: string;
  tooltipLabel: string;
  sales: number;
  orders: number;
  unitsSold: number;
};

const MIRROR_CHART_HEIGHT = 292;
const MAX_CHART_WIDTH = 2400;

const VISUALLY_HIDDEN_STYLE = {
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
} as const;

function getAxisInterval(pointCount: number, maximumTickLabels: number) {
  return Math.max(0, Math.ceil(pointCount / maximumTickLabels) - 1);
}

function getPointDetail(point: MirrorSalesChartPoint, salesLabel: string) {
  return [
    point.tooltipLabel,
    `${salesLabel}: ${formatCurrency(point.sales)}`,
    `Orders: ${formatNumber(point.orders)}`,
    `Units sold: ${formatNumber(point.unitsSold)}`,
  ].join(". ");
}

function getMirrorTicks(maximumSales: number, maximumOrders: number) {
  const orderTicks =
    maximumOrders > 1 ? [-1, -0.5] : maximumOrders > 0 ? [-1] : [];
  const salesTicks = maximumSales > 0 ? [0.5, 1] : [];

  return [...orderTicks, 0, ...salesTicks];
}

export function MirrorSalesChart({
  points,
  salesLabel,
  ariaLabel,
  emptyMessage,
  selectedKey,
  onSelectPoint,
  maximumTickLabels = 8,
  minimumWidth = 640,
  minimumBucketWidth = 24,
}: {
  points: MirrorSalesChartPoint[];
  salesLabel: string;
  ariaLabel: string;
  emptyMessage: string;
  selectedKey?: string | null;
  onSelectPoint?: (point: MirrorSalesChartPoint, index: number) => void;
  maximumTickLabels?: number;
  minimumWidth?: number;
  minimumBucketWidth?: number;
}) {
  const statusId = useId();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const labelsByKey = useMemo(
    () => new Map(points.map((point) => [point.key, point.axisLabel])),
    [points],
  );
  const mirrorScale = useMemo(() => buildMirrorChartScale(points), [points]);
  const { hasActivity, maximumOrders, maximumSales } = mirrorScale;
  const activityCount = points.filter(
    (point) => point.sales !== 0 || point.orders !== 0,
  ).length;
  const showValueLabels = points.length <= 10 || activityCount <= 6;
  const selectedIndex = selectedKey
    ? points.findIndex((point) => point.key === selectedKey)
    : -1;
  const highlightedIndex =
    focusedIndex ?? (selectedIndex >= 0 ? selectedIndex : null);
  const highlightedPoint =
    highlightedIndex === null ? null : points[highlightedIndex];
  const accessibleIndex = highlightedIndex ?? 0;
  const chartData = mirrorScale.points.map((point) => ({
    ...point,
    upperValue: point.sales,
    upperLabel:
      showValueLabels && point.sales !== 0
        ? formatCurrencyAxis(point.sales)
        : "",
    lowerLabel:
      showValueLabels && point.orders !== 0 ? formatNumber(point.orders) : "",
  }));
  const minimumChartWidth = Math.max(
    minimumWidth,
    Math.min(Math.max(points.length, 1) * minimumBucketWidth, MAX_CHART_WIDTH),
  );

  if (!hasActivity) {
    return (
      <ShopOpsChartEmptyState>
        <div>
          <strong style={{ color: "#4b5563", display: "block" }}>
            No activity for this period
          </strong>
          <span style={{ display: "block", marginTop: 4 }}>{emptyMessage}</span>
        </div>
      </ShopOpsChartEmptyState>
    );
  }

  function focusPoint(index: number) {
    setFocusedIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target) return;
    focusPoint(selectedIndex >= 0 ? selectedIndex : 0);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocusedIndex(null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex =
      focusedIndex ?? (selectedIndex >= 0 ? selectedIndex : 0);

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusPoint(currentIndex + 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusPoint(currentIndex - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusPoint(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusPoint(points.length - 1);
      return;
    }
    if (
      (event.key === "Enter" || event.key === " ") &&
      points[currentIndex]
    ) {
      event.preventDefault();
      onSelectPoint?.(points[currentIndex], currentIndex);
    }
  }

  return (
    <div
      aria-describedby={statusId}
      aria-label={`${ariaLabel} Use Left and Right Arrow keys to inspect buckets, then Enter to select.`}
      aria-roledescription="interactive mirrored sales chart"
      aria-valuemax={points.length - 1}
      aria-valuemin={0}
      aria-valuenow={accessibleIndex}
      aria-valuetext={getPointDetail(points[accessibleIndex], salesLabel)}
      className="shopops-mirror-sales-chart shopops-recharts shopops-chart-scroll"
      data-selected-key={selectedKey ?? undefined}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      role="slider"
      style={{ overflowX: "auto", position: "relative" }}
      tabIndex={0}
    >
      <div
        aria-hidden="true"
        className="shopops-mirror-sales-chart__legend"
        style={{
          alignItems: "center",
          color: "#4b5563",
          display: "flex",
          flexWrap: "wrap",
          fontSize: 12,
          fontWeight: 700,
          gap: 16,
          marginBottom: 6,
        }}
      >
        <span>
          ↑ <span style={{ color: "#2563eb" }}>{salesLabel}</span>
        </span>
        <span>
          ↓ <span style={{ color: "#0f766e" }}>Orders</span>
        </span>
      </div>
      <div
        style={{
          height: MIRROR_CHART_HEIGHT,
          minWidth: minimumChartWidth,
          width: "100%",
        }}
      >
        <ResponsiveContainer height="100%" width="100%">
          <ComposedChart
            accessibilityLayer
            barCategoryGap="32%"
            data={chartData}
            margin={SHOP_OPS_CHART_MARGIN}
            onClick={(state) => {
              const index = Number(state.activeTooltipIndex);
              const point = Number.isInteger(index) ? points[index] : null;
              if (point) onSelectPoint?.(point, index);
            }}
            style={{ cursor: onSelectPoint ? "pointer" : undefined }}
          >
            <CartesianGrid {...SHOP_OPS_GRID_PROPS} />
            <XAxis
              axisLine={{ stroke: "#9ca3af" }}
              dataKey="key"
              interval={getAxisInterval(points.length, maximumTickLabels)}
              minTickGap={14}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              tickFormatter={(key) =>
                labelsByKey.get(String(key)) ?? String(key)
              }
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={[-1, 1]}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              tickFormatter={(value: number) => {
                if (value > 0) {
                  return formatCurrencyAxis(value * maximumSales);
                }
                if (value < 0) {
                  return formatIntegerAxis(Math.abs(value) * maximumOrders);
                }
                return "0";
              }}
              tickLine={false}
              ticks={getMirrorTicks(maximumSales, maximumOrders)}
              width={68}
            />
            <Tooltip
              content={(props) => (
                <ShopOpsChartTooltip
                  {...props}
                  valueKey="upperValue"
                  valueLabel={salesLabel}
                />
              )}
              cursor={{ fill: "#eff6ff" }}
              isAnimationActive={false}
            />
            <ReferenceLine stroke="#9ca3af" strokeWidth={1.5} y={0} />
            {highlightedPoint ? (
              <ReferenceLine
                stroke="#2563eb"
                strokeDasharray="3 3"
                strokeWidth={2}
                x={highlightedPoint.key}
              />
            ) : null}
            <Bar
              dataKey="upperMirror"
              fill="#2563eb"
              isAnimationActive={false}
              name={salesLabel}
              radius={[4, 4, 0, 0]}
              stackId="mirror"
            >
              {points.map((point, index) => (
                <Cell
                  fill={
                    selectedKey === point.key
                      ? "#1d4ed8"
                      : focusedIndex === index
                        ? "#3b82f6"
                        : "#2563eb"
                  }
                  key={`sales-${point.key}`}
                />
              ))}
              {showValueLabels ? (
                <LabelList
                  dataKey="upperLabel"
                  fill="#1e3a8a"
                  fontSize={10}
                  fontWeight={700}
                  position="top"
                />
              ) : null}
            </Bar>
            <Bar
              dataKey="lowerMirror"
              fill="#0f766e"
              isAnimationActive={false}
              name="Orders"
              radius={[0, 0, 4, 4]}
              stackId="mirror"
            >
              {points.map((point, index) => (
                <Cell
                  fill={
                    selectedKey === point.key
                      ? "#0f5f59"
                      : focusedIndex === index
                        ? "#149488"
                        : "#0f766e"
                  }
                  key={`orders-${point.key}`}
                />
              ))}
              {showValueLabels ? (
                <LabelList
                  dataKey="lowerLabel"
                  fill="#115e59"
                  fontSize={10}
                  fontWeight={700}
                  position="bottom"
                />
              ) : null}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <span aria-live="polite" id={statusId} style={VISUALLY_HIDDEN_STYLE}>
        {highlightedPoint
          ? getPointDetail(highlightedPoint, salesLabel)
          : `${points.length} aligned chart buckets.`}
      </span>
    </div>
  );
}
