import { useState } from "react";

import { formatCurrency } from "../../lib/dashboard/dashboard-metrics";
import type {
  FinancialMetricsVersion,
  VendorRow,
} from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function SalesTable({
  headers,
  rows,
  selectedRowKey,
  onRowClick,
}: {
  headers: string[];
  rows: Array<{
    key: string;
    values: Array<string | number>;
    source: VendorRow;
  }>;
  selectedRowKey?: string | null;
  onRowClick?: (row: VendorRow) => void;
}) {
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);

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
            rows.map((row) => {
              const isSelected = selectedRowKey === row.key;
              const isHovered = hoveredRowKey === row.key;

              return (
                <tr
                  key={row.key}
                  title="Filter sales sections by this vendor"
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={() => onRowClick?.(row.source)}
                  onKeyDown={(event) => {
                    if (!onRowClick) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row.source);
                    }
                  }}
                  onMouseEnter={() => setHoveredRowKey(row.key)}
                  onMouseLeave={() => setHoveredRowKey(null)}
                  style={{
                    background: isSelected
                      ? "#eff6ff"
                      : isHovered && onRowClick
                        ? "#fafafa"
                        : undefined,
                    cursor: onRowClick ? "pointer" : undefined,
                  }}
                >
                  {row.values.map((cell, cellIndex) => (
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
              );
            })
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

export function SalesByVendorCard({
  salesByVendor,
  financialMetricsVersion,
  selectedVendorKey,
  onSelectVendor,
}: {
  salesByVendor: VendorRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  selectedVendorKey?: string | null;
  onSelectVendor?: (row: VendorRow) => void;
}) {
  const revenueLabel =
    financialMetricsVersion === "v2" ? "Net Sales" : "Revenue";

  return (
    <SectionCard
      title={
        financialMetricsVersion === "v2"
          ? "Net Sales by Vendor"
          : "Sales by vendor"
      }
      exportConfig={{
        filename: "sales-by-vendor.csv",
        headers: ["Vendor", "Units", revenueLabel],
        rows: salesByVendor.map((row) => [row.vendor, row.units, row.revenue]),
      }}
    >
      <SalesTable
        headers={["Vendor", "Units", revenueLabel]}
        selectedRowKey={selectedVendorKey}
        onRowClick={onSelectVendor}
        rows={salesByVendor.map((row) => ({
          key: row.vendor,
          source: row,
          values: [row.vendor, row.units, formatCurrency(row.revenue)],
        }))}
      />
    </SectionCard>
  );
}
