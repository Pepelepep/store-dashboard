import { useId, useMemo, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceArea,
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
  formatNonZeroCurrencyLabel,
  formatNonZeroIntegerLabel,
  hasMirrorChartActivity,
  SHOP_OPS_GRID_PROPS,
  ShopOpsChartEmptyState,
  ShopOpsChartTooltip,
} from "./ShopOpsChart";

export type MirrorSalesChartPoint = {
  key: string;
  axisLabel: string;
  tooltipLabel: string;
  sales: number;
  comparisonSales?: number;
  orders: number;
  unitsSold: number;
};

const SALES_CHART_HEIGHT = 228;
const ORDERS_CHART_HEIGHT = 100;
const X_AXIS_HEIGHT = 24;
const Y_AXIS_WIDTH = 68;
const CHART_MARGIN_LEFT = 4;
const CHART_MARGIN_RIGHT = 16;
const MAX_CHART_WIDTH = 2400;

const SALES_CHART_MARGIN = {
  top: 18,
  right: CHART_MARGIN_RIGHT,
  bottom: 0,
  left: CHART_MARGIN_LEFT,
} as const;

const ORDERS_CHART_MARGIN = {
  top: 0,
  right: CHART_MARGIN_RIGHT,
  bottom: 0,
  left: CHART_MARGIN_LEFT,
} as const;

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

function getPointDetail(
  point: MirrorSalesChartPoint,
  salesLabel: string,
  comparisonLabel?: string,
) {
  const details = [
    point.tooltipLabel,
    `${salesLabel}: ${formatCurrency(point.sales)}`,
    `Orders: ${formatNumber(point.orders)}`,
    `Units sold: ${formatNumber(point.unitsSold)}`,
  ];

  if (comparisonLabel && point.comparisonSales !== undefined) {
    details.splice(
      2,
      0,
      `${comparisonLabel}: ${formatCurrency(point.comparisonSales)}`,
    );
  }

  return details.join(". ");
}

function getActiveIndex(value: unknown, pointCount: number) {
  const index = Number(value);

  return Number.isInteger(index) && index >= 0 && index < pointCount
    ? index
    : null;
}

export function MirrorSalesChart({
  points,
  salesLabel,
  tooltipBucketLabel,
  ariaLabel,
  emptyMessage,
  selectedKey,
  onSelectPoint,
  labelMode = "none",
  maximumTickLabels = 8,
  minimumWidth = 640,
  minimumBucketWidth = 24,
  comparisonLabel,
}: {
  points: MirrorSalesChartPoint[];
  salesLabel: string;
  tooltipBucketLabel: "Hour" | "Period";
  ariaLabel: string;
  emptyMessage: string;
  selectedKey?: string | null;
  onSelectPoint?: (point: MirrorSalesChartPoint, index: number) => void;
  labelMode?: "always" | "density-aware" | "none";
  maximumTickLabels?: number;
  minimumWidth?: number;
  minimumBucketWidth?: number;
  comparisonLabel?: string;
}) {
  const componentId = useId();
  const statusId = `${componentId}-status`;
  const syncId = `${componentId}-mirror-sync`;
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const labelsByKey = useMemo(
    () => new Map(points.map((point) => [point.key, point.axisLabel])),
    [points],
  );
  const hasActivity = hasMirrorChartActivity(points);
  const hasComparison =
    Boolean(comparisonLabel) &&
    points.some((point) => point.comparisonSales !== undefined);
  const selectedIndex = selectedKey
    ? points.findIndex((point) => point.key === selectedKey)
    : -1;
  const transientIndex = focusedIndex ?? hoveredIndex;
  const selectedPoint = selectedIndex >= 0 ? points[selectedIndex] : null;
  const transientPoint =
    transientIndex === null ? null : points[transientIndex];
  const accessibleIndex =
    transientIndex ?? (selectedIndex >= 0 ? selectedIndex : 0);
  const accessiblePoint = points[accessibleIndex];
  const showAllNonZeroLabels =
    labelMode === "always" ||
    (labelMode === "density-aware" && points.length <= 12);
  const showLabelForIndex = (index: number) =>
    showAllNonZeroLabels ||
    (labelMode === "density-aware" &&
      points.length > 12 &&
      (index === hoveredIndex ||
        index === focusedIndex ||
        index === selectedIndex));
  const renderValueLabels = labelMode !== "none";
  const chartData = points.map((point, index) => ({
    ...point,
    salesLabel:
      showLabelForIndex(index) && point.sales !== 0
        ? formatNonZeroCurrencyLabel(point.sales)
        : "",
    ordersLabel:
      showLabelForIndex(index) && point.orders !== 0
        ? formatNonZeroIntegerLabel(point.orders)
        : "",
  }));
  const minimumChartWidth = Math.max(
    minimumWidth,
    Math.min(Math.max(points.length, 1) * minimumBucketWidth, MAX_CHART_WIDTH),
  );
  const salesAxisMaximum = Math.max(
    1,
    points.reduce(
      (maximum, point) =>
        Math.max(maximum, point.sales, point.comparisonSales ?? 0),
      0,
    ) * 1.15,
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
    if ((event.key === "Enter" || event.key === " ") && points[currentIndex]) {
      event.preventDefault();
      onSelectPoint?.(points[currentIndex], currentIndex);
    }
  }

  function selectActivePoint(activeTooltipIndex: unknown) {
    const index = getActiveIndex(activeTooltipIndex, points.length);
    if (index !== null) onSelectPoint?.(points[index], index);
  }

  return (
    <div
      aria-describedby={statusId}
      aria-label={`${ariaLabel} Use Left and Right Arrow keys to inspect buckets, then Enter to select.`}
      aria-roledescription="interactive mirrored sales chart"
      aria-valuemax={points.length - 1}
      aria-valuemin={0}
      aria-valuenow={accessibleIndex}
      aria-valuetext={getPointDetail(
        accessiblePoint,
        salesLabel,
        comparisonLabel,
      )}
      className="shopops-mirror-sales-chart shopops-recharts shopops-chart-scroll"
      data-label-mode={labelMode}
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
        {hasComparison ? (
          <span>
            <span style={{ color: "#94a3b8" }}>■</span> {comparisonLabel}
          </span>
        ) : null}
        <span>
          ↓ <span style={{ color: "#0f766e" }}>Orders</span>
        </span>
      </div>
      <div
        className="shopops-mirror-sales-chart__canvas"
        style={{
          minWidth: minimumChartWidth,
          position: "relative",
          width: "100%",
        }}
      >
        <div
          className="shopops-mirror-sales-chart__sales"
          style={{
            height: SALES_CHART_HEIGHT,
            position: "relative",
            zIndex: 1,
          }}
        >
          <ResponsiveContainer height="100%" width="100%">
            <BarChart
              accessibilityLayer={false}
              barCategoryGap="34%"
              data={chartData}
              margin={SALES_CHART_MARGIN}
              onClick={(state) => selectActivePoint(state.activeTooltipIndex)}
              onMouseLeave={() => setHoveredIndex(null)}
              onMouseMove={(state) =>
                setHoveredIndex(
                  getActiveIndex(state.activeTooltipIndex, points.length),
                )
              }
              style={{ cursor: onSelectPoint ? "pointer" : undefined }}
              syncId={syncId}
              syncMethod="index"
            >
              <CartesianGrid
                {...SHOP_OPS_GRID_PROPS}
                horizontalValues={[salesAxisMaximum / 2, salesAxisMaximum]}
              />
              <XAxis dataKey="key" height={0} hide />
              <YAxis
                axisLine={false}
                domain={[0, salesAxisMaximum]}
                tick={{ fill: "#6b7280", fontSize: 11 }}
                tickFormatter={formatCurrencyAxis}
                tickLine={false}
                ticks={[0, salesAxisMaximum / 2, salesAxisMaximum]}
                width={Y_AXIS_WIDTH}
              />
              <Tooltip
                content={(props) => (
                  <ShopOpsChartTooltip
                    {...props}
                    comparisonLabel={comparisonLabel}
                    labelLabel={tooltipBucketLabel}
                    valueKey="sales"
                    valueLabel={salesLabel}
                  />
                )}
                cursor={false}
                isAnimationActive={false}
              />
              {transientPoint && transientPoint.key !== selectedPoint?.key ? (
                <ReferenceArea
                  fill="rgba(15, 118, 110, 0.06)"
                  stroke="none"
                  x1={transientPoint.key}
                  x2={transientPoint.key}
                />
              ) : null}
              {selectedPoint ? (
                <ReferenceArea
                  fill="rgba(37, 99, 235, 0.08)"
                  stroke="rgba(37, 99, 235, 0.35)"
                  strokeWidth={1}
                  x1={selectedPoint.key}
                  x2={selectedPoint.key}
                />
              ) : null}
              {hasComparison ? (
                <Bar
                  dataKey="comparisonSales"
                  fill="#cbd5e1"
                  isAnimationActive={false}
                  name={comparisonLabel}
                  radius={[4, 4, 0, 0]}
                />
              ) : null}
              <Bar
                dataKey="sales"
                fill="#2563eb"
                isAnimationActive={false}
                name={salesLabel}
                radius={[4, 4, 0, 0]}
              >
                {points.map((point, index) => (
                  <Cell
                    fill={
                      selectedIndex === index
                        ? "#1d4ed8"
                        : transientIndex === index
                          ? "#3b82f6"
                          : "#2563eb"
                    }
                    key={`sales-${point.key}`}
                  />
                ))}
                {renderValueLabels ? (
                  <LabelList
                    dataKey="salesLabel"
                    fill="#1e3a8a"
                    fontSize={10}
                    fontWeight={700}
                    offset={6}
                    position="top"
                  />
                ) : null}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div
          aria-hidden="true"
          className="shopops-mirror-sales-chart__baseline"
          style={{
            background: "#d1d5db",
            height: 1,
            left: Y_AXIS_WIDTH + CHART_MARGIN_LEFT,
            pointerEvents: "none",
            position: "absolute",
            right: CHART_MARGIN_RIGHT,
            top: SALES_CHART_HEIGHT,
            zIndex: 2,
          }}
        />
        <div
          className="shopops-mirror-sales-chart__orders"
          style={{
            height: ORDERS_CHART_HEIGHT,
            position: "relative",
            zIndex: 1,
          }}
        >
          <ResponsiveContainer height="100%" width="100%">
            <BarChart
              accessibilityLayer={false}
              barCategoryGap="34%"
              data={chartData}
              margin={ORDERS_CHART_MARGIN}
              onClick={(state) => selectActivePoint(state.activeTooltipIndex)}
              onMouseLeave={() => setHoveredIndex(null)}
              onMouseMove={(state) =>
                setHoveredIndex(
                  getActiveIndex(state.activeTooltipIndex, points.length),
                )
              }
              style={{ cursor: onSelectPoint ? "pointer" : undefined }}
              syncId={syncId}
              syncMethod="index"
            >
              <XAxis
                axisLine={false}
                dataKey="key"
                height={X_AXIS_HEIGHT}
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
                domain={[
                  0,
                  (dataMaximum: number) =>
                    Math.max(1, Math.ceil(dataMaximum * 1.2)),
                ]}
                reversed
                tick={false}
                tickLine={false}
                width={Y_AXIS_WIDTH}
              />
              <Tooltip
                content={() => null}
                cursor={false}
                isAnimationActive={false}
              />
              {transientPoint && transientPoint.key !== selectedPoint?.key ? (
                <ReferenceArea
                  fill="rgba(15, 118, 110, 0.06)"
                  stroke="none"
                  x1={transientPoint.key}
                  x2={transientPoint.key}
                />
              ) : null}
              {selectedPoint ? (
                <ReferenceArea
                  fill="rgba(37, 99, 235, 0.08)"
                  stroke="rgba(37, 99, 235, 0.35)"
                  strokeWidth={1}
                  x1={selectedPoint.key}
                  x2={selectedPoint.key}
                />
              ) : null}
              <Bar
                dataKey="orders"
                fill="#0f766e"
                isAnimationActive={false}
                name="Orders"
                radius={[4, 4, 0, 0]}
              >
                {points.map((point, index) => (
                  <Cell
                    fill={
                      selectedIndex === index
                        ? "#0f5f59"
                        : transientIndex === index
                          ? "#149488"
                          : "#0f766e"
                    }
                    key={`orders-${point.key}`}
                  />
                ))}
                {renderValueLabels ? (
                  <LabelList
                    dataKey="ordersLabel"
                    fill="#115e59"
                    fontSize={10}
                    fontWeight={700}
                    offset={6}
                    position="top"
                  />
                ) : null}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <span aria-live="polite" id={statusId} style={VISUALLY_HIDDEN_STYLE}>
        {getPointDetail(accessiblePoint, salesLabel)}
      </span>
    </div>
  );
}
