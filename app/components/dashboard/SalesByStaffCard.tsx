import { useState } from "react";

import { formatCurrency } from "../../lib/dashboard/dashboard-metrics";
import type {
  FinancialMetricsVersion,
  StaffSalesRow,
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
    source: StaffSalesRow;
  }>;
  selectedRowKey?: string | null;
  onRowClick?: (row: StaffSalesRow) => void;
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
          {rows.map((row) => {
            const isSelected = selectedRowKey === row.key;
            const isHovered = hoveredRowKey === row.key;

            return (
              <tr
                key={row.key}
                title="Filter sales sections by this staff member"
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
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SalesByStaffCard({
  salesByStaff,
  financialMetricsVersion,
  selectedStaffKey,
  onSelectStaff,
}: {
  salesByStaff: StaffSalesRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  selectedStaffKey?: string | null;
  onSelectStaff?: (row: StaffSalesRow) => void;
}) {
  const revenueLabel =
    financialMetricsVersion === "v2" ? "Net Sales" : "Revenue";

  return (
    <SectionCard
      title={
        financialMetricsVersion === "v2"
          ? "Net Sales by Staff"
          : "Sales by Staff"
      }
      exportConfig={
        salesByStaff.length > 0
          ? {
              filename: "sales-by-staff.csv",
              headers: ["Staff", "Units", revenueLabel],
              rows: salesByStaff.map((row) => [
                row.staff,
                row.units,
                row.revenue,
              ]),
            }
          : undefined
      }
    >
      {salesByStaff.length > 0 ? (
        <SalesTable
          headers={["Staff", "Units", revenueLabel]}
          selectedRowKey={selectedStaffKey}
          onRowClick={onSelectStaff}
          rows={salesByStaff.map((row) => ({
            key: row.staffKey,
            source: row,
            values: [row.staff, row.units, formatCurrency(row.revenue)],
          }))}
        />
      ) : (
        <div
          style={{
            border: "1px solid #f0f0f0",
            borderRadius: 12,
            color: "#707070",
            padding: 16,
          }}
        >
          No staff attribution available yet.
        </div>
      )}
    </SectionCard>
  );
}
