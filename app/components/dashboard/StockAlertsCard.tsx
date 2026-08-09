import {
  formatDecimal,
  formatNumber,
} from "../../lib/dashboard/dashboard-metrics";
import type { StockAlertRow } from "../../lib/dashboard/dashboard-types";
import {
  SortableDataTable,
  type SortableDataTableColumn,
} from "../ui/SortableDataTable";
import { SectionCard } from "./SectionCard";

function StatusBadge({ status }: { status: StockAlertRow["status"] }) {
  const isCritical = status === "Critical";
  const isWarning = status === "Warning";

  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        background: isCritical ? "#fde8e8" : isWarning ? "#fff4d6" : "#e8f5e9",
        color: isCritical ? "#8a1f11" : isWarning ? "#7a4b00" : "#1f6f3d",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

export function StockAlertsCard({
  stockAlerts,
}: {
  stockAlerts: StockAlertRow[];
}) {
  const columns: SortableDataTableColumn<StockAlertRow>[] = [
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
      align: "right",
      key: "available",
      label: "Available",
      render: (row) => formatNumber(row.available),
      sortValue: (row) => row.available,
    },
    {
      align: "right",
      key: "sold",
      label: "Sold",
      render: (row) => formatNumber(row.unitsSold),
      sortValue: (row) => row.unitsSold,
    },
    {
      align: "right",
      key: "daysLeft",
      label: "Days left",
      render: (row) =>
        row.daysLeft === null ? "-" : formatDecimal(row.daysLeft),
      sortValue: (row) => row.daysLeft,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
      sortValue: (row) => row.status,
    },
  ];

  return (
    <SectionCard
      title="Soon out of stock"
      subtitle="Days left = available stock / average daily units sold on selected range."
      exportConfig={{
        filename: "soon-out-of-stock.csv",
        headers: ["Product", "SKU", "Available", "Sold", "Days left", "Status"],
        rows: stockAlerts.map((row) => [
          row.product,
          row.sku,
          row.available,
          row.unitsSold,
          row.daysLeft === null ? "-" : row.daysLeft.toFixed(1),
          row.status,
        ]),
      }}
    >
      <SortableDataTable
        ariaLabel="Products soon out of stock"
        columns={columns}
        defaultSort={{ key: "daysLeft", direction: "asc" }}
        getRowKey={(row, index) => `${row.sku}-${row.product}-${index}`}
        rows={stockAlerts}
      />
    </SectionCard>
  );
}
