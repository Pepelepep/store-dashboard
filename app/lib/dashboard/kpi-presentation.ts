import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "./dashboard-metrics";
import type { FinancialMetricsVersion } from "./dashboard-types";

export type ReportKpiCategory = "commercial" | "activity" | "neutral";

export type SharedReportKpiId =
  | "sales"
  | "refunds"
  | "returns"
  | "orders"
  | "unitsSold"
  | "cogs"
  | "grossProfit"
  | "grossMargin"
  | "expenses"
  | "netProfit";

export type LocationOnlyReportKpiId = "averageOrderValue";
export type ReportKpiId = SharedReportKpiId | LocationOnlyReportKpiId;

export type ReportKpiPresentationItem = {
  id: ReportKpiId;
  label: string;
  value: string;
  explanation: string;
  category: ReportKpiCategory;
};

export type SharedReportKpiValues = {
  revenue: number;
  refunds?: number;
  returns?: number;
  ordersCount: number;
  unitsSold: number;
  cogs: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  expenses: number | null;
  netProfit: number | null;
};

/**
 * Dashboard defines the canonical relative order of every shared report KPI.
 * Consumers may omit unavailable metrics, but must not reorder the remainder.
 */
export const SHARED_REPORT_KPI_ORDER = {
  legacy: [
    "sales",
    "orders",
    "unitsSold",
    "cogs",
    "grossProfit",
    "grossMargin",
    "expenses",
    "netProfit",
  ],
  v2: [
    "sales",
    "refunds",
    "returns",
    "orders",
    "unitsSold",
    "cogs",
    "grossProfit",
    "grossMargin",
    "expenses",
    "netProfit",
  ],
} as const satisfies Record<
  FinancialMetricsVersion,
  readonly SharedReportKpiId[]
>;

/**
 * Location-only metrics are appended after the complete shared KPI block so
 * shared metrics keep the same relative order on Dashboard and Locations.
 */
export const LOCATION_ONLY_REPORT_KPI_APPEND_ORDER = [
  "averageOrderValue",
] as const satisfies readonly LocationOnlyReportKpiId[];

const KPI_CATEGORIES: Record<ReportKpiId, ReportKpiCategory> = {
  sales: "commercial",
  refunds: "neutral",
  returns: "neutral",
  orders: "activity",
  unitsSold: "activity",
  cogs: "neutral",
  grossProfit: "commercial",
  grossMargin: "commercial",
  expenses: "neutral",
  netProfit: "commercial",
  averageOrderValue: "activity",
};

export const REPORT_METRIC_DEFINITIONS = {
  grossSales: "Gross Sales: product sales before discounts and returns.",
  discounts:
    "Discounts: Shopify discount allocations applied to orders and line items.",
  netSales: "Net Sales: Gross Sales minus Discounts and Returns.",
  revenue:
    "Total synced sales revenue for the selected location and date range.",
  refunds:
    "Refunds: cash refunded on Shopify orders, reported separately from returns.",
  returns:
    "Returns: returned line-item value used in net sales calculations where available.",
  orders:
    "Unique Shopify orders represented in the selected location and date range.",
  unitsSold:
    "Total quantity sold across synced order lines in the selected range.",
  cogs: "COGS: cost of goods sold from synced Shopify inventory item cost data where available.",
  grossProfit: "Gross Profit: Net Sales minus COGS.",
  legacyGrossProfit:
    "Revenue minus COGS. COGS uses the latest Shopify Cost per item. Missing costs appear as MISSING_COST.",
  grossMargin: "Margin: Gross Profit divided by Net Sales.",
  legacyGrossMargin:
    "Gross profit as a percentage of revenue. COGS uses the latest Shopify Cost per item. Missing costs appear as MISSING_COST.",
  expenses: "Fixed expenses allocated to the selected location and date range.",
  netProfit: "Gross profit minus configured fixed expenses.",
  averageOrderValue: "Average order value equals sales divided by orders.",
} as const;

function getSharedKpiLabel(
  id: SharedReportKpiId,
  financialMetricsVersion: FinancialMetricsVersion,
) {
  if (id === "sales") {
    return financialMetricsVersion === "v2" ? "Net Sales" : "Revenue";
  }

  const labels: Record<Exclude<SharedReportKpiId, "sales">, string> = {
    refunds: "Refunds",
    returns: "Returns",
    orders: "Orders",
    unitsSold: "Units sold",
    cogs: "COGS",
    grossProfit: "Gross profit",
    grossMargin: "Gross margin",
    expenses: "Expenses",
    netProfit: "Net profit",
  };
  return labels[id];
}

function getSharedKpiExplanation(
  id: SharedReportKpiId,
  financialMetricsVersion: FinancialMetricsVersion,
) {
  switch (id) {
    case "sales":
      return financialMetricsVersion === "v2"
        ? REPORT_METRIC_DEFINITIONS.netSales
        : REPORT_METRIC_DEFINITIONS.revenue;
    case "refunds":
      return REPORT_METRIC_DEFINITIONS.refunds;
    case "returns":
      return REPORT_METRIC_DEFINITIONS.returns;
    case "orders":
      return REPORT_METRIC_DEFINITIONS.orders;
    case "unitsSold":
      return REPORT_METRIC_DEFINITIONS.unitsSold;
    case "cogs":
      return REPORT_METRIC_DEFINITIONS.cogs;
    case "grossProfit":
      return financialMetricsVersion === "v2"
        ? REPORT_METRIC_DEFINITIONS.grossProfit
        : REPORT_METRIC_DEFINITIONS.legacyGrossProfit;
    case "grossMargin":
      return financialMetricsVersion === "v2"
        ? REPORT_METRIC_DEFINITIONS.grossMargin
        : REPORT_METRIC_DEFINITIONS.legacyGrossMargin;
    case "expenses":
      return REPORT_METRIC_DEFINITIONS.expenses;
    case "netProfit":
      return REPORT_METRIC_DEFINITIONS.netProfit;
  }
}

function formatSharedKpiValue(
  id: SharedReportKpiId,
  values: SharedReportKpiValues,
) {
  switch (id) {
    case "sales":
      return formatCurrency(values.revenue);
    case "refunds":
      return formatCurrency(values.refunds ?? 0);
    case "returns":
      return formatCurrency(values.returns ?? 0);
    case "orders":
      return formatNumber(values.ordersCount);
    case "unitsSold":
      return formatNumber(values.unitsSold);
    case "cogs":
      return formatCurrency(values.cogs);
    case "grossProfit":
      return values.grossProfit === null
        ? "—"
        : formatCurrency(values.grossProfit);
    case "grossMargin":
      return formatPercent(values.grossMarginPct);
    case "expenses":
      return values.expenses === null
        ? "Not configured"
        : formatCurrency(values.expenses);
    case "netProfit":
      return values.netProfit === null
        ? "Not available"
        : formatCurrency(values.netProfit);
  }
}

export function buildSharedReportKpiItems({
  values,
  financialMetricsVersion,
}: {
  values: SharedReportKpiValues;
  financialMetricsVersion: FinancialMetricsVersion;
}): ReportKpiPresentationItem[] {
  return SHARED_REPORT_KPI_ORDER[financialMetricsVersion].map((id) => ({
    id,
    label: getSharedKpiLabel(id, financialMetricsVersion),
    value: formatSharedKpiValue(id, values),
    explanation: getSharedKpiExplanation(id, financialMetricsVersion),
    category: KPI_CATEGORIES[id],
  }));
}

export function buildLocationOnlyReportKpiItems({
  averageOrderValue,
  financialMetricsVersion,
}: {
  averageOrderValue: number;
  financialMetricsVersion: FinancialMetricsVersion;
}): ReportKpiPresentationItem[] {
  return LOCATION_ONLY_REPORT_KPI_APPEND_ORDER.map((id) => ({
    id,
    label: financialMetricsVersion === "v2" ? "AOV (Net)" : "AOV",
    value: formatCurrency(averageOrderValue),
    explanation:
      financialMetricsVersion === "v2"
        ? "AOV (Net) = Net Sales / Orders"
        : "Average Order Value = Revenue / Orders",
    category: KPI_CATEGORIES[id],
  }));
}
