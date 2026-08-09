import type { ReactNode } from "react";

import {
  formatDecimal,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
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
  const numericHeaders = new Set(["Available", "Sold", "Days left"]);

  return (
    <div className="shopops-data-table-scroll">
      <table className="shopops-data-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                data-align={numericHeaders.has(header) ? "right" : "left"}
                key={header}
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
                    data-align={
                      numericHeaders.has(headers[cellIndex]) ? "right" : "left"
                    }
                    key={cellIndex}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                className="shopops-data-table__empty"
                colSpan={headers.length}
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
          formatNumber(row.available),
          formatNumber(row.unitsSold),
          row.daysLeft === null ? "-" : formatDecimal(row.daysLeft),
          <StatusBadge key={`${row.sku}-${row.status}`} status={row.status} />,
        ])}
      />
    </SectionCard>
  );
}
