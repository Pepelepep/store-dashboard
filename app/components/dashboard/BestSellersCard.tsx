import { formatCurrency } from "../../lib/dashboard/dashboard-metrics";
import type { BestSellerRow } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
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

export function BestSellersCard({
  bestSellers,
}: {
  bestSellers: BestSellerRow[];
}) {
  return (
    <SectionCard
      title="Best sellers"
      exportConfig={{
        filename: "best-sellers.csv",
        headers: ["Product", "SKU", "Vendor", "Units", "Revenue"],
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
        headers={["Product", "SKU", "Vendor", "Units", "Revenue"]}
        rows={bestSellers.map((row) => [
          row.product,
          row.sku,
          row.vendor,
          row.units,
          formatCurrency(row.revenue),
        ])}
      />
    </SectionCard>
  );
}
