import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import type { SalesByHourRow } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function formatHourLabel(hour: number) {
  return String(hour).padStart(2, "0") + ":00";
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

function HourBarChart({
  title,
  subtitle,
  rows,
  valueType,
  maxHeight,
}: {
  title: string;
  subtitle: string;
  rows: SalesByHourRow[];
  valueType: "revenue" | "orders";
  maxHeight: number;
}) {
  const maxValue = Math.max(
    ...rows.map((row) =>
      valueType === "revenue" ? row.revenue : row.ordersCount,
    ),
    0,
  );

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{title}</h3>
        <p
          style={{
            margin: "4px 0 0",
            color: "#616161",
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {subtitle}
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(24, minmax(24px, 1fr))",
          gap: 6,
          alignItems: "end",
          overflowX: "auto",
          paddingTop: 6,
        }}
      >
        {rows.map((row) => {
          const value = valueType === "revenue" ? row.revenue : row.ordersCount;
          const barHeight =
            maxValue > 0
              ? Math.max((value / maxValue) * maxHeight, value > 0 ? 6 : 0)
              : 0;
          const label =
            valueType === "revenue" ? formatCurrency(value) : formatNumber(value);

          return (
            <div
              key={`${valueType}-${row.hour}`}
              style={{
                display: "grid",
                gap: 6,
                justifyItems: "center",
                alignItems: "end",
                minWidth: 24,
              }}
            >
              <div
                style={{
                  minHeight: 18,
                  color: "#374151",
                  fontSize: valueType === "revenue" ? 10 : 11,
                  fontWeight: 800,
                  lineHeight: 1,
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  transform:
                    valueType === "revenue" && value > 0
                      ? "rotate(-35deg)"
                      : undefined,
                  transformOrigin: "center",
                }}
              >
                {value > 0 ? label : ""}
              </div>

              <div
                title={getBarTitle(row)}
                style={{
                  width: "100%",
                  minWidth: 18,
                  height: maxHeight,
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: 28,
                    height: barHeight,
                    borderRadius: "6px 6px 2px 2px",
                    background: value > 0 ? "#2563eb" : "#e5e7eb",
                    transition: "height 120ms ease",
                  }}
                />
              </div>

              <div
                style={{
                  color: "#616161",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {row.hour}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SalesByHourCard({
  salesByHour,
}: {
  salesByHour: SalesByHourRow[];
}) {
  const hasSales = salesByHour.some(
    (row) => row.revenue > 0 || row.ordersCount > 0,
  );

  return (
    <SectionCard title="Sales by hour">
      {hasSales ? (
        <div style={{ display: "grid", gap: 28 }}>
          <HourBarChart
            title="Revenue by hour"
            subtitle="Revenue grouped by order hour."
            rows={salesByHour}
            valueType="revenue"
            maxHeight={190}
          />

          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 22 }}>
            <HourBarChart
              title="Orders by hour"
              subtitle="Order count grouped by order hour."
              rows={salesByHour}
              valueType="orders"
              maxHeight={120}
            />
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
