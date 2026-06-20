import type { ReactNode } from "react";

import {
  formatCurrency,
  formatStoreDateTime,
  STORE_TIME_ZONE,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  FinancialMetricsVersion,
  RecentOrderRow,
} from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function Table({
  headers,
  rows,
  dateColumnMinWidth,
}: {
  headers: string[];
  rows: Array<Array<string | number | ReactNode>>;
  dateColumnMinWidth?: number;
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
                  minWidth:
                    header === "Date" && dateColumnMinWidth
                      ? dateColumnMinWidth
                      : undefined,
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
                      minWidth:
                        cellIndex === 1 && dateColumnMinWidth
                          ? dateColumnMinWidth
                          : undefined,
                      whiteSpace:
                        cellIndex === 1 && dateColumnMinWidth
                          ? "nowrap"
                          : undefined,
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

function formatRecentOrderDate(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function getChipStyles(label: string) {
  if (label === "Returned") {
    return {
      background: "#fff1f0",
      border: "1px solid #ffccc7",
      color: "#a8071a",
    };
  }

  if (label === "Refunded" || label === "Partial refund") {
    return {
      background: "#fff7e6",
      border: "1px solid #ffd591",
      color: "#ad4e00",
    };
  }

  return {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
  };
}

function Chip({ label }: { label: string }) {
  const toneStyles = getChipStyles(label);

  return (
    <span
      title="Return = merchandise returned. Refund = money returned to customer."
      style={{
        ...toneStyles,
        borderRadius: 999,
        display: "inline-block",
        fontSize: 12,
        fontWeight: 800,
        margin: "0 4px 4px 0",
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function RecentOrderLinesCard({
  recentOrders,
  financialMetricsVersion,
}: {
  recentOrders: RecentOrderRow[];
  financialMetricsVersion: FinancialMetricsVersion;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const formatDate = isFinancialMetricsV2
    ? formatRecentOrderDate
    : formatStoreDateTime;
  const exportHeaders = isFinancialMetricsV2
    ? [
        "Order",
        "Date",
        "Product",
        "SKU",
        "Qty",
        "Gross Sales",
        "Discounts",
        "Net Sales",
        "Returns",
        "Refunded Amount",
        "Returned Qty",
        "Cost at Sale",
        "COGS",
        "Gross profit",
        "Flags",
      ]
    : [
        "Order",
        "Date",
        "Product",
        "SKU",
        "Qty",
        "Revenue",
        "COGS",
        "Gross profit",
      ];
  const exportRows = recentOrders.map((row) =>
    isFinancialMetricsV2
      ? [
          row.orderName,
          formatDate(row.date),
          row.product,
          row.sku,
          row.quantity,
          row.grossSales ?? "-",
          row.discounts ?? "-",
          row.netSales ?? "-",
          row.returns ?? "-",
          row.refundedAmount ?? "-",
          row.returnedQuantity ?? "-",
          row.costAtSale ?? "-",
          row.cogs ?? "-",
          row.grossProfit ?? "-",
          row.chips?.join(", ") ?? "",
        ]
      : [
          row.orderName,
          formatDate(row.date),
          row.product,
          row.sku,
          row.quantity,
          row.revenue,
          row.cogs ?? "-",
          row.grossProfit ?? "-",
        ],
  );
  const tableHeaders = isFinancialMetricsV2
    ? [
        "Order",
        "Date",
        "Product",
        "SKU",
        "Qty",
        "Gross Sales",
        "Discounts",
        "Net Sales",
        "Returns",
        "Refunded",
        "Returned Qty",
        "Cost at Sale",
        "COGS",
        "Gross profit",
        "Flags",
      ]
    : [
        "Order",
        "Date",
        "Product",
        "SKU",
        "Qty",
        "Revenue",
        "COGS",
        "Gross profit",
      ];
  const tableRows = recentOrders.map((row) =>
    isFinancialMetricsV2
      ? [
          <a key="order" href={row.orderUrl} target="_blank" rel="noreferrer">
            {row.orderName}
          </a>,
          formatDate(row.date),
          row.product,
          row.sku,
          row.quantity,
          row.grossSales === null || row.grossSales === undefined
            ? "-"
            : formatCurrency(row.grossSales),
          row.discounts === null || row.discounts === undefined
            ? "-"
            : formatCurrency(row.discounts),
          row.netSales === null || row.netSales === undefined
            ? "-"
            : formatCurrency(row.netSales),
          row.returns === null || row.returns === undefined
            ? "-"
            : formatCurrency(row.returns),
          row.refundedAmount === null || row.refundedAmount === undefined
            ? "-"
            : formatCurrency(row.refundedAmount),
          row.returnedQuantity ?? "-",
          row.costAtSale === null || row.costAtSale === undefined
            ? "-"
            : formatCurrency(row.costAtSale),
          row.cogs === null ? "-" : formatCurrency(row.cogs),
          row.grossProfit === null ? "-" : formatCurrency(row.grossProfit),
          row.chips && row.chips.length > 0
            ? row.chips.map((chip) => <Chip key={chip} label={chip} />)
            : "-",
        ]
      : [
          <a key="order" href={row.orderUrl} target="_blank" rel="noreferrer">
            {row.orderName}
          </a>,
          formatDate(row.date),
          row.product,
          row.sku,
          row.quantity,
          formatCurrency(row.revenue),
          row.cogs === null ? "-" : formatCurrency(row.cogs),
          row.grossProfit === null ? "-" : formatCurrency(row.grossProfit),
        ],
  );

  return (
    <SectionCard
      title="Recent order lines"
      subtitle={
        isFinancialMetricsV2
          ? "Return = merchandise returned. Refund = money returned to customer."
          : undefined
      }
      exportConfig={{
        filename: "recent-order-lines.csv",
        headers: exportHeaders,
        rows: exportRows,
      }}
    >
      <Table
        headers={tableHeaders}
        rows={tableRows}
        dateColumnMinWidth={isFinancialMetricsV2 ? 138 : undefined}
      />
    </SectionCard>
  );
}
