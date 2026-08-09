import {
  formatCurrency,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  FinancialMetricsVersion,
  VendorRow,
} from "../../lib/dashboard/dashboard-types";
import {
  SortableDataTable,
  type SortableDataTableColumn,
} from "../ui/SortableDataTable";
import { SectionCard } from "./SectionCard";

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
  const columns: SortableDataTableColumn<VendorRow>[] = [
    {
      key: "vendor",
      label: "Vendor",
      render: (row) => row.vendor,
      sortValue: (row) => row.vendor,
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
          ? "Product sales by vendor"
          : "Sales by vendor"
      }
      exportConfig={{
        filename: "sales-by-vendor.csv",
        headers: ["Vendor", "Units", revenueLabel],
        rows: salesByVendor.map((row) => [row.vendor, row.units, row.revenue]),
      }}
    >
      <SortableDataTable
        ariaLabel="Product sales by vendor"
        columns={columns}
        defaultSort={{ key: "revenue", direction: "desc" }}
        getRowKey={(row) => row.vendor}
        getRowTitle={() => "Filter sales sections by this vendor"}
        selectedRowKey={selectedVendorKey}
        onRowClick={onSelectVendor}
        rows={salesByVendor}
      />
    </SectionCard>
  );
}
