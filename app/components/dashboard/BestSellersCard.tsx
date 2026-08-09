import {
  formatCurrency,
  formatNumber,
  getBestSellerDrilldownValue,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  BestSellerRow,
  FinancialMetricsVersion,
} from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function Table({
  headers,
  rows,
  selectedRowKey,
  onRowClick,
}: {
  headers: string[];
  rows: Array<{
    key: string;
    values: Array<string | number>;
    source: BestSellerRow;
  }>;
  selectedRowKey?: string | null;
  onRowClick?: (row: BestSellerRow) => void;
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
                  title="Filter sales sections by this product"
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

export function BestSellersCard({
  bestSellers,
  financialMetricsVersion,
  selectedProductKey,
  onSelectBestSeller,
}: {
  bestSellers: BestSellerRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  selectedProductKey?: string | null;
  onSelectBestSeller?: (row: BestSellerRow) => void;
}) {
  const revenueLabel =
    financialMetricsVersion === "v2" ? "Product sales" : "Revenue";

  return (
    <SectionCard
      title="Best sellers"
      exportConfig={{
        filename: "best-sellers.csv",
        headers: ["Product", "SKU", "Vendor", "Units", revenueLabel],
        rows: bestSellers.map((row) => [
          row.product,
          row.sku,
          row.vendor,
          row.units,
          row.revenue,
        ]),
      }}
    >
      <Table
        headers={["Product", "SKU", "Vendor", "Units", revenueLabel]}
        selectedRowKey={selectedProductKey}
        onRowClick={onSelectBestSeller}
        rows={bestSellers.map((row) => ({
          key: getBestSellerDrilldownValue(row),
          source: row,
          values: [
            row.product,
            row.sku,
            row.vendor,
            formatNumber(row.units),
            formatCurrency(row.revenue),
          ],
        }))}
      />
    </SectionCard>
  );
}
