import {
  formatCurrency,
  formatNumber,
  formatStoreDateTime,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  FinancialMetricsVersion,
  RecentOrderRow,
} from "../../lib/dashboard/dashboard-types";
import {
  SortableDataTable,
  type SortableDataTableColumn,
} from "../ui/SortableDataTable";
import { SectionCard } from "./SectionCard";

function getChipStyles(label: string) {
  if (
    label === "Returned" ||
    label === "Partial return" ||
    label === "Return"
  ) {
    return {
      background: "#fff1f0",
      border: "1px solid #ffccc7",
      color: "#a8071a",
    };
  }

  if (
    label === "Refunded" ||
    label === "Partial refund" ||
    label === "Refund"
  ) {
    return {
      background: "#fff7e6",
      border: "1px solid #ffd591",
      color: "#ad4e00",
    };
  }

  return {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
  };
}

function Chip({ label }: { label: string }) {
  const toneStyles = getChipStyles(label);

  return (
    <span
      title="Return = merchandise returned. Refund = money returned to customer."
      style={{
        ...toneStyles,
        borderRadius: 999,
        display: "inline-block",
        fontSize: 12,
        fontWeight: 800,
        margin: "0 4px 4px 0",
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function RecentOrderLinesCard({
  recentOrders,
  financialMetricsVersion,
}: {
  recentOrders: RecentOrderRow[];
  financialMetricsVersion: FinancialMetricsVersion;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const formatDate = formatStoreDateTime;
  const exportHeaders = isFinancialMetricsV2
    ? [
        "Order",
        "Date",
        "Product",
        "SKU",
        "Qty",
        "Gross Sales",
        "Discounts",
        "Net Sales",
        "Returns",
        "Refunded Amount",
        "Returned Qty",
        "Cost at Sale",
        "COGS",
        "Gross profit",
        "Flags",
      ]
    : [
        "Order",
        "Date",
        "Product",
        "SKU",
        "Qty",
        "Revenue",
        "COGS",
        "Gross profit",
      ];
  const exportRows = recentOrders.map((row) =>
    isFinancialMetricsV2
      ? [
          row.orderName,
          formatDate(row.date),
          row.product,
          row.sku,
          row.quantity,
          row.grossSales ?? "-",
          row.discounts ?? "-",
          row.netSales ?? "-",
          row.returns ?? "-",
          row.refundedAmount ?? "-",
          row.returnedQuantity ?? "-",
          row.costAtSale ?? "-",
          row.cogs ?? "-",
          row.grossProfit ?? "-",
          row.chips?.join(", ") ?? "",
        ]
      : [
          row.orderName,
          formatDate(row.date),
          row.product,
          row.sku,
          row.quantity,
          row.revenue,
          row.cogs ?? "-",
          row.grossProfit ?? "-",
        ],
  );
  const moneyColumn = (
    key: keyof RecentOrderRow,
    label: string,
  ): SortableDataTableColumn<RecentOrderRow> => ({
    align: "right",
    key: String(key),
    label,
    render: (row) => {
      const value = row[key];
      return typeof value === "number" ? formatCurrency(value) : "-";
    },
    sortValue: (row) => {
      const value = row[key];
      return typeof value === "number" ? value : null;
    },
  });
  const columns: SortableDataTableColumn<RecentOrderRow>[] = [
    {
      key: "order",
      label: "Order",
      render: (row) =>
        row.orderUrl ? (
          <a href={row.orderUrl} target="_blank" rel="noreferrer">
            {row.orderName}
          </a>
        ) : (
          row.orderName
        ),
      sortValue: (row) => row.orderName,
    },
    {
      key: "date",
      label: "Date",
      minWidth: isFinancialMetricsV2 ? 138 : undefined,
      render: (row) => formatDate(row.date),
      sortValue: (row) => new Date(row.date).getTime(),
    },
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
      key: "quantity",
      label: "Qty",
      render: (row) => formatNumber(row.quantity),
      sortValue: (row) => row.quantity,
    },
    ...(isFinancialMetricsV2
      ? [
          moneyColumn("grossSales", "Gross Sales"),
          moneyColumn("discounts", "Discounts"),
          moneyColumn("netSales", "Net Sales"),
          moneyColumn("returns", "Returns"),
          moneyColumn("refundedAmount", "Refunded"),
          {
            align: "right" as const,
            key: "returnedQuantity",
            label: "Returned Qty",
            render: (row: RecentOrderRow) =>
              row.returnedQuantity == null
                ? "-"
                : formatNumber(row.returnedQuantity),
            sortValue: (row: RecentOrderRow) => row.returnedQuantity,
          },
          moneyColumn("costAtSale", "Cost at Sale"),
          moneyColumn("cogs", "COGS"),
          moneyColumn("grossProfit", "Gross profit"),
          {
            key: "flags",
            label: "Flags",
            render: (row: RecentOrderRow) =>
              row.chips && row.chips.length > 0
                ? row.chips.map((chip) => <Chip key={chip} label={chip} />)
                : "-",
            sortValue: (row: RecentOrderRow) => row.chips?.join(" ") ?? "",
          },
        ]
      : [
          moneyColumn("revenue", "Revenue"),
          moneyColumn("cogs", "COGS"),
          moneyColumn("grossProfit", "Gross profit"),
        ]),
  ];

  return (
    <SectionCard
      title="Recent order lines"
      subtitle={
        isFinancialMetricsV2
          ? "Return = merchandise returned. Refund = money returned to customer."
          : undefined
      }
      exportConfig={{
        filename: "recent-order-lines.csv",
        headers: exportHeaders,
        rows: exportRows,
      }}
    >
      <SortableDataTable
        ariaLabel="Recent order lines"
        columns={columns}
        defaultSort={{ key: "date", direction: "desc" }}
        getRowKey={(row, index) =>
          `${row.orderName}-${row.sku}-${row.date}-${index}`
        }
        rows={recentOrders}
      />
    </SectionCard>
  );
}
