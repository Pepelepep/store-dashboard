import type { ReactNode } from "react";

import {
  formatCurrency,
  formatStoreDateTime,
} from "../../lib/dashboard/dashboard-metrics";
import type { RecentOrderRow } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

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

export function RecentOrderLinesCard({
  recentOrders,
}: {
  recentOrders: RecentOrderRow[];
}) {
  return (
    <SectionCard
      title="Recent order lines"
      exportConfig={{
        filename: "recent-order-lines.csv",
        headers: [
          "Order",
          "Date",
          "Product",
          "SKU",
          "Qty",
          "Revenue",
          "COGS",
          "Gross profit",
        ],
        rows: recentOrders.map((row) => [
          row.orderName,
          formatStoreDateTime(row.date),
          row.product,
          row.sku,
          row.quantity,
          row.revenue,
          row.cogs ?? "-",
          row.grossProfit ?? "-",
        ]),
      }}
    >
      <Table
        headers={[
          "Order",
          "Date",
          "Product",
          "SKU",
          "Qty",
          "Revenue",
          "COGS",
          "Gross profit",
        ]}
        rows={recentOrders.map((row) => [
          <a href={row.orderUrl} target="_blank" rel="noreferrer">
            {row.orderName}
          </a>,
          formatStoreDateTime(row.date),
          row.product,
          row.sku,
          row.quantity,
          formatCurrency(row.revenue),
          row.cogs === null ? "-" : formatCurrency(row.cogs),
          row.grossProfit === null ? "-" : formatCurrency(row.grossProfit),
        ])}
      />
    </SectionCard>
  );
}
