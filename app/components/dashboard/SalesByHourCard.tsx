import { useState } from "react";

import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import type { SalesByHourRow } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function formatHourLabel(hour: number) {
  return String(hour).padStart(2, "0") + ":00";
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function getBarTitle(row: SalesByHourRow) {
  return [
    `Hour: ${formatHourLabel(row.hour)}`,
    `Revenue: ${formatCurrency(row.revenue)}`,
    `Orders: ${formatNumber(row.ordersCount)}`,
    `Units: ${formatNumber(row.unitsSold)}`,
    `Average order value: ${formatCurrency(row.averageOrderValue)}`,
  ].join("\n");
}

function LegendItem({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "#616161",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
        }}
      />
      {label}
    </span>
  );
}

export function SalesByHourCard({
  salesByHour,
  selectedHour,
  onSelectHour,
}: {
  salesByHour: SalesByHourRow[];
  selectedHour?: number | null;
  onSelectHour?: (hour: number) => void;
}) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const maxRevenue = Math.max(...salesByHour.map((row) => row.revenue), 0);
  const maxOrders = Math.max(...salesByHour.map((row) => row.ordersCount), 0);
  const hasSales = salesByHour.some(
    (row) => row.revenue > 0 || row.ordersCount > 0,
  );
  const revenueMaxHeight = 170;
  const ordersMaxHeight = 96;

  return (
    <SectionCard
      title="Sales by hour"
      subtitle="Revenue and order count grouped by order hour."
    >
      {hasSales ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <LegendItem color="#2563eb" label="Revenue" />
            <LegendItem color="#14b8a6" label="Orders" />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(24, minmax(26px, 1fr))",
              gap: 6,
              overflowX: "auto",
              paddingTop: 6,
            }}
          >
            {salesByHour.map((row) => {
              const isSelected = selectedHour === row.hour;
              const isHovered = hoveredHour === row.hour;
              const revenueHeight =
                maxRevenue > 0
                  ? Math.max(
                      (row.revenue / maxRevenue) * revenueMaxHeight,
                      row.revenue > 0 ? 6 : 0,
                    )
                  : 0;
              const ordersHeight =
                maxOrders > 0
                  ? Math.max(
                      (row.ordersCount / maxOrders) * ordersMaxHeight,
                      row.ordersCount > 0 ? 6 : 0,
                    )
                  : 0;

              return (
                <div
                  key={row.hour}
                  title={getBarTitle(row)}
                  role={onSelectHour ? "button" : undefined}
                  tabIndex={onSelectHour ? 0 : undefined}
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
                    display: "grid",
                    gridTemplateRows: "22px 170px 24px 96px 18px",
                    justifyItems: "center",
                    minWidth: 26,
                    borderRadius: 8,
                    cursor: onSelectHour ? "pointer" : undefined,
                    outline: isSelected ? "2px solid #2563eb" : undefined,
                    outlineOffset: 2,
                    background: isSelected
                      ? "#eff6ff"
                      : isHovered && onSelectHour
                        ? "#fafafa"
                        : undefined,
                    transition:
                      "background-color 120ms ease, outline-color 120ms ease",
                  }}
                >
                  <div
                    style={{
                      color: "#374151",
                      fontSize: 10,
                      fontWeight: 800,
                      lineHeight: 1,
                      textAlign: "center",
                      whiteSpace: "nowrap",
                      transform: row.revenue > 0 ? "rotate(-35deg)" : undefined,
                      transformOrigin: "center",
                    }}
                  >
                    {row.revenue > 0 ? formatCompactCurrency(row.revenue) : ""}
                  </div>

                  <div
                    style={{
                      width: "100%",
                      height: revenueMaxHeight,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 28,
                        height: revenueHeight,
                        borderRadius: "6px 6px 2px 2px",
                        background:
                          row.revenue > 0
                            ? isSelected
                              ? "#1d4ed8"
                              : "#2563eb"
                            : "#e5e7eb",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      width: "100%",
                      borderTop: "1px solid #d1d5db",
                      color: "#616161",
                      fontSize: 11,
                      fontWeight: 800,
                      lineHeight: "23px",
                      textAlign: "center",
                    }}
                  >
                    {row.hour}
                  </div>

                  <div
                    style={{
                      width: "100%",
                      height: ordersMaxHeight,
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 28,
                        height: ordersHeight,
                        borderRadius: "2px 2px 6px 6px",
                        background:
                          row.ordersCount > 0
                            ? isSelected
                              ? "#0f766e"
                              : "#14b8a6"
                            : "#e5e7eb",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      color: "#374151",
                      fontSize: 11,
                      fontWeight: 800,
                      lineHeight: 1,
                      textAlign: "center",
                    }}
                  >
                    {row.ordersCount > 0 ? formatNumber(row.ordersCount) : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #f0f0f0",
            borderRadius: 12,
            color: "#707070",
            padding: 16,
          }}
        >
          No sales available for this period.
        </div>
      )}
    </SectionCard>
  );
}
