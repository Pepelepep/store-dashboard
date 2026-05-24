import type { ReactNode } from "react";

import type { StockAlertRow } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function StatusBadge({ status }: { status: StockAlertRow["status"] }) {
  const isCritical = status === "Critical";
  const isWarning = status === "Warning";

  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        background: isCritical ? "#fde8e8" : isWarning ? "#fff4d6" : "#e8f5e9",
        color: isCritical ? "#8a1f11" : isWarning ? "#7a4b00" : "#1f6f3d",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number | ReactNode>>;
}) {
  return (
    <div
      style={{
        overflowX: "auto",
        overflowY: "auto",
        maxHeight: 320,
        border: "1px solid #f0f0f0",
        borderRadius: 12,
      }}
    >
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
      >
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                style={{
                  textAlign: "left",
                  padding: "12px 10px",
                  borderBottom: "1px solid #dcdcdc",
                  color: "#616161",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  position: "sticky",
                  top: 0,
                  background: "white",
                  zIndex: 1,
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{
                      padding: "12px 10px",
                      borderBottom: "1px solid #f0f0f0",
                      verticalAlign: "top",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={headers.length}
                style={{ padding: 16, color: "#707070" }}
              >
                No data for this selection.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function StockAlertsCard({
  stockAlerts,
}: {
  stockAlerts: StockAlertRow[];
}) {
  return (
    <SectionCard
      title="Soon out of stock"
      subtitle="Days left = available stock / average daily units sold on selected range."
      exportConfig={{
        filename: "soon-out-of-stock.csv",
        headers: ["Product", "SKU", "Available", "Sold", "Days left", "Status"],
        rows: stockAlerts.map((row) => [
          row.product,
          row.sku,
          row.available,
          row.unitsSold,
          row.daysLeft === null ? "-" : row.daysLeft.toFixed(1),
          row.status,
        ]),
      }}
    >
      <Table
        headers={["Product", "SKU", "Available", "Sold", "Days left", "Status"]}
        rows={stockAlerts.map((row) => [
          row.product,
          row.sku,
          row.available,
          row.unitsSold,
          row.daysLeft === null ? "-" : row.daysLeft.toFixed(1),
          <StatusBadge key={`${row.sku}-${row.status}`} status={row.status} />,
        ])}
      />
    </SectionCard>
  );
}
