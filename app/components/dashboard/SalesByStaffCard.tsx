import { formatCurrency } from "../../lib/dashboard/dashboard-metrics";
import type { StaffSalesRow } from "../../lib/dashboard/dashboard-types";
import { SectionCard } from "./SectionCard";

function SalesTable({
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
          {rows.map((row, index) => (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalesByStaffCard({
  salesByStaff,
}: {
  salesByStaff: StaffSalesRow[];
}) {
  return (
    <SectionCard
      title="Sales by Staff"
      exportConfig={
        salesByStaff.length > 0
          ? {
              filename: "sales-by-staff.csv",
              headers: ["Staff", "Units", "Revenue"],
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
          headers={["Staff", "Units", "Revenue"]}
          rows={salesByStaff.map((row) => [
            row.staff,
            row.units,
            formatCurrency(row.revenue),
          ])}
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
