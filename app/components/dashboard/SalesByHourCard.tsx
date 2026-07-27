import { useState } from "react";

import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  FinancialMetricsVersion,
  SalesByHourRow,
} from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

const CHART_HEIGHT = 260;
const BAR_AREA_HEIGHT = 218;

function formatHourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function getBarTitle(row: SalesByHourRow, revenueLabel: string) {
  return [
    `Hour: ${formatHourLabel(row.hour)}`,
    `${revenueLabel}: ${formatCurrency(row.revenue)}`,
    `Orders: ${formatNumber(row.ordersCount)}`,
    `Units: ${formatNumber(row.unitsSold)}`,
    `Average order value: ${formatCurrency(row.averageOrderValue)}`,
  ].join("\n");
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
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const revenueLabel = isFinancialMetricsV2 ? "Product sales" : "Revenue";
  const maxRevenue = Math.max(
    ...salesByHour.map((row) => Math.abs(row.revenue)),
    0,
  );
  const hasSales = salesByHour.some(
    (row) => row.revenue !== 0 || row.ordersCount > 0,
  );

  return (
    <SectionCard
      title={isFinancialMetricsV2 ? "Hourly product sales" : "Sales by hour"}
      subtitle={
        isFinancialMetricsV2
          ? "Product sales include discounts and merchandise returns; order-level cash refunds are excluded. Orders appear in each hour’s details."
          : "Revenue by order hour. Orders appear in each hour’s details."
      }
    >
      {hasSales ? (
        <div style={{ overflowX: "auto" }}>
          <div
            style={{
              height: CHART_HEIGHT,
              minWidth: 720,
              position: "relative",
            }}
          >
            {[25, 50, 75].map((position) => (
              <span
                key={position}
                aria-hidden="true"
                style={{
                  borderTop: "1px solid #eef0f2",
                  left: 0,
                  position: "absolute",
                  right: 0,
                  top: `${position}%`,
                }}
              />
            ))}
            <div
              style={{
                display: "grid",
                gap: 6,
                gridTemplateColumns: "repeat(24, minmax(26px, 1fr))",
                height: "100%",
                position: "relative",
              }}
            >
              {salesByHour.map((row) => {
                const isSelected = selectedHour === row.hour;
                const isHovered = hoveredHour === row.hour;
                const barHeight =
                  maxRevenue > 0
                    ? Math.max(
                        (Math.abs(row.revenue) / maxRevenue) * BAR_AREA_HEIGHT,
                        row.revenue !== 0 ? 5 : 0,
                      )
                    : 0;

                return (
                  <div
                    key={row.hour}
                    aria-label={getBarTitle(row, revenueLabel)}
                    className="shopops-chart-interactive"
                    role={onSelectHour ? "button" : undefined}
                    tabIndex={onSelectHour ? 0 : undefined}
                    title={getBarTitle(row, revenueLabel)}
                    onClick={() => onSelectHour?.(row.hour)}
                    onKeyDown={(event) => {
                      if (!onSelectHour) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectHour(row.hour);
                      }
                    }}
                    onMouseEnter={() => setHoveredHour(row.hour)}
                    onMouseLeave={() => setHoveredHour(null)}
                    style={{
                      background: isSelected
                        ? "#eff6ff"
                        : isHovered && onSelectHour
                          ? "#f8fafc"
                          : undefined,
                      border: isSelected
                        ? "1px solid #93c5fd"
                        : "1px solid transparent",
                      borderRadius: 8,
                      cursor: onSelectHour ? "pointer" : undefined,
                      display: "grid",
                      gridTemplateRows: `${BAR_AREA_HEIGHT}px 32px`,
                      minWidth: 26,
                      padding: "4px 2px 0",
                    }}
                  >
                    <div
                      style={{
                        alignItems: "flex-end",
                        display: "flex",
                        height: BAR_AREA_HEIGHT,
                        justifyContent: "center",
                      }}
                    >
                      <div
                        style={{
                          background:
                            row.revenue < 0
                              ? "#64748b"
                              : isSelected
                                ? "#1d4ed8"
                                : "#2563eb",
                          borderRadius: "5px 5px 2px 2px",
                          height: barHeight,
                          maxWidth: 28,
                          width: "72%",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        borderTop: "1px solid #d9dee5",
                        color: "#616161",
                        fontSize: 11,
                        fontWeight: 700,
                        lineHeight: "28px",
                        textAlign: "center",
                      }}
                    >
                      {row.hour % 3 === 0 ? formatHourLabel(row.hour) : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            alignItems: "center",
            background: "#fafafa",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            color: "#707070",
            display: "flex",
            minHeight: CHART_HEIGHT,
            padding: 16,
          }}
        >
          No sales available for this period.
        </div>
      )}
    </SectionCard>
  );
}
