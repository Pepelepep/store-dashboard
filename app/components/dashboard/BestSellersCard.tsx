import {
  formatCurrency,
  formatNumber,
  getBestSellerDrilldownValue,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  BestSellerRow,
  FinancialMetricsVersion,
} from "../../lib/dashboard/dashboard-types";
import {
  SortableDataTable,
  type SortableDataTableColumn,
} from "../ui/SortableDataTable";
import { SectionCard } from "./SectionCard";

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
  const columns: SortableDataTableColumn<BestSellerRow>[] = [
    {
      key: "product",
      label: "Product",
      render: (row) => row.product,
      sortValue: (row) => row.product,
    },
    {
      key: "sku",
      label: "SKU",
      render: (row) => row.sku,
      sortValue: (row) => row.sku,
    },
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
      <SortableDataTable
        ariaLabel="Best sellers"
        columns={columns}
        defaultSort={{ key: "revenue", direction: "desc" }}
        getRowKey={(row) => getBestSellerDrilldownValue(row)}
        getRowTitle={() => "Filter sales sections by this product"}
        selectedRowKey={selectedProductKey}
        onRowClick={onSelectBestSeller}
        rows={bestSellers}
      />
    </SectionCard>
  );
}
