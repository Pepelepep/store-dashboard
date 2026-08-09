import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
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
  const numericHeaders = new Set(["Units", "Revenue", "Product sales"]);

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
          {rows.map((row) => {
            const isSelected = selectedRowKey === row.key;
            return (
              <tr
                data-selectable={onRowClick ? "true" : "false"}
                data-selected={isSelected ? "true" : "false"}
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
              >
                {row.values.map((cell, cellIndex) => (
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
  staffAttributionAvailable,
  selectedStaffKey,
  onSelectStaff,
}: {
  salesByStaff: StaffSalesRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  staffAttributionAvailable: boolean;
  selectedStaffKey?: string | null;
  onSelectStaff?: (row: StaffSalesRow) => void;
}) {
  const revenueLabel =
    financialMetricsVersion === "v2" ? "Product sales" : "Revenue";

  return (
    <SectionCard
      title={
        financialMetricsVersion === "v2"
          ? "Product sales by staff"
          : "Sales by staff"
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
      <p className="shopops-section-intro">
        Sales by Staff tracking begins after ShopOps POS attribution is
        activated.
      </p>
      {!staffAttributionAvailable ? (
        <div className="shopops-subtle-notice">
          Staff attribution is unavailable for this store. Sales remain grouped
          by location/source.
        </div>
      ) : null}
      {salesByStaff.length > 0 ? (
        <SalesTable
          headers={["Staff", "Units", revenueLabel]}
          selectedRowKey={selectedStaffKey}
          onRowClick={onSelectStaff}
          rows={salesByStaff.map((row) => ({
            key: row.staffKey,
            source: row,
            values: [
              row.staff,
              formatNumber(row.units),
              formatCurrency(row.revenue),
            ],
          }))}
        />
      ) : (
        <div className="shopops-table-empty-inline">
          No staff attribution available yet.
        </div>
      )}
    </SectionCard>
  );
}
