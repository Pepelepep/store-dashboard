import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
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
          {rows.length > 0 ? (
            rows.map((row) => {
              const isSelected = selectedRowKey === row.key;
              return (
                <tr
                  data-selectable={onRowClick ? "true" : "false"}
                  data-selected={isSelected ? "true" : "false"}
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
                >
                  {row.values.map((cell, cellIndex) => (
                    <td
                      data-align={
                        numericHeaders.has(headers[cellIndex])
                          ? "right"
                          : "left"
                      }
                      key={cellIndex}
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
    financialMetricsVersion === "v2" ? "Product sales" : "Revenue";

  return (
    <SectionCard
      title={
        financialMetricsVersion === "v2"
          ? "Product sales by vendor"
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
          values: [
            row.vendor,
            formatNumber(row.units),
            formatCurrency(row.revenue),
          ],
        }))}
      />
    </SectionCard>
  );
}
