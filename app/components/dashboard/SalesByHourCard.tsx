import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import type { SalesByHourRow } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function formatHourLabel(hour: number) {
  return String(hour).padStart(2, "0") + ":00";
}

export function SalesByHourCard({
  salesByHour,
}: {
  salesByHour: SalesByHourRow[];
}) {
  const maxRevenue = Math.max(...salesByHour.map((row) => row.revenue), 0);
  const hasSales = maxRevenue > 0;

  return (
    <SectionCard
      title="Sales by hour"
      subtitle="Revenue grouped by order hour."
    >
      {hasSales ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(24, minmax(22px, 1fr))",
            gap: 6,
            alignItems: "end",
            minHeight: 260,
            overflowX: "auto",
            paddingTop: 12,
          }}
        >
          {salesByHour.map((row) => {
            const barHeight = maxRevenue > 0
              ? Math.max((row.revenue / maxRevenue) * 190, row.revenue > 0 ? 6 : 0)
              : 0;

            return (
              <div
                key={row.hour}
                style={{
                  display: "grid",
                  gap: 8,
                  justifyItems: "center",
                  alignItems: "end",
                }}
              >
                <div
                  title={[
                    `Hour: ${formatHourLabel(row.hour)}`,
                    `Revenue: ${formatCurrency(row.revenue)}`,
                    `Orders: ${formatNumber(row.ordersCount)}`,
                    `Units: ${formatNumber(row.unitsSold)}`,
                    `Average order value: ${formatCurrency(row.averageOrderValue)}`,
                  ].join("\n")}
                  style={{
                    width: "100%",
                    minWidth: 18,
                    height: 190,
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
                      background: row.revenue > 0 ? "#2563eb" : "#e5e7eb",
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
