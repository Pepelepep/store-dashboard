import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  FinancialMetricsVersion,
  StaffSalesRow,
} from "../../lib/dashboard/dashboard-types";
import {
  SortableDataTable,
  type SortableDataTableColumn,
} from "../ui/SortableDataTable";
import { SectionCard } from "./SectionCard";

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
  const columns: SortableDataTableColumn<StaffSalesRow>[] = [
    {
      key: "staff",
      label: "Staff",
      render: (row) => row.staff,
      sortValue: (row) => row.staff,
    },
    {
      align: "right",
      key: "units",
      label: "Units",
      render: (row) => formatNumber(row.units),
      sortValue: (row) => row.units,
    },
    {
      align: "right",
      key: "revenue",
      label: revenueLabel,
      render: (row) => formatCurrency(row.revenue),
      sortValue: (row) => row.revenue,
    },
  ];

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
        <SortableDataTable
          ariaLabel="Product sales by staff"
          columns={columns}
          defaultSort={{ key: "revenue", direction: "desc" }}
          getRowKey={(row) => row.staffKey}
          getRowTitle={() => "Filter sales sections by this staff member"}
          selectedRowKey={selectedStaffKey}
          onRowClick={onSelectStaff}
          rows={salesByStaff}
        />
      ) : (
        <div className="shopops-table-empty-inline">
          No staff attribution available yet.
        </div>
      )}
    </SectionCard>
  );
}
