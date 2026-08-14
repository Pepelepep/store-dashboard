import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { LocationIcon } from "@shopify/polaris-icons";

import { AppButton, AppButtonLink } from "../components/ui/AppButton";
import { NetSalesTrendPlot } from "../components/dashboard/NetSalesTrendPlot";
import { LocationsContentSkeleton } from "../components/dashboard/LocationsSkeleton";
import {
  attachReportKpiDetails,
  ReportKpiGrid,
  ReportKpiNotice,
} from "../components/dashboard/ReportKpiGrid";
import {
  ReadOnlyReportLocation,
  ReportFilterField,
  ReportFilterPanel,
} from "../components/dashboard/ReportFilters";
import { PageNotice } from "../components/ui/PageNotice";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SectionTabs } from "../components/ui/SectionTabs";
import { ShopOpsDrilldownBar } from "../components/ui/ShopOpsDrilldownBar";
import {
  ContentCard,
  CompactEmptyDataNotice,
  EmptyState,
  FormActions,
  InlineNotice,
  PageHeader,
  SelectableCard,
  ShopOpsPage,
} from "../components/ui/ShopOpsPage";
import { getDataSyncPath } from "../lib/navigation/sync-status";
import {
  assertReportingEntitlements,
  getEntitlementSnapshot,
  getFreshPlanLimits,
  type EntitlementLocation,
} from "../lib/entitlements.server";
import { assertCapabilityAccess } from "../lib/auth/permissions.server";
import {
  getBillingState,
  isAccessibleBillingState,
} from "../lib/billing.server";
import { resolveReportingScope } from "../lib/auth/location-performance-access";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { fetchAllSupabasePages } from "../lib/db/supabase-pagination.server";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
import { getShopLevelAdminClient } from "../lib/shopify/shop-level-admin.server";
import {
  daysBetween,
  formatCurrency,
  formatNumber,
  formatPercent,
  getLineCogsV2,
  getLineDiscounts,
  getLineGrossSales,
  getLineNetSales,
  getLineReturnedQuantity,
  getLineReturns,
  getPreviousPeriodDateRange,
  getStaffDisplayLabel,
  getStaffFilterValue,
  getTodayStoreDate,
  getVendorFilterValue,
  normalizeFinancialMetricsVersion,
  nextDate,
  STORE_TIME_ZONE,
  storeDateToUtcIso,
  UNKNOWN_STAFF_FILTER_VALUE,
} from "../lib/dashboard/dashboard-metrics";
import type {
  DashboardFilterOption,
  FinancialMetricsVersion,
  FixedExpenseDbRow,
  LocationRow,
  OrderLineDbRow,
} from "../lib/dashboard/dashboard-types";
import { authenticate } from "../shopify.server";
import { fetchStaffIdentityAliasesForOrderLines } from "../lib/staff-identity/staff-identity.server";
import { resolveStaffDisplayNameForOrderLine } from "../lib/staff-identity/staff-identity";
import { calculateReportedProfit, summarizeCogs } from "../lib/financial/cogs";
import { allocateExpensesByLocation } from "../lib/financial/expense-allocation";
import { calculateNetSalesAfterCashRefunds } from "../lib/financial/net-sales";
import { buildDrilldownResetKey } from "../lib/dashboard/drilldown-reset-key";
import { reconcileTrendRowsWithCashRefunds } from "../lib/dashboard/location-trend-reconciliation";
import { limitRankedBreakdownRows } from "../lib/dashboard/ranked-breakdown";
import { formatTrendPeriodLabel } from "../lib/dashboard/chart-formatters";
import {
  buildReportKpiComparison,
  buildLocationOnlyReportKpiItems,
  buildSharedReportKpiItems,
  REPORT_METRIC_DEFINITIONS,
  type ReportKpiComparison,
  type ReportKpiId,
} from "../lib/dashboard/kpi-presentation";

type LocationMetricRow = {
  locationId: string;
  locationName: string;
  revenue: number;
  grossSales?: number;
  discounts?: number;
  returns?: number;
  returnedUnits?: number;
  netSales?: number;
  refunds?: number;
  ordersCount: number;
  unitsSold: number;
  cogs: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  expenses: number;
  netProfit: number | null;
  cogsIncomplete: boolean;
  includesEstimatedCogs: boolean;
  missingCogsLineCount: number;
  knownCogsLineCount: number;
  actualCogs: number;
  estimatedCogs: number;
  averageOrderValue: number;
};

type TrendRow = {
  period: string;
  label: string;
  revenue: number;
  ordersCount: number;
  unitsSold: number;
};

type RevenueBreakdownRow = {
  label: string;
  value: string;
  revenue: number;
  ordersCount: number;
  unitsSold: number;
  percent: number;
};

type LocationsSalesRow = Pick<
  OrderLineDbRow,
  | "created_at_shopify"
  | "retail_location_id"
  | "retail_location_name"
  | "vendor"
  | "staff_member_id"
  | "staff_member_name"
  | "staff_member_email"
  | "resolved_staff_display_name"
  | "resolved_staff_status"
  | "resolved_staff_key"
  | "shopify_order_id"
  | "quantity"
  | "revenue"
  | "cogs"
  | "gross_sales"
  | "discounts"
  | "returns"
  | "net_sales"
  | "returned_quantity"
  | "cost_at_sale"
  | "unit_cost"
  | "cost_source"
>;

type ActiveLocationDrilldowns = {
  period?: { value: string; label: string } | null;
  vendor?: { value: string; label: string } | null;
  staff?: { value: string; label: string } | null;
  location?: { value: string; label: string } | null;
};

type Period = "day" | "week" | "month" | "year";

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

type SortKey =
  | "location"
  | "grossSales"
  | "discounts"
  | "returns"
  | "returnedUnits"
  | "revenue"
  | "refunds"
  | "orders"
  | "units"
  | "cogs"
  | "grossProfit"
  | "grossMargin"
  | "expenses"
  | "netProfit"
  | "aov";

type LoaderData = {
  view: "performance";
  canManageCosts: boolean;
  canManageReportingLocations: boolean;
  canManageSync: boolean;
  dashboardAccessNotice: boolean;
  locations: LocationRow[];
  selectedLocationIds: string[];
  selectedStaff: string;
  selectedVendor: string;
  staffOptions: DashboardFilterOption[];
  vendorOptions: DashboardFilterOption[];
  startDate: string;
  endDate: string;
  isTodayRange: boolean;
  preservedSearchParams: Array<{ name: string; value: string }>;
  lastSuccessfulSync: string | null;
  selectedDays: number;
  period: Period;
  kpis: Omit<LocationMetricRow, "locationId" | "locationName">;
  comparisonKpis: Omit<LocationMetricRow, "locationId" | "locationName">;
  hasOperatingExpenses: boolean;
  financialMetricsVersion: FinancialMetricsVersion;
  locationRows: LocationMetricRow[];
  trendRows: TrendRow[];
  revenueByVendor: RevenueBreakdownRow[];
  revenueByStaff: RevenueBreakdownRow[];
  salesRows: LocationsSalesRow[];
  refundTransactions: OrderTransactionDbRow[];
  debugInfo?: Record<string, string | number | boolean | null | string[]>;
};

type ReportingLoaderData = {
  view: "reporting";
  canManageReportingLocations: true;
  locations: EntitlementLocation[];
  usage: number;
  limit: number | null;
};

type ReportingActionData = {
  ok: boolean;
  message: string;
};

const ORDER_LINES_PAGE_SIZE = 1000;
const LOCATION_ORDER_LINES_SELECT =
  "id, order_name, shopify_order_id, created_at_shopify, retail_location_id, retail_location_name, product_title, variant_title, sku, vendor, quantity, unit_price, revenue, unit_cost, cogs, gross_profit, cost_source, returned_quantity, cost_at_sale, staff_member_id, staff_member_name, staff_member_email, shopops_staff_member_id, shopops_user_id, shopops_attributed_user_id, shopops_effective_staff_id, shopops_attribution_source";

type OrderTransactionDbRow = {
  id: string;
  shopify_order_id: string;
  shopify_transaction_id: string;
  kind: string | null;
  status: string | null;
  amount: number | null;
  processed_at: string | null;
};

async function fetchLocationOrderLines({
  supabase,
  shop,
  startDateUtc,
  endExclusiveUtc,
  selectedLocationIds,
  shouldFilterByLocation,
  financialMetricsVersion,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  shop: string;
  startDateUtc: string;
  endExclusiveUtc: string;
  selectedLocationIds: string[];
  shouldFilterByLocation: boolean;
  financialMetricsVersion: FinancialMetricsVersion;
}) {
  const selectColumns =
    financialMetricsVersion === "v2" ? "*" : LOCATION_ORDER_LINES_SELECT;

  const rows = await fetchAllSupabasePages<OrderLineDbRow & { id: string }>({
    label: "Location order lines",
    pageSize: ORDER_LINES_PAGE_SIZE,
    getRowKey: (row) => row.id,
    fetchPage: (from, to) => {
      let query = supabase
        .from("order_lines")
        .select(selectColumns)
        .eq("shop_domain", shop)
        .gte("created_at_shopify", startDateUtc)
        .lt("created_at_shopify", endExclusiveUtc);

      if (shouldFilterByLocation) {
        query = query.in("retail_location_id", selectedLocationIds);
      }

      return query
        .order("created_at_shopify", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: Array<OrderLineDbRow & { id: string }> | null;
        error: { message: string } | null;
      }>;
    },
  });

  return { data: rows, error: null };
}

function isSuccessfulRefundTransaction(row: OrderTransactionDbRow) {
  const kind = row.kind?.toUpperCase();
  const status = row.status?.toUpperCase();

  return kind === "REFUND" && (!status || status === "SUCCESS");
}

async function fetchRefundTransactionsForOrders({
  supabase,
  shop,
  orderIds,
  startDateUtc,
  endExclusiveUtc,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  shop: string;
  orderIds: string[];
  startDateUtc: string;
  endExclusiveUtc: string;
}) {
  const orderIdSet = new Set(orderIds);

  // Scoped by shop_domain + processed_at (order_transactions_shop_processed_idx)
  // instead of chunking orderIds into .in() batches: order_transactions has no
  // location column, so the .in() filter never bought index selectivity, only
  // extra round trips. Filtering against orderIdSet in JS afterward reproduces
  // the exact same result set.
  const rows = await fetchAllSupabasePages<OrderTransactionDbRow>({
    label: "Location refund transactions",
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("order_transactions")
        .select(
          "id, shopify_order_id, shopify_transaction_id, kind, status, amount, processed_at",
        )
        .eq("shop_domain", shop)
        .gte("processed_at", startDateUtc)
        .lt("processed_at", endExclusiveUtc)
        .order("processed_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: OrderTransactionDbRow[] | null;
        error: { message: string } | null;
      }>,
  });

  return rows.filter(
    (row) => orderIdSet.has(row.shopify_order_id) && isSuccessfulRefundTransaction(row),
  );
}

function allocateRefundsByLocation({
  orderLines,
  refundTransactions,
}: {
  orderLines: LocationsSalesRow[];
  refundTransactions: OrderTransactionDbRow[];
}) {
  const orderLocationWeights = new Map<string, Map<string, number>>();

  for (const row of orderLines) {
    if (!row.shopify_order_id || !row.retail_location_id) continue;

    const locations =
      orderLocationWeights.get(row.shopify_order_id) ??
      new Map<string, number>();
    locations.set(
      row.retail_location_id,
      (locations.get(row.retail_location_id) ?? 0) + getLineNetSales(row),
    );
    orderLocationWeights.set(row.shopify_order_id, locations);
  }

  const refundsByLocation = new Map<string, number>();

  for (const transaction of refundTransactions) {
    const locations = orderLocationWeights.get(transaction.shopify_order_id);
    if (!locations || locations.size === 0) continue;

    const amount = Number(transaction.amount ?? 0);
    const totalWeight = Array.from(locations.values()).reduce(
      (sum, value) => sum + Math.max(0, value),
      0,
    );

    for (const [locationId, weight] of locations) {
      const allocation =
        totalWeight > 0
          ? amount * (Math.max(0, weight) / totalWeight)
          : amount / locations.size;
      refundsByLocation.set(
        locationId,
        (refundsByLocation.get(locationId) ?? 0) + allocation,
      );
    }
  }

  return refundsByLocation;
}

function summarizeOrderLinesForDebug(orderLines: OrderLineDbRow[]) {
  let minCreatedAt: string | null = null;
  let maxCreatedAt: string | null = null;
  let revenueSum = 0;
  const orderIds = new Set<string>();

  for (const row of orderLines) {
    if (row.created_at_shopify) {
      if (!minCreatedAt || row.created_at_shopify < minCreatedAt) {
        minCreatedAt = row.created_at_shopify;
      }
      if (!maxCreatedAt || row.created_at_shopify > maxCreatedAt) {
        maxCreatedAt = row.created_at_shopify;
      }
    }

    revenueSum += Number(row.revenue ?? 0);
    if (row.shopify_order_id) orderIds.add(row.shopify_order_id);
  }

  return {
    count: orderLines.length,
    minCreatedAt,
    maxCreatedAt,
    revenueSum,
    uniqueOrdersCount: orderIds.size,
  };
}

function parseDateOnlyUtc(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDateOnlyUtc(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}`;
}

function getYearKey(date: Date) {
  return String(date.getUTCFullYear());
}

function buildStaffOptions(orderLines: OrderLineDbRow[]) {
  const options = new Map<string, string>();
  let hasUnknownStaff = false;

  for (const row of orderLines) {
    const value = getStaffFilterValue(row);

    if (!value) {
      hasUnknownStaff = true;
      continue;
    }

    if (!options.has(value)) {
      options.set(value, getStaffDisplayLabel(row));
    }
  }

  const sortedOptions = Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  if (hasUnknownStaff) {
    sortedOptions.push({
      value: UNKNOWN_STAFF_FILTER_VALUE,
      label: "Unassigned",
    });
  }

  return sortedOptions;
}

function buildVendorOptions(orderLines: OrderLineDbRow[]) {
  const vendors = new Set<string>();

  for (const row of orderLines) {
    const vendor = row.vendor?.trim();
    if (vendor) vendors.add(vendor);
  }

  return Array.from(vendors)
    .sort((a, b) => a.localeCompare(b))
    .map((vendor) => ({ value: vendor, label: vendor }));
}

function filterOrderLines({
  orderLines,
  selectedStaff,
  selectedVendor,
}: {
  orderLines: OrderLineDbRow[];
  selectedStaff: string;
  selectedVendor: string;
}) {
  return orderLines.filter((row) => {
    const staffMatches =
      !selectedStaff ||
      (selectedStaff === UNKNOWN_STAFF_FILTER_VALUE
        ? !getStaffFilterValue(row)
        : getStaffFilterValue(row) === selectedStaff);
    const vendorMatches =
      !selectedVendor || getVendorFilterValue(row) === selectedVendor;

    return staffMatches && vendorMatches;
  });
}

function toLocationsSalesRows(
  orderLines: OrderLineDbRow[],
  financialMetricsVersion: FinancialMetricsVersion,
): LocationsSalesRow[] {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";

  return orderLines.map((row) => ({
    created_at_shopify: row.created_at_shopify,
    retail_location_id: row.retail_location_id,
    retail_location_name: row.retail_location_name,
    vendor: row.vendor,
    staff_member_id: row.staff_member_id,
    staff_member_name: row.staff_member_name,
    staff_member_email: row.staff_member_email,
    resolved_staff_display_name: row.resolved_staff_display_name,
    resolved_staff_status: row.resolved_staff_status,
    resolved_staff_key: row.resolved_staff_key,
    shopify_order_id: row.shopify_order_id,
    quantity: Number(row.quantity ?? 0),
    revenue: isFinancialMetricsV2
      ? getLineNetSales(row)
      : Number(row.revenue ?? 0),
    cogs: getLineCogsV2(row),
    gross_sales: isFinancialMetricsV2 ? getLineGrossSales(row) : undefined,
    discounts: isFinancialMetricsV2 ? getLineDiscounts(row) : undefined,
    returns: isFinancialMetricsV2 ? getLineReturns(row) : undefined,
    net_sales: isFinancialMetricsV2 ? getLineNetSales(row) : undefined,
    returned_quantity: getLineReturnedQuantity(row),
    cost_at_sale: row.cost_at_sale,
    unit_cost: row.unit_cost,
    cost_source: row.cost_source,
  }));
}

function getVendorDrilldownValue(row: LocationsSalesRow) {
  return row.vendor?.trim() || "Unknown vendor";
}

function getStaffDrilldownValue(row: LocationsSalesRow) {
  return row.resolved_staff_key || UNKNOWN_STAFF_FILTER_VALUE;
}

function getStaffDrilldownLabel(row: LocationsSalesRow) {
  return row.resolved_staff_display_name || "Unassigned";
}

function applyLocationDrilldowns({
  orderLines,
  activeDrilldowns,
  period,
}: {
  orderLines: LocationsSalesRow[];
  activeDrilldowns: ActiveLocationDrilldowns;
  period: Period;
}) {
  return orderLines.filter((row) => {
    if (
      activeDrilldowns.period &&
      getOrderLinePeriodKey(row.created_at_shopify, period) !==
        activeDrilldowns.period.value
    ) {
      return false;
    }

    if (
      activeDrilldowns.vendor &&
      getVendorDrilldownValue(row) !== activeDrilldowns.vendor.value
    ) {
      return false;
    }

    if (
      activeDrilldowns.staff &&
      getStaffDrilldownValue(row) !== activeDrilldowns.staff.value
    ) {
      return false;
    }

    if (
      activeDrilldowns.location &&
      row.retail_location_id !== activeDrilldowns.location.value
    ) {
      return false;
    }

    return true;
  });
}

function computeMetrics({
  locations,
  orderLines,
  expensesByLocation,
  financialMetricsVersion,
  refundsByLocation = new Map<string, number>(),
}: {
  locations: LocationRow[];
  orderLines: LocationsSalesRow[];
  expensesByLocation: Map<string, number>;
  financialMetricsVersion: FinancialMetricsVersion;
  refundsByLocation?: Map<string, number>;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const rows = locations.map((location): LocationMetricRow => {
    const rowsForLocation = orderLines.filter(
      (row) => row.retail_location_id === location.shopify_location_id,
    );
    const grossSales = isFinancialMetricsV2
      ? rowsForLocation.reduce((sum, row) => sum + getLineGrossSales(row), 0)
      : undefined;
    const discounts = isFinancialMetricsV2
      ? rowsForLocation.reduce((sum, row) => sum + getLineDiscounts(row), 0)
      : undefined;
    const returns = isFinancialMetricsV2
      ? rowsForLocation.reduce((sum, row) => sum + getLineReturns(row), 0)
      : undefined;
    const returnedUnits = isFinancialMetricsV2
      ? rowsForLocation.reduce(
          (sum, row) => sum + getLineReturnedQuantity(row),
          0,
        )
      : undefined;
    const netSales = isFinancialMetricsV2
      ? rowsForLocation.reduce((sum, row) => sum + getLineNetSales(row), 0)
      : undefined;
    const refunds = isFinancialMetricsV2
      ? (refundsByLocation.get(location.shopify_location_id) ?? 0)
      : undefined;
    const revenue = isFinancialMetricsV2
      ? calculateNetSalesAfterCashRefunds({
          lineNetSales: netSales ?? 0,
          merchandiseReturns: returns ?? 0,
          totalRefunds: refunds ?? 0,
        })
      : rowsForLocation.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0);
    const cogsSummary = summarizeCogs(rowsForLocation);
    const cogs = cogsSummary.cogs;
    const orderIds = new Set(
      rowsForLocation.map((row) => row.shopify_order_id).filter(Boolean),
    );
    const ordersCount = orderIds.size;
    const unitsSold = rowsForLocation.reduce(
      (sum, row) => sum + Number(row.quantity ?? 0),
      0,
    );
    const expenses = expensesByLocation.get(location.shopify_location_id) ?? 0;
    const { grossProfit, grossMarginPct, netProfit } = calculateReportedProfit({
      netSales: revenue,
      knownCogs: cogs,
      expenses,
      cogsIncomplete: cogsSummary.cogsIncomplete,
    });

    return {
      locationId: location.shopify_location_id,
      locationName: location.name,
      revenue,
      grossSales,
      discounts,
      returns,
      returnedUnits,
      netSales,
      refunds,
      ordersCount,
      unitsSold,
      cogs,
      grossProfit,
      grossMarginPct,
      expenses,
      netProfit,
      cogsIncomplete: cogsSummary.cogsIncomplete,
      includesEstimatedCogs: cogsSummary.includesEstimatedCogs,
      missingCogsLineCount: cogsSummary.missingCogsLineCount,
      knownCogsLineCount: cogsSummary.knownCogsLineCount,
      actualCogs: cogsSummary.actualCogs,
      estimatedCogs: cogsSummary.estimatedCogs,
      averageOrderValue: ordersCount > 0 ? revenue / ordersCount : 0,
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue);

  const totals = rows.reduce(
    (sum, row) => ({
      revenue: sum.revenue + row.revenue,
      grossSales: sum.grossSales + (row.grossSales ?? 0),
      discounts: sum.discounts + (row.discounts ?? 0),
      returns: sum.returns + (row.returns ?? 0),
      returnedUnits: sum.returnedUnits + (row.returnedUnits ?? 0),
      netSales: sum.netSales + (row.netSales ?? 0),
      refunds: sum.refunds + (row.refunds ?? 0),
      ordersCount: sum.ordersCount + row.ordersCount,
      unitsSold: sum.unitsSold + row.unitsSold,
      cogs: sum.cogs + row.cogs,
      grossProfit:
        sum.grossProfit === null || row.grossProfit === null
          ? null
          : sum.grossProfit + row.grossProfit,
      grossMarginPct: null,
      expenses: sum.expenses + row.expenses,
      netProfit:
        sum.netProfit === null || row.netProfit === null
          ? null
          : sum.netProfit + row.netProfit,
      cogsIncomplete: sum.cogsIncomplete || row.cogsIncomplete,
      includesEstimatedCogs:
        sum.includesEstimatedCogs || row.includesEstimatedCogs,
      missingCogsLineCount: sum.missingCogsLineCount + row.missingCogsLineCount,
      knownCogsLineCount: sum.knownCogsLineCount + row.knownCogsLineCount,
      actualCogs: sum.actualCogs + row.actualCogs,
      estimatedCogs: sum.estimatedCogs + row.estimatedCogs,
      averageOrderValue: 0,
    }),
    {
      revenue: 0,
      grossSales: 0,
      discounts: 0,
      returns: 0,
      returnedUnits: 0,
      netSales: 0,
      refunds: 0,
      ordersCount: 0,
      unitsSold: 0,
      cogs: 0,
      grossProfit: 0 as number | null,
      grossMarginPct: null as number | null,
      expenses: 0,
      netProfit: 0 as number | null,
      cogsIncomplete: false,
      includesEstimatedCogs: false,
      missingCogsLineCount: 0,
      knownCogsLineCount: 0,
      actualCogs: 0,
      estimatedCogs: 0,
      averageOrderValue: 0,
    },
  );

  return {
    rows,
    totals: {
      ...totals,
      grossMarginPct:
        totals.revenue > 0 && totals.grossProfit !== null
          ? (totals.grossProfit / totals.revenue) * 100
          : null,
      averageOrderValue:
        totals.ordersCount > 0 ? totals.revenue / totals.ordersCount : 0,
    },
  };
}

function computeGlobalKpis({
  orderLines,
  expensesByLocation,
  financialMetricsVersion,
  refundsByLocation = new Map<string, number>(),
}: {
  orderLines: LocationsSalesRow[];
  expensesByLocation: Map<string, number>;
  financialMetricsVersion: FinancialMetricsVersion;
  refundsByLocation?: Map<string, number>;
}): Omit<LocationMetricRow, "locationId" | "locationName"> {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const grossSales = isFinancialMetricsV2
    ? orderLines.reduce((sum, row) => sum + getLineGrossSales(row), 0)
    : undefined;
  const discounts = isFinancialMetricsV2
    ? orderLines.reduce((sum, row) => sum + getLineDiscounts(row), 0)
    : undefined;
  const returns = isFinancialMetricsV2
    ? orderLines.reduce((sum, row) => sum + getLineReturns(row), 0)
    : undefined;
  const returnedUnits = isFinancialMetricsV2
    ? orderLines.reduce((sum, row) => sum + getLineReturnedQuantity(row), 0)
    : undefined;
  const netSales = isFinancialMetricsV2
    ? orderLines.reduce((sum, row) => sum + getLineNetSales(row), 0)
    : undefined;
  const refunds = isFinancialMetricsV2
    ? Array.from(refundsByLocation.values()).reduce(
        (sum, value) => sum + value,
        0,
      )
    : undefined;
  const revenue = isFinancialMetricsV2
    ? calculateNetSalesAfterCashRefunds({
        lineNetSales: netSales ?? 0,
        merchandiseReturns: returns ?? 0,
        totalRefunds: refunds ?? 0,
      })
    : orderLines.reduce((sum, row) => sum + Number(row.revenue ?? 0), 0);
  const cogsSummary = summarizeCogs(orderLines);
  const cogs = cogsSummary.cogs;
  const orderIds = new Set(
    orderLines.map((row) => row.shopify_order_id).filter(Boolean),
  );
  const ordersCount = orderIds.size;
  const unitsSold = orderLines.reduce(
    (sum, row) => sum + Number(row.quantity ?? 0),
    0,
  );
  const expenses = Array.from(expensesByLocation.values()).reduce(
    (sum, value) => sum + value,
    0,
  );
  const { grossProfit, grossMarginPct, netProfit } = calculateReportedProfit({
    netSales: revenue,
    knownCogs: cogs,
    expenses,
    cogsIncomplete: cogsSummary.cogsIncomplete,
  });

  return {
    revenue,
    grossSales,
    discounts,
    returns,
    returnedUnits,
    netSales,
    refunds,
    ordersCount,
    unitsSold,
    cogs,
    grossProfit,
    grossMarginPct,
    expenses,
    netProfit,
    cogsIncomplete: cogsSummary.cogsIncomplete,
    includesEstimatedCogs: cogsSummary.includesEstimatedCogs,
    missingCogsLineCount: cogsSummary.missingCogsLineCount,
    knownCogsLineCount: cogsSummary.knownCogsLineCount,
    actualCogs: cogsSummary.actualCogs,
    estimatedCogs: cogsSummary.estimatedCogs,
    averageOrderValue: ordersCount > 0 ? revenue / ordersCount : 0,
  };
}

function getDefaultPeriod(selectedDays: number): Period {
  if (selectedDays <= 31) return "day";
  if (selectedDays <= 180) return "week";
  if (selectedDays <= 731) return "month";
  return "year";
}

function getSelectedPeriod(value: string | null, selectedDays: number): Period {
  if (
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "year"
  ) {
    return value;
  }

  return getDefaultPeriod(selectedDays);
}

function getIsoWeek(date: Date) {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return { year: target.getUTCFullYear(), week: weekNumber };
}

function getPeriodBucketKey(date: Date, period: Period) {
  if (period === "day") return formatDateOnlyUtc(date);
  if (period === "week") {
    const { year, week } = getIsoWeek(date);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  if (period === "month") return getMonthKey(date);
  return getYearKey(date);
}

function getOrderLinePeriodKey(value: string, period: Period) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const dateOnly = parseDateOnlyUtc(
    `${values.year}-${values.month}-${values.day}`,
  );

  return getPeriodBucketKey(dateOnly, period);
}

function buildPeriodKeys({
  startDate,
  endDate,
  period,
}: {
  startDate: string;
  endDate: string;
  period: Period;
}) {
  const keys: string[] = [];
  const seen = new Set<string>();
  const endExclusiveDate = addDays(parseDateOnlyUtc(endDate), 1);

  for (
    let current = parseDateOnlyUtc(startDate);
    current < endExclusiveDate;
    current = addDays(current, 1)
  ) {
    const key = getPeriodBucketKey(current, period);
    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }

  return keys;
}

function computeTrendRows({
  orderLines,
  refundTransactions,
  startDate,
  endDate,
  period,
  financialMetricsVersion,
}: {
  orderLines: LocationsSalesRow[];
  refundTransactions: OrderTransactionDbRow[];
  startDate: string;
  endDate: string;
  period: Period;
  financialMetricsVersion: FinancialMetricsVersion;
}) {
  const keys = buildPeriodKeys({
    startDate,
    endDate,
    period,
  });
  const ordersByBucket = new Map<string, Set<string>>();
  const rowsByBucket = new Map<string, TrendRow>(
    keys.map((key) => [
      key,
      {
        period: key,
        label: formatTrendPeriodLabel(key, period),
        revenue: 0,
        ordersCount: 0,
        unitsSold: 0,
      },
    ]),
  );

  for (const row of orderLines) {
    const key = getOrderLinePeriodKey(row.created_at_shopify, period);
    const existing = rowsByBucket.get(key);
    if (!existing) continue;

    existing.revenue += Number(row.revenue ?? 0);
    existing.unitsSold += Number(row.quantity ?? 0);

    if (row.shopify_order_id) {
      if (!ordersByBucket.has(key)) ordersByBucket.set(key, new Set<string>());
      ordersByBucket.get(key)?.add(row.shopify_order_id);
    }
  }

  for (const row of rowsByBucket.values()) {
    row.ordersCount = ordersByBucket.get(row.period)?.size ?? 0;
  }

  const productSalesRows = Array.from(rowsByBucket.values());

  if (financialMetricsVersion !== "v2") {
    return { rows: productSalesRows };
  }

  const orderIdsWithLocations = new Set(
    orderLines
      .filter((row) => row.retail_location_id)
      .map((row) => row.shopify_order_id),
  );
  const eligibleRefundTransactions = refundTransactions.filter((transaction) =>
    orderIdsWithLocations.has(transaction.shopify_order_id),
  );
  const merchandiseReturns = orderLines.reduce(
    (sum, row) => sum + getLineReturns(row),
    0,
  );

  return {
    rows: reconcileTrendRowsWithCashRefunds({
      rows: productSalesRows,
      refundTransactions: eligibleRefundTransactions,
      merchandiseReturns,
      getTransactionPeriod: (processedAt) =>
        getOrderLinePeriodKey(processedAt, period),
    }),
  };
}

function computeRevenueBreakdown({
  orderLines,
  getLabel,
  getValue,
  limit = 7,
}: {
  orderLines: LocationsSalesRow[];
  getLabel: (row: LocationsSalesRow) => string;
  getValue: (row: LocationsSalesRow) => string;
  limit?: number;
}) {
  const grouped = new Map<
    string,
    {
      label: string;
      value: string;
      revenue: number;
      orderIds: Set<string>;
      unitsSold: number;
    }
  >();

  for (const row of orderLines) {
    const label = getLabel(row);
    const value = getValue(row);
    const existing = grouped.get(value);

    if (existing) {
      existing.revenue += Number(row.revenue ?? 0);
      existing.unitsSold += Number(row.quantity ?? 0);
      if (row.shopify_order_id) existing.orderIds.add(row.shopify_order_id);
    } else {
      grouped.set(value, {
        value,
        label,
        revenue: Number(row.revenue ?? 0),
        orderIds: new Set(row.shopify_order_id ? [row.shopify_order_id] : []),
        unitsSold: Number(row.quantity ?? 0),
      });
    }
  }

  const totalRevenue = Array.from(grouped.values()).reduce(
    (sum, row) => sum + row.revenue,
    0,
  );

  const sortedRows = Array.from(grouped.values())
    .map((row) => ({
      label: row.label,
      value: row.value,
      revenue: row.revenue,
      ordersCount: row.orderIds.size,
      unitsSold: row.unitsSold,
      percent: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return limitRankedBreakdownRows(sortedRows, limit);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.locations",
    shop: session.shop,
    supabase,
  });
  const url = new URL(request.url);
  if (url.searchParams.get("tab") === "reporting") {
    await assertCapabilityAccess({
      capability: "manage_settings",
      request,
      route: "app.locations.reporting",
      session,
      supabase,
    });
    const billingAdmin = await getShopLevelAdminClient({
      shop: session.shop,
      route: "locations.reporting",
    });
    const billing = await getBillingState({
      admin: billingAdmin,
      shop: session.shop,
    });
    if (!isAccessibleBillingState(billing)) {
      throw new Response("An active ShopOps Studio plan is required.", {
        status: 402,
      });
    }
    const entitlements = await getEntitlementSnapshot({
      supabase,
      shop: session.shop,
      billing,
    });
    return {
      view: "reporting",
      canManageReportingLocations: true,
      locations: entitlements.locations,
      usage: entitlements.activeReportingLocations,
      limit: entitlements.limits.activeLocations,
    } satisfies ReportingLoaderData;
  }

  const { permissions } = await assertReportingEntitlements({
    request,
    requiredCapability: "view_locations",
    route: "app.locations",
    session,
    supabase,
  });
  const shouldShowDebugInfo =
    url.searchParams.get("debug") === "1" &&
    permissions.capabilities.manage_settings;
  const preservedSearchParams = Array.from(url.searchParams.entries())
    .filter(
      ([name]) =>
        ![
          "startDate",
          "endDate",
          "preset",
          "period",
          "staff",
          "vendor",
          "locations",
        ].includes(name),
    )
    .map(([name, value]) => ({ name, value }));
  const today = getTodayStoreDate();
  const preset = url.searchParams.get("preset");
  const startDate =
    preset === "today" ? today : url.searchParams.get("startDate") || today;
  const endDate =
    preset === "today" ? today : url.searchParams.get("endDate") || today;
  const selectedStaff = url.searchParams.get("staff") || "";
  const selectedVendor = url.searchParams.get("vendor") || "";
  const requestedLocationIds = new Set(
    [...url.searchParams.getAll("locations"), ...url.searchParams.getAll("locationId")]
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const selectedDays = daysBetween(startDate, nextDate(endDate));
  const period = getSelectedPeriod(
    url.searchParams.get("period"),
    selectedDays,
  );
  const startDateUtc = storeDateToUtcIso(startDate);
  const endExclusiveUtc = storeDateToUtcIso(nextDate(endDate));
  const previousPeriod = getPreviousPeriodDateRange({ startDate, endDate });
  const previousStartDateUtc = storeDateToUtcIso(previousPeriod.startDate);
  const previousEndExclusiveUtc = storeDateToUtcIso(
    nextDate(previousPeriod.endDate),
  );
  const financialMetricsVersion = normalizeFinancialMetricsVersion(
    process.env.FINANCIAL_METRICS_VERSION,
  );
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";

  const allLocations = await fetchAllSupabasePages<
    LocationRow & { id: string }
  >({
    label: "Location performance locations",
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("locations")
        .select("id, shopify_location_id, name, is_active")
        .eq("shop_domain", session.shop)
        .eq("shopify_is_active", true)
        .eq("reporting_enabled", true)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: Array<LocationRow & { id: string }> | null;
        error: { message: string } | null;
      }>,
  });
  const reportingScope = resolveReportingScope({
    locations: allLocations,
    permissions,
    requestedLocationIds,
    route: "app.locations",
    shop: session.shop,
  });
  const accessibleLocations = reportingScope.accessibleLocations;
  const safeSelectedLocations = reportingScope.selectedLocations;
  const selectedLocationIds = safeSelectedLocations.map(
    (location) => location.shopify_location_id,
  );
  const selectedLocationIdSet = new Set(selectedLocationIds);
  const isAllAccessibleLocationsSelected =
    selectedLocationIds.length === accessibleLocations.length &&
    accessibleLocations.every((location) =>
      selectedLocationIdSet.has(location.shopify_location_id),
    );
  const shouldFilterOrderLinesByLocation = true;
  const canManageSync = permissions.capabilities.manage_sync;

  const [orderLinesResult, previousOrderLinesResult, expenses] =
    await Promise.all([
      selectedLocationIds.length > 0
        ? fetchLocationOrderLines({
            supabase,
            shop: session.shop,
            startDateUtc,
            endExclusiveUtc,
            selectedLocationIds,
            shouldFilterByLocation: shouldFilterOrderLinesByLocation,
            financialMetricsVersion,
          })
        : Promise.resolve({ data: [], error: null }),
      selectedLocationIds.length > 0
        ? fetchLocationOrderLines({
            supabase,
            shop: session.shop,
            startDateUtc: previousStartDateUtc,
            endExclusiveUtc: previousEndExclusiveUtc,
            selectedLocationIds,
            shouldFilterByLocation: shouldFilterOrderLinesByLocation,
            financialMetricsVersion,
          })
        : Promise.resolve({ data: [], error: null }),
      fetchAllSupabasePages<FixedExpenseDbRow & { id: string }>({
        label: "Location performance expenses",
        getRowKey: (row) => row.id,
        fetchPage: (from, to) =>
          supabase
            .from("fixed_expenses")
            .select(
              "id, expense_name, expense_category, monthly_amount, shopify_location_id, location_name, start_month, end_month, is_active",
            )
            .eq("shop_domain", session.shop)
            .eq("is_active", true)
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: Array<FixedExpenseDbRow & { id: string }> | null;
            error: { message: string } | null;
          }>,
      }),
    ]);

  const { data: lastSuccessfulSyncRun, error: lastSuccessfulSyncError } =
    await supabase
      .from("sync_runs")
      .select("finished_at")
      .eq("shop_domain", session.shop)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  if (lastSuccessfulSyncError) {
    throw new Error(
      `Latest successful sync could not be loaded: ${lastSuccessfulSyncError.message}`,
    );
  }

  const rawOrderLines = (orderLinesResult.data ?? []) as OrderLineDbRow[];
  const rawPreviousOrderLines = (previousOrderLinesResult.data ??
    []) as OrderLineDbRow[];
  const staffAliasesByKey = await fetchStaffIdentityAliasesForOrderLines({
    supabase,
    shop: session.shop,
    orderLines: [...rawOrderLines, ...rawPreviousOrderLines],
  });
  const resolveOrderLineStaff = (row: OrderLineDbRow) => {
    const resolution = resolveStaffDisplayNameForOrderLine(
      row,
      staffAliasesByKey,
    );
    return {
      ...row,
      resolved_staff_display_name: resolution.label,
      resolved_staff_status: resolution.status,
      resolved_staff_key: resolution.staffKey,
    };
  };
  const orderLines = rawOrderLines.map(resolveOrderLineStaff);
  const previousOrderLines = rawPreviousOrderLines.map(resolveOrderLineStaff);
  if (allLocations.length === 0 || orderLines.length === 0) {
    logEmptyDataState({
      route: "app.locations",
      shop: session.shop,
      reason:
        allLocations.length === 0
          ? "no_synced_locations"
          : "no_order_lines_for_selected_locations",
      counts: {
        locations: allLocations.length,
        accessibleLocations: accessibleLocations.length,
        orderLines: orderLines.length,
        expenses: expenses.length,
      },
    });
  }
  const staffOptions = buildStaffOptions(orderLines);
  const vendorOptions = buildVendorOptions(orderLines);
  const filteredOrderLines = filterOrderLines({
    orderLines,
    selectedStaff,
    selectedVendor,
  });
  const filteredPreviousOrderLines = filterOrderLines({
    orderLines: previousOrderLines,
    selectedStaff,
    selectedVendor,
  });
  const salesRows = toLocationsSalesRows(
    filteredOrderLines,
    financialMetricsVersion,
  );
  const previousSalesRows = toLocationsSalesRows(
    filteredPreviousOrderLines,
    financialMetricsVersion,
  );
  const orderIdsForRefunds = Array.from(
    new Set(
      salesRows
        .map((row) => row.shopify_order_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const previousOrderIdsForRefunds = Array.from(
    new Set(
      previousSalesRows
        .map((row) => row.shopify_order_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [refundTransactions, previousRefundTransactions] = await Promise.all([
    isFinancialMetricsV2 && orderIdsForRefunds.length > 0
      ? fetchRefundTransactionsForOrders({
          supabase,
          shop: session.shop,
          orderIds: orderIdsForRefunds,
          startDateUtc,
          endExclusiveUtc,
        })
      : Promise.resolve([]),
    isFinancialMetricsV2 && previousOrderIdsForRefunds.length > 0
      ? fetchRefundTransactionsForOrders({
          supabase,
          shop: session.shop,
          orderIds: previousOrderIdsForRefunds,
          startDateUtc: previousStartDateUtc,
          endExclusiveUtc: previousEndExclusiveUtc,
        })
      : Promise.resolve([]),
  ]);
  const refundsByLocation = isFinancialMetricsV2
    ? allocateRefundsByLocation({
        orderLines: salesRows,
        refundTransactions,
      })
    : new Map<string, number>();
  const previousRefundsByLocation = isFinancialMetricsV2
    ? allocateRefundsByLocation({
        orderLines: previousSalesRows,
        refundTransactions: previousRefundTransactions,
      })
    : new Map<string, number>();
  const expensesByLocation = allocateExpensesByLocation({
    expenses,
    activeLocationIds: allLocations.map(
      (location) => location.shopify_location_id,
    ),
    startDate,
    endDate,
  });
  const previousExpensesByLocation = allocateExpensesByLocation({
    expenses,
    activeLocationIds: allLocations.map(
      (location) => location.shopify_location_id,
    ),
    startDate: previousPeriod.startDate,
    endDate: previousPeriod.endDate,
  });
  const selectedExpensesByLocation = new Map(
    selectedLocationIds.map((locationId) => [
      locationId,
      expensesByLocation.get(locationId) ?? 0,
    ]),
  );
  const selectedPreviousExpensesByLocation = new Map(
    selectedLocationIds.map((locationId) => [
      locationId,
      previousExpensesByLocation.get(locationId) ?? 0,
    ]),
  );
  const metrics = computeMetrics({
    locations: safeSelectedLocations,
    orderLines: salesRows,
    expensesByLocation,
    financialMetricsVersion,
    refundsByLocation,
  });
  const kpis = computeGlobalKpis({
    orderLines: salesRows,
    expensesByLocation: selectedExpensesByLocation,
    financialMetricsVersion,
    refundsByLocation,
  });
  const comparisonKpis = computeGlobalKpis({
    orderLines: previousSalesRows,
    expensesByLocation: selectedPreviousExpensesByLocation,
    financialMetricsVersion,
    refundsByLocation: previousRefundsByLocation,
  });
  const trend = computeTrendRows({
    orderLines: salesRows,
    refundTransactions,
    startDate,
    endDate,
    period,
    financialMetricsVersion,
  });
  const revenueByVendor = computeRevenueBreakdown({
    orderLines: salesRows,
    limit: 7,
    getLabel: getVendorDrilldownValue,
    getValue: getVendorDrilldownValue,
  });
  const revenueByStaff = computeRevenueBreakdown({
    orderLines: salesRows,
    limit: 7,
    getLabel: getStaffDrilldownLabel,
    getValue: getStaffDrilldownValue,
  });
  const rawDebugSummary = shouldShowDebugInfo
    ? summarizeOrderLinesForDebug(orderLines)
    : null;
  const filteredDebugSummary = shouldShowDebugInfo
    ? summarizeOrderLinesForDebug(filteredOrderLines)
    : null;
  const debugInfo =
    shouldShowDebugInfo && rawDebugSummary && filteredDebugSummary
      ? {
          startDate,
          endDate,
          startDateUtc,
          endExclusiveUtc,
          period,
          rawLocationsParamValues: url.searchParams.getAll("locations"),
          selectedLocationIdsCount: selectedLocationIds.length,
          accessibleLocationsCount: accessibleLocations.length,
          isAllAccessibleLocationsSelected,
          staffFilter: selectedStaff || "All staff",
          vendorFilter: selectedVendor || "All vendors",
          rawOrderLinesCount: rawDebugSummary.count,
          rawMinCreatedAt: rawDebugSummary.minCreatedAt,
          rawMaxCreatedAt: rawDebugSummary.maxCreatedAt,
          rawRevenueSum: rawDebugSummary.revenueSum,
          rawUniqueOrdersCount: rawDebugSummary.uniqueOrdersCount,
          filteredOrderLinesCount: filteredDebugSummary.count,
          filteredMinCreatedAt: filteredDebugSummary.minCreatedAt,
          filteredMaxCreatedAt: filteredDebugSummary.maxCreatedAt,
          filteredRevenueSum: filteredDebugSummary.revenueSum,
          filteredUniqueOrdersCount: filteredDebugSummary.uniqueOrdersCount,
          kpiRevenue: kpis.revenue,
          kpiOrders: kpis.ordersCount,
          kpiUnits: kpis.unitsSold,
          kpiCogs: kpis.cogs,
          kpiGrossProfit: kpis.grossProfit,
          kpiExpenses: kpis.expenses,
          kpiNetProfit: kpis.netProfit,
          locationRowsCount: metrics.rows.length,
          locationRowsRevenueSum: metrics.rows.reduce(
            (sum, row) => sum + row.revenue,
            0,
          ),
          locationRowsOrdersSum: metrics.rows.reduce(
            (sum, row) => sum + row.ordersCount,
            0,
          ),
        }
      : undefined;

  return {
    view: "performance",
    canManageCosts: permissions.capabilities.manage_costs,
    canManageReportingLocations: permissions.capabilities.manage_settings,
    canManageSync,
    dashboardAccessNotice:
      url.searchParams.get("access_notice") === "dashboard_role",
    locations: accessibleLocations,
    selectedLocationIds,
    selectedStaff,
    selectedVendor,
    staffOptions,
    vendorOptions,
    startDate,
    endDate,
    isTodayRange: startDate === today && endDate === today,
    preservedSearchParams,
    lastSuccessfulSync: lastSuccessfulSyncRun?.finished_at ?? null,
    selectedDays,
    period,
    financialMetricsVersion,
    kpis,
    comparisonKpis,
    hasOperatingExpenses: Array.from(selectedExpensesByLocation.values()).some(
      (amount) => amount > 0,
    ),
    locationRows: metrics.rows,
    trendRows: trend.rows,
    revenueByVendor,
    revenueByStaff,
    salesRows,
    refundTransactions,
    debugInfo,
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.locations.reporting.action",
    shop: session.shop,
    supabase,
  });
  const permissions = await assertCapabilityAccess({
    capability: "manage_settings",
    request,
    route: "app.locations.reporting.action",
    session,
    supabase,
  });
  if (!permissions.membership) {
    throw new Response("Dashboard membership is required.", { status: 403 });
  }
  const formData = await request.formData();
  if (String(formData.get("intent") ?? "") !== "save-reporting-locations") {
    return {
      ok: false,
      message: "Unknown location action.",
    } satisfies ReportingActionData;
  }
  const { limits } = await getFreshPlanLimits({
    shop: session.shop,
    route: "locations.reporting.action",
  });
  const result = await supabase.rpc("select_reporting_locations", {
    p_shop_domain: session.shop,
    p_actor_membership_id: permissions.membership.id,
    p_location_ids: formData
      .getAll("location_ids")
      .map((value) => String(value)),
    p_location_limit: limits.activeLocations,
  });
  if (result.error) {
    const messages: Record<string, string> = {
      invalid_location_selection:
        "Select only active Shopify locations for this store.",
      location_plan_capacity: "Select fewer locations or manage your plan.",
      reporting_location_required: "Select at least one reporting location.",
    };
    return {
      ok: false,
      message: messages[result.error.message] ?? result.error.message,
    } satisfies ReportingActionData;
  }
  return {
    ok: true,
    message: "Reporting locations saved.",
  } satisfies ReportingActionData;
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

function KpiGrid({
  kpis,
  comparisonKpis,
  selectedDays,
  financialMetricsVersion,
  hasOperatingExpenses,
  canManageCosts,
}: {
  kpis: LoaderData["kpis"];
  comparisonKpis: LoaderData["comparisonKpis"];
  selectedDays: number;
  financialMetricsVersion: FinancialMetricsVersion;
  hasOperatingExpenses: boolean;
  canManageCosts: boolean;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const location = useLocation();
  const setupSearch = new URLSearchParams(location.search);
  setupSearch.set("tab", "products");
  const productCostsPath = `/app/costs?${setupSearch.toString()}`;
  const expensesSearch = new URLSearchParams(location.search);
  expensesSearch.set("tab", "expenses");
  const expensesPath = `/app/costs?${expensesSearch.toString()}`;
  const grossSales = kpis.grossSales ?? kpis.revenue;
  const discounts = kpis.discounts ?? 0;
  const discountPercent =
    grossSales > 0
      ? formatPercent((discounts / grossSales) * 100)
      : formatPercent(0);
  const grossProfitNotice = kpis.cogsIncomplete ? (
    <ReportKpiNotice tone="warning">
      <div>
        {formatNumber(kpis.missingCogsLineCount)} sales{" "}
        {kpis.missingCogsLineCount === 1 ? "line is" : "lines are"} missing
        product costs.
      </div>
      {canManageCosts ? (
        <Link className="shopops-kpi-notice__action" to={productCostsPath}>
          Review product costs
        </Link>
      ) : null}
    </ReportKpiNotice>
  ) : kpis.includesEstimatedCogs ? (
    <ReportKpiNotice tone="info">
      <div>Includes estimated product costs</div>
      {canManageCosts ? (
        <Link className="shopops-kpi-notice__action" to={productCostsPath}>
          Review product costs
        </Link>
      ) : null}
    </ReportKpiNotice>
  ) : null;
  const expensesNotice =
    !hasOperatingExpenses && canManageCosts ? (
      <ReportKpiNotice tone="neutral">
        <div>No operating expenses configured.</div>
        <Link className="shopops-kpi-notice__action" to={expensesPath}>
          Add expenses
        </Link>
      </ReportKpiNotice>
    ) : null;
  const details: Partial<Record<ReportKpiId, ReactNode>> = {
    sales: isFinancialMetricsV2 ? (
      <>
        <div>After discounts &amp; returns</div>
        <div>
          Discounts applied: {formatCurrency(discounts)} ({discountPercent} of
          Gross)
        </div>
      </>
    ) : (
      "Synced retail sales"
    ),
    returns: `${formatNumber(kpis.returnedUnits ?? 0)} units`,
    cogs:
      kpis.estimatedCogs > 0 || kpis.missingCogsLineCount > 0 ? (
        <>
          {kpis.estimatedCogs > 0 ? (
            <div>
              Actual: {formatCurrency(kpis.actualCogs)} · Estimated:{" "}
              {formatCurrency(kpis.estimatedCogs)}
            </div>
          ) : null}
          {kpis.missingCogsLineCount > 0 ? (
            <div>
              {formatNumber(kpis.missingCogsLineCount)} sales lines missing
              costs
            </div>
          ) : null}
        </>
      ) : null,
    grossProfit: grossProfitNotice,
    grossMargin: kpis.cogsIncomplete ? "Requires complete product costs" : null,
    netProfit: kpis.cogsIncomplete
      ? "Requires complete product costs"
      : (expensesNotice ?? "Gross profit minus expenses"),
  };
  const comparisonLabel =
    selectedDays === 1
      ? "vs previous day"
      : `vs previous ${selectedDays}-day period`;
  const comparisonContext =
    selectedDays === 1 ? "previous day" : `previous ${selectedDays}-day period`;
  const comparisons: Partial<Record<ReportKpiId, ReportKpiComparison>> = {};
  const addComparison = (
    id: ReportKpiId,
    current: number | null | undefined,
    previous: number | null | undefined,
    lowerIsBetter = false,
  ) => {
    if (current === null || current === undefined) return;
    if (previous === null || previous === undefined) return;

    comparisons[id] = buildReportKpiComparison({
      current,
      previous,
      label: comparisonLabel,
      lowerIsBetter,
    });
  };

  addComparison("sales", kpis.revenue, comparisonKpis.revenue);
  addComparison("refunds", kpis.refunds, comparisonKpis.refunds, true);
  addComparison("returns", kpis.returns, comparisonKpis.returns, true);
  addComparison("orders", kpis.ordersCount, comparisonKpis.ordersCount);
  addComparison("unitsSold", kpis.unitsSold, comparisonKpis.unitsSold);
  addComparison("cogs", kpis.cogs, comparisonKpis.cogs, true);
  addComparison("grossProfit", kpis.grossProfit, comparisonKpis.grossProfit);
  addComparison(
    "grossMargin",
    kpis.grossMarginPct,
    comparisonKpis.grossMarginPct,
  );
  addComparison("expenses", kpis.expenses, comparisonKpis.expenses, true);
  addComparison("netProfit", kpis.netProfit, comparisonKpis.netProfit);
  addComparison(
    "averageOrderValue",
    kpis.averageOrderValue,
    comparisonKpis.averageOrderValue,
  );
  const items = attachReportKpiDetails(
    [
      ...buildSharedReportKpiItems({
        values: kpis,
        financialMetricsVersion,
      }),
      ...buildLocationOnlyReportKpiItems({
        averageOrderValue: kpis.averageOrderValue,
        financialMetricsVersion,
      }),
    ],
    details,
    comparisons,
  );

  return (
    <>
      <ReportKpiGrid comparisonContext={comparisonContext} items={items} />
      {isFinancialMetricsV2 ? (
        <details className="shopops-metric-definitions">
          <summary>Metric definitions</summary>
          <div>
            {REPORT_METRIC_DEFINITIONS.grossSales}{" "}
            {REPORT_METRIC_DEFINITIONS.discounts}{" "}
            {REPORT_METRIC_DEFINITIONS.netSales}{" "}
            {REPORT_METRIC_DEFINITIONS.cogs}{" "}
            {REPORT_METRIC_DEFINITIONS.grossProfit}{" "}
            {REPORT_METRIC_DEFINITIONS.grossMargin}{" "}
            {REPORT_METRIC_DEFINITIONS.refunds}{" "}
            {REPORT_METRIC_DEFINITIONS.returns}
          </div>
        </details>
      ) : null}
    </>
  );
}

function TrendChart({
  rows,
  period,
  financialMetricsVersion,
  onFilterChange,
  selectedPeriod,
  onSelectPeriod,
}: {
  rows: TrendRow[];
  period: Period;
  financialMetricsVersion: FinancialMetricsVersion;
  onFilterChange: () => void;
  selectedPeriod?: string | null;
  onSelectPeriod?: (row: TrendRow) => void;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const revenueLabel = isFinancialMetricsV2 ? "Net Sales" : "Revenue";
  return (
    <section className="shopops-section-card shopops-location-trend-card">
      <div className="shopops-location-chart-header">
        <div>
          <h2>
            {isFinancialMetricsV2 ? "Net sales trend" : "Sales trend by period"}
          </h2>
          <p>
            {isFinancialMetricsV2
              ? "Includes order-level cash refunds. Select a period for order and unit details."
              : `${revenueLabel} grouped by ${period}. Orders are available in each period's details.`}
          </p>
        </div>
        <div className="shopops-location-chart-grouping">
          <span>Group by</span>
          <div className="shopops-period-segmented-scroll">
            <div
              aria-label="Group by"
              className="shopops-period-segmented"
              key={period}
              role="radiogroup"
            >
              {PERIOD_OPTIONS.map((option) => (
                <label
                  className="shopops-period-segmented__option"
                  key={option.value}
                >
                  <input
                    defaultChecked={period === option.value}
                    form="locations-filter-form"
                    name="period"
                    onChange={onFilterChange}
                    type="radio"
                    value={option.value}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <NetSalesTrendPlot
        rows={rows}
        revenueLabel={revenueLabel}
        selectedPeriod={selectedPeriod}
        onSelectPeriod={onSelectPeriod}
      />
    </section>
  );
}

function LocationSalesBenchmark({
  revenue,
  totalRevenue,
  averageRevenue,
}: {
  revenue: number;
  totalRevenue: number;
  averageRevenue: number;
}) {
  const share = totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0;
  const delta =
    averageRevenue > 0
      ? ((revenue - averageRevenue) / averageRevenue) * 100
      : 0;
  const tone =
    Math.abs(delta) < 0.05 ? "neutral" : delta > 0 ? "above" : "below";

  return (
    <div className="shopops-location-benchmark">
      <span>{formatPercent(share)} sales share</span>
      <strong data-tone={tone}>
        {tone === "neutral"
          ? "At average"
          : `${delta > 0 ? "↑" : "↓"} ${formatPercent(Math.abs(delta))} ${
              delta > 0 ? "above" : "below"
            } avg`}
      </strong>
    </div>
  );
}

function LocationSalesValue({
  revenue,
  maximumRevenue,
}: {
  revenue: number;
  maximumRevenue: number;
}) {
  const width =
    maximumRevenue > 0 && revenue > 0
      ? Math.max((revenue / maximumRevenue) * 100, 2)
      : 0;

  return (
    <div className="shopops-location-sales-value">
      <strong>{formatCurrency(revenue)}</strong>
      <span aria-hidden="true">
        <i style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

function LocationTable({
  rows,
  financialMetricsVersion,
  selectedLocation,
  onSelectLocation,
}: {
  rows: LocationMetricRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  selectedLocation?: string | null;
  onSelectLocation?: (row: LocationMetricRow) => void;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    {
      key: "revenue",
      direction: "desc",
    },
  );
  const legacyHeaders: Array<{
    label: string;
    key: SortKey;
    title?: string;
  }> = [
    { label: "Location", key: "location" },
    { label: "Revenue", key: "revenue" },
    { label: "Orders", key: "orders" },
    { label: "Units", key: "units" },
    { label: "COGS", key: "cogs" },
    { label: "Gross profit", key: "grossProfit" },
    { label: "Gross margin", key: "grossMargin" },
    { label: "Expenses", key: "expenses" },
    { label: "Net profit", key: "netProfit" },
    {
      label: "AOV",
      key: "aov",
      title: "Average Order Value = Revenue / Orders",
    },
  ];
  const v2Headers: Array<{
    label: string;
    key: SortKey;
    title?: string;
  }> = [
    { label: "Location", key: "location" },
    { label: "Gross Sales", key: "grossSales" },
    { label: "Discounts", key: "discounts" },
    { label: "Returns", key: "returns" },
    { label: "Returned Units", key: "returnedUnits" },
    { label: "Net Sales", key: "revenue" },
    {
      label: "Refunds",
      key: "refunds",
      title:
        "Refunds are order-level cash movements allocated to locations from matching order lines.",
    },
    { label: "Orders", key: "orders" },
    { label: "Units Sold", key: "units" },
    { label: "COGS", key: "cogs" },
    { label: "Gross Profit", key: "grossProfit" },
    {
      label: "Gross Margin",
      key: "grossMargin",
      title: "Gross Margin is based on Net Sales.",
    },
    { label: "Expenses", key: "expenses" },
    { label: "Net Profit", key: "netProfit" },
    { label: "AOV (Net)", key: "aov" },
  ];
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const averageRevenue = rows.length > 0 ? totalRevenue / rows.length : 0;
  const maximumRevenue = Math.max(...rows.map((row) => row.revenue), 0);
  const sortedRows = useMemo(() => {
    const getValue = (row: LocationMetricRow) => {
      if (sort.key === "location") return row.locationName.toLowerCase();
      if (sort.key === "grossSales") return row.grossSales ?? 0;
      if (sort.key === "discounts") return row.discounts ?? 0;
      if (sort.key === "returns") return row.returns ?? 0;
      if (sort.key === "returnedUnits") return row.returnedUnits ?? 0;
      if (sort.key === "revenue") return row.revenue;
      if (sort.key === "refunds") return row.refunds ?? 0;
      if (sort.key === "orders") return row.ordersCount;
      if (sort.key === "units") return row.unitsSold;
      if (sort.key === "cogs") return row.cogs;
      if (sort.key === "grossProfit") return row.grossProfit;
      if (sort.key === "grossMargin") return row.grossMarginPct ?? -Infinity;
      if (sort.key === "expenses") return row.expenses;
      if (sort.key === "netProfit") return row.netProfit;
      return row.averageOrderValue;
    };

    return [...rows].sort((a, b) => {
      const aValue = getValue(a);
      const bValue = getValue(b);
      const direction = sort.direction === "asc" ? 1 : -1;

      if (typeof aValue === "string" && typeof bValue === "string") {
        return aValue.localeCompare(bValue) * direction;
      }

      if (aValue === bValue) {
        return a.locationName.localeCompare(b.locationName);
      }

      return (Number(aValue) - Number(bValue)) * direction;
    });
  }, [rows, sort]);
  const updateSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };
  return (
    <section className="shopops-section-card">
      <div className="shopops-section-card__header">
        <div>
          <h2>Location comparison</h2>
          <p>Compare commercial activity and profitability across stores.</p>
        </div>
      </div>
      <div className="shopops-data-table-scroll">
        <table className="shopops-data-table shopops-location-comparison-table">
          <thead>
            <tr>
              {(isFinancialMetricsV2 ? [] : legacyHeaders).map((header) => (
                <th
                  data-align={header.key === "location" ? "left" : "right"}
                  key={header.key}
                  title={header.title}
                >
                  <button
                    className="shopops-data-table__sort"
                    type="button"
                    onClick={() => updateSort(header.key)}
                  >
                    {header.label}
                    {sort.key === header.key
                      ? sort.direction === "desc"
                        ? "↓"
                        : "↑"
                      : ""}
                  </button>
                </th>
              ))}
              {isFinancialMetricsV2
                ? v2Headers.map((header) => (
                    <th
                      aria-sort={
                        sort.key === header.key
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      data-align={header.key === "location" ? "left" : "right"}
                      key={header.key}
                      title={header.title}
                    >
                      <button
                        className="shopops-data-table__sort"
                        type="button"
                        onClick={() => updateSort(header.key)}
                      >
                        <span>{header.label}</span>
                        <span
                          aria-hidden="true"
                          className="shopops-data-table__sort-indicator"
                          data-active={
                            sort.key === header.key ? "true" : "false"
                          }
                        >
                          {sort.key === header.key
                            ? sort.direction === "asc"
                              ? "↑"
                              : "↓"
                            : "↕"}
                        </span>
                      </button>
                    </th>
                  ))
                : null}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              sortedRows.map((row) => {
                const isSelected = selectedLocation === row.locationId;
                return isFinancialMetricsV2 ? (
                  <tr
                    data-selectable={onSelectLocation ? "true" : "false"}
                    data-selected={isSelected ? "true" : "false"}
                    key={row.locationId}
                    title="Filter charts by this location"
                    role={onSelectLocation ? "button" : undefined}
                    tabIndex={onSelectLocation ? 0 : undefined}
                    onClick={() => onSelectLocation?.(row)}
                    onKeyDown={(event) => {
                      if (!onSelectLocation) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectLocation(row);
                      }
                    }}
                  >
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                        textAlign: "left",
                      }}
                    >
                      <div className="shopops-data-table__primary">
                        <strong>{row.locationName}</strong>
                        {row.netProfit !== null && row.netProfit < 0 ? (
                          <StatusBadge variant="warning">
                            Negative net profit
                          </StatusBadge>
                        ) : null}
                        <LocationSalesBenchmark
                          averageRevenue={averageRevenue}
                          revenue={row.revenue}
                          totalRevenue={totalRevenue}
                        />
                      </div>
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.grossSales ?? 0)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.discounts ?? 0)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.returns ?? 0)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatNumber(row.returnedUnits ?? 0)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      <LocationSalesValue
                        maximumRevenue={maximumRevenue}
                        revenue={row.revenue}
                      />
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.refunds ?? 0)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatNumber(row.ordersCount)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatNumber(row.unitsSold)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.cogs)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {row.grossProfit === null
                        ? "—"
                        : formatCurrency(row.grossProfit)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatPercent(row.grossMarginPct)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.expenses)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {row.netProfit === null
                        ? "—"
                        : formatCurrency(row.netProfit)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.averageOrderValue)}
                    </td>
                  </tr>
                ) : (
                  <tr
                    data-selectable={onSelectLocation ? "true" : "false"}
                    data-selected={isSelected ? "true" : "false"}
                    key={row.locationId}
                    title="Filter charts by this location"
                    role={onSelectLocation ? "button" : undefined}
                    tabIndex={onSelectLocation ? 0 : undefined}
                    onClick={() => onSelectLocation?.(row)}
                    onKeyDown={(event) => {
                      if (!onSelectLocation) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectLocation(row);
                      }
                    }}
                  >
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                        textAlign: "left",
                      }}
                    >
                      <div className="shopops-data-table__primary">
                        <strong>{row.locationName}</strong>
                        {row.netProfit !== null && row.netProfit < 0 ? (
                          <StatusBadge variant="warning">
                            Negative net profit
                          </StatusBadge>
                        ) : null}
                        <LocationSalesBenchmark
                          averageRevenue={averageRevenue}
                          revenue={row.revenue}
                          totalRevenue={totalRevenue}
                        />
                      </div>
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      <LocationSalesValue
                        maximumRevenue={maximumRevenue}
                        revenue={row.revenue}
                      />
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatNumber(row.ordersCount)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatNumber(row.unitsSold)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.cogs)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {row.grossProfit === null
                        ? "—"
                        : formatCurrency(row.grossProfit)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatPercent(row.grossMarginPct)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.expenses)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {row.netProfit === null
                        ? "—"
                        : formatCurrency(row.netProfit)}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.averageOrderValue)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  className="shopops-data-table__empty"
                  colSpan={isFinancialMetricsV2 ? v2Headers.length : 10}
                >
                  No locations available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RankedBreakdownBars({
  rows,
  revenueLabel,
  itemLabel,
  selectedValue,
  onSelect,
}: {
  rows: RevenueBreakdownRow[];
  revenueLabel: string;
  itemLabel: string;
  selectedValue?: string | null;
  onSelect?: (row: RevenueBreakdownRow) => void;
}) {
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 0);

  return (
    <div className="shopops-vendor-bars">
      {rows.map((row) => {
        const canSelect = Boolean(onSelect) && row.value !== "Others";
        const isSelected = selectedValue === row.value;
        const width =
          maxRevenue > 0 && row.revenue > 0
            ? Math.max((row.revenue / maxRevenue) * 100, 2)
            : 0;

        return (
          <div
            className="shopops-chart-interactive shopops-vendor-row"
            key={row.value}
            title={[
              `${itemLabel}: ${row.label}`,
              `${revenueLabel}: ${formatCurrency(row.revenue)}`,
              `Percent: ${formatPercent(row.percent)}`,
              `Orders: ${formatNumber(row.ordersCount)}`,
              `Units: ${formatNumber(row.unitsSold)}`,
            ].join("\n")}
            role={canSelect ? "button" : undefined}
            tabIndex={canSelect ? 0 : undefined}
            onClick={() => {
              if (canSelect) onSelect?.(row);
            }}
            onKeyDown={(event) => {
              if (!canSelect) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect?.(row);
              }
            }}
            onMouseEnter={() => setHoveredValue(row.value)}
            onMouseLeave={() => setHoveredValue(null)}
            data-selectable={canSelect ? "true" : "false"}
            data-selected={isSelected ? "true" : "false"}
            data-hovered={hoveredValue === row.value ? "true" : "false"}
          >
            <span className="shopops-vendor-row__label">
              {row.label}
              {isSelected ? <small>Selected</small> : null}
            </span>
            <div aria-hidden="true" className="shopops-vendor-row__track">
              <div
                className="shopops-vendor-row__fill"
                style={{
                  width: `${width}%`,
                }}
              />
            </div>
            <span className="shopops-vendor-row__value">
              <strong>{formatCurrency(row.revenue)}</strong>
              <span className="shopops-vendor-row__percent">
                {formatPercent(row.percent)} share
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StaffLeaderboard({
  rows,
  revenueLabel,
  selectedValue,
  onSelect,
}: {
  rows: RevenueBreakdownRow[];
  revenueLabel: string;
  selectedValue?: string | null;
  onSelect?: (row: RevenueBreakdownRow) => void;
}) {
  const [sort, setSort] = useState<{
    key: "staff" | "revenue" | "orders";
    direction: "asc" | "desc";
  }>({ key: "revenue", direction: "desc" });
  const sortedRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const direction = sort.direction === "asc" ? 1 : -1;
        const leftValue =
          sort.key === "staff"
            ? left.label
            : sort.key === "orders"
              ? left.ordersCount
              : left.revenue;
        const rightValue =
          sort.key === "staff"
            ? right.label
            : sort.key === "orders"
              ? right.ordersCount
              : right.revenue;
        return typeof leftValue === "string" && typeof rightValue === "string"
          ? leftValue.localeCompare(rightValue) * direction
          : (Number(leftValue) - Number(rightValue)) * direction;
      }),
    [rows, sort],
  );
  const updateSort = (key: "staff" | "revenue" | "orders") => {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };
  const headers = [
    { label: "Rank", key: null },
    { label: "Staff", key: "staff" as const },
    { label: revenueLabel, key: "revenue" as const },
    { label: "Orders", key: "orders" as const },
  ];

  return (
    <div className="shopops-staff-leaderboard" style={{ overflowX: "auto" }}>
      <table
        aria-label={`Ranked staff by ${revenueLabel.toLocaleLowerCase()}`}
        style={{
          borderCollapse: "collapse",
          minWidth: 480,
          tableLayout: "fixed",
          width: "100%",
        }}
      >
        <colgroup>
          <col style={{ width: 44 }} />
          <col />
          <col style={{ width: 120 }} />
          <col style={{ width: 64 }} />
        </colgroup>
        <thead>
          <tr>
            {headers.map((header, index) => (
              <th
                aria-sort={
                  header.key && sort.key === header.key
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                key={header.label}
                scope="col"
                style={{
                  borderBottom: "1px solid #dfe3e8",
                  borderLeft: index === 0 ? "3px solid transparent" : undefined,
                  color: "#6b7280",
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "0 10px 8px",
                  textAlign: index >= 2 ? "right" : "left",
                  textTransform: "uppercase",
                }}
              >
                {header.key ? (
                  <button
                    className="shopops-data-table__sort"
                    onClick={() => updateSort(header.key!)}
                    type="button"
                  >
                    <span>{header.label}</span>
                    <span
                      aria-hidden="true"
                      className="shopops-data-table__sort-indicator"
                      data-active={sort.key === header.key ? "true" : "false"}
                    >
                      {sort.key === header.key
                        ? sort.direction === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </span>
                  </button>
                ) : (
                  header.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => {
            const canSelect = Boolean(onSelect) && row.value !== "Others";
            const isSelected = selectedValue === row.value;
            const detailLabel = [
              `Rank ${index + 1}`,
              `Staff: ${row.label}`,
              `${revenueLabel}: ${formatCurrency(row.revenue)}`,
              `Orders: ${formatNumber(row.ordersCount)}`,
              `Units: ${formatNumber(row.unitsSold)}`,
            ].join(". ");

            return (
              <tr
                className="shopops-staff-leaderboard-row"
                data-selectable={canSelect}
                data-selected={isSelected}
                key={row.value}
                style={{ background: isSelected ? "#eff6ff" : "white" }}
              >
                <td
                  style={{
                    borderBottom: "1px solid #edf0f2",
                    borderLeft: `3px solid ${
                      isSelected ? "#2563eb" : "transparent"
                    }`,
                    color: "#6b7280",
                    fontSize: 13,
                    fontWeight: 700,
                    height: 50,
                    padding: "8px 10px",
                  }}
                >
                  {row.value === "Others" ? "—" : index + 1}
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #edf0f2",
                    overflow: "hidden",
                    padding: "8px 10px",
                  }}
                >
                  {canSelect ? (
                    <button
                      aria-label={detailLabel}
                      aria-pressed={isSelected}
                      className="shopops-staff-leaderboard__staff-button"
                      onClick={() => onSelect?.(row)}
                      title={row.label}
                      type="button"
                    >
                      {row.label === "Unassigned" ? (
                        <span className="shopops-staff-leaderboard__badge">
                          Unassigned
                        </span>
                      ) : (
                        <span className="shopops-staff-leaderboard__staff-name">
                          {row.label}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span
                      className="shopops-staff-leaderboard__staff-name"
                      title={row.label}
                    >
                      {row.label}
                    </span>
                  )}
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #edf0f2",
                    color: "#202223",
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 800,
                    padding: "8px 10px",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCurrency(row.revenue)}
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #edf0f2",
                    color: "#4b5563",
                    fontSize: 13,
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 700,
                    padding: "8px 10px",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatNumber(row.ordersCount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RevenueByVendorCard({
  rows,
  financialMetricsVersion,
  selectedVendor,
  onSelectVendor,
}: {
  rows: RevenueBreakdownRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  selectedVendor?: string | null;
  onSelectVendor?: (row: RevenueBreakdownRow) => void;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const revenueLabel = isFinancialMetricsV2 ? "Product sales" : "Revenue";
  const hasRevenue = rows.some((row) => row.revenue > 0);

  return (
    <section className="shopops-section-card shopops-location-chart-card">
      <div className="shopops-section-card__header">
        <div>
          <h2>
            {isFinancialMetricsV2
              ? "Product sales by vendor"
              : "Revenue by vendor"}
          </h2>
          <p>
            Ranked {revenueLabel.toLocaleLowerCase()} for the current filters.
          </p>
        </div>
      </div>

      {hasRevenue ? (
        <RankedBreakdownBars
          rows={rows}
          revenueLabel={revenueLabel}
          itemLabel="Vendor"
          selectedValue={selectedVendor}
          onSelect={onSelectVendor}
        />
      ) : (
        <div className="shopops-chart-empty">
          No vendor {revenueLabel.toLocaleLowerCase()} available for this
          period.
        </div>
      )}
    </section>
  );
}

function RevenueByStaffCard({
  rows,
  financialMetricsVersion,
  selectedStaff,
  onSelectStaff,
}: {
  rows: RevenueBreakdownRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  selectedStaff?: string | null;
  onSelectStaff?: (row: RevenueBreakdownRow) => void;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const revenueLabel = isFinancialMetricsV2 ? "Product sales" : "Revenue";
  const hasRevenue = rows.some((row) => row.revenue > 0);

  return (
    <section className="shopops-section-card shopops-location-chart-card">
      <div className="shopops-section-card__header">
        <div>
          <h2>
            {isFinancialMetricsV2
              ? "Product sales by staff"
              : "Revenue by staff"}
          </h2>
          <p>
            Ranked {revenueLabel.toLocaleLowerCase()} for the current filters.
          </p>
        </div>
      </div>

      {hasRevenue ? (
        <StaffLeaderboard
          rows={rows}
          revenueLabel={revenueLabel}
          selectedValue={selectedStaff}
          onSelect={onSelectStaff}
        />
      ) : (
        <div className="shopops-chart-empty">
          No staff {revenueLabel.toLocaleLowerCase()} available for this period.
        </div>
      )}
    </section>
  );
}

function RevenueBreakdownSection({
  revenueByVendor,
  revenueByStaff,
  financialMetricsVersion,
  activeDrilldowns,
  onSelectVendor,
  onSelectStaff,
}: {
  revenueByVendor: RevenueBreakdownRow[];
  revenueByStaff: RevenueBreakdownRow[];
  financialMetricsVersion: FinancialMetricsVersion;
  activeDrilldowns: ActiveLocationDrilldowns;
  onSelectVendor: (row: RevenueBreakdownRow) => void;
  onSelectStaff: (row: RevenueBreakdownRow) => void;
}) {
  return (
    <>
      {financialMetricsVersion === "v2" ? (
        <p className="shopops-section-intro">
          Product sales include discounts and merchandise returns but exclude
          order-level cash refunds, which cannot be assigned reliably to a
          vendor or staff member.
        </p>
      ) : null}
      <div className="shopops-breakdown-grid">
        <RevenueByVendorCard
          rows={revenueByVendor}
          financialMetricsVersion={financialMetricsVersion}
          selectedVendor={activeDrilldowns.vendor?.value ?? null}
          onSelectVendor={onSelectVendor}
        />
        <RevenueByStaffCard
          rows={revenueByStaff}
          financialMetricsVersion={financialMetricsVersion}
          selectedStaff={activeDrilldowns.staff?.value ?? null}
          onSelectStaff={onSelectStaff}
        />
      </div>
    </>
  );
}

function ActiveLocationsDrilldownChips({
  activeDrilldowns,
  onClearOne,
  onClearAll,
}: {
  activeDrilldowns: ActiveLocationDrilldowns;
  onClearOne: (key: keyof ActiveLocationDrilldowns) => void;
  onClearAll: () => void;
}) {
  const chips: Array<{
    key: keyof ActiveLocationDrilldowns;
    label: string;
    value: string;
  }> = [];

  if (activeDrilldowns.period) {
    chips.push({
      key: "period",
      label: "Period",
      value: activeDrilldowns.period.label,
    });
  }
  if (activeDrilldowns.vendor) {
    chips.push({
      key: "vendor",
      label: "Vendor",
      value: activeDrilldowns.vendor.label,
    });
  }
  if (activeDrilldowns.staff) {
    chips.push({
      key: "staff",
      label: "Staff",
      value: activeDrilldowns.staff.label,
    });
  }
  if (activeDrilldowns.location) {
    chips.push({
      key: "location",
      label: "Location",
      value: activeDrilldowns.location.label,
    });
  }

  return (
    <ShopOpsDrilldownBar
      chips={chips}
      onClearAll={onClearAll}
      onClearOne={onClearOne}
    />
  );
}

function ReportingLocationsPage({ data }: { data: ReportingLoaderData }) {
  const actionData = useActionData<ReportingActionData>();
  const navigation = useNavigation();
  const isSaving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "save-reporting-locations";
  const usage =
    data.limit === null
      ? `${data.usage} reporting ${data.usage === 1 ? "location" : "locations"}`
      : `${data.usage} of ${data.limit} reporting ${data.limit === 1 ? "location" : "locations"}`;

  return (
    <ShopOpsPage>
      <PageHeader
        description="Review location performance and choose which locations appear in ShopOps."
        icon={LocationIcon}
        title="Compare Locations"
      />
      <SectionTabs
        activeTab="reporting"
        ariaLabel="Locations sections"
        tabs={[
          { value: "performance", label: "Performance" },
          { value: "reporting", label: "Reporting locations" },
        ]}
      />
      <ContentCard
        title="Reporting locations"
        description="Shopify locations remain detected and synchronized. Choose which locations appear in ShopOps reporting. Historical data is retained when a location is disabled."
      >
        <p style={{ fontWeight: 800, margin: "0 0 16px" }}>{usage}</p>
        {actionData ? (
          <InlineNotice tone={actionData.ok ? "success" : "critical"}>
            {actionData.message}
          </InlineNotice>
        ) : null}
        <Form method="post">
          <input name="intent" type="hidden" value="save-reporting-locations" />
          <div
            className="shopops-selectable-grid"
            style={{ marginTop: actionData ? 16 : 0 }}
          >
            {data.locations.map((reportingLocation) => (
              <SelectableCard
                key={reportingLocation.id}
                input={{
                  "aria-label": `Include ${reportingLocation.name} in ShopOps reporting`,
                  defaultChecked:
                    reportingLocation.shopifyIsActive &&
                    reportingLocation.reportingEnabled,
                  disabled: !reportingLocation.shopifyIsActive,
                  name: "location_ids",
                  type: "checkbox",
                  value: reportingLocation.shopifyLocationId,
                }}
              >
                <strong>{reportingLocation.name}</strong>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  <StatusBadge
                    variant={
                      reportingLocation.shopifyIsActive ? "success" : "neutral"
                    }
                  >
                    Shopify{" "}
                    {reportingLocation.shopifyIsActive ? "active" : "inactive"}
                  </StatusBadge>
                  <StatusBadge
                    variant={
                      reportingLocation.reportingEnabled ? "info" : "neutral"
                    }
                  >
                    {reportingLocation.reportingEnabled
                      ? "Currently included"
                      : "Not included"}
                  </StatusBadge>
                </span>
                <span className="shopops-helper-text" style={{ margin: 0 }}>
                  {reportingLocation.shopifyIsActive
                    ? "Available for ShopOps reporting."
                    : "Reactivate this location in Shopify before selecting it."}
                </span>
              </SelectableCard>
            ))}
          </div>
          {data.locations.length === 0 ? (
            <EmptyState
              title="No Shopify locations detected yet."
              description="Locations will appear here after Shopify data sync completes."
            />
          ) : null}
          <FormActions>
            <AppButtonLink
              fullWidth
              to="/app/settings?tab=plan"
              variant="secondary"
            >
              Review plan &amp; billing
            </AppButtonLink>
            <AppButton
              disabled={isSaving}
              fullWidth
              type="submit"
              variant="primary"
            >
              {isSaving ? "Saving..." : "Save reporting locations"}
            </AppButton>
          </FormActions>
        </Form>
      </ContentCard>
    </ShopOpsPage>
  );
}

export default function LocationsPage() {
  const data = useLoaderData<LoaderData | ReportingLoaderData>();
  return data.view === "reporting" ? (
    <ReportingLocationsPage data={data} />
  ) : (
    <LocationPerformancePage data={data} />
  );
}

function LocationPerformancePage({ data }: { data: LoaderData }) {
  const location = useLocation();
  const navigation = useNavigation();
  const dataSyncPath = data.canManageSync
    ? getDataSyncPath(location.search)
    : null;
  const {
    locations,
    selectedLocationIds,
    selectedStaff,
    selectedVendor,
    staffOptions,
    vendorOptions,
    startDate,
    endDate,
    isTodayRange,
    preservedSearchParams,
    lastSuccessfulSync,
    kpis,
    hasOperatingExpenses,
    financialMetricsVersion,
    locationRows,
    salesRows,
    refundTransactions,
    period,
    debugInfo,
  } = data;
  const [draftLocationIds, setDraftLocationIds] = useState(selectedLocationIds);
  const [isDirty, setIsDirty] = useState(false);
  const isApplyingFilters =
    navigation.state !== "idle" &&
    navigation.formMethod === "GET" &&
    navigation.location?.pathname === location.pathname;
  const isApplyingToday =
    isApplyingFilters && navigation.formData?.get("preset") === "today";
  const [activeDrilldowns, setActiveDrilldowns] =
    useState<ActiveLocationDrilldowns>({});
  const allLocationsLabel = data.canManageReportingLocations
    ? "All locations"
    : "All assigned locations";
  const drilldownResetKey = buildDrilldownResetKey({
    startDate,
    endDate,
    period,
    locationIds: selectedLocationIds,
    staff: selectedStaff,
    vendor: selectedVendor,
  });
  useEffect(() => {
    setDraftLocationIds(selectedLocationIds);
    setIsDirty(false);
  }, [selectedLocationIds]);
  useEffect(() => {
    setActiveDrilldowns({});
  }, [drilldownResetKey]);
  const allLocationsSelected = draftLocationIds.length === locations.length;
  const locationSummary = allLocationsSelected
    ? allLocationsLabel
    : draftLocationIds.length === 1
      ? locations.find(
          (location) => location.shopify_location_id === draftLocationIds[0],
        )?.name || "1 location selected"
      : `${draftLocationIds.length} locations selected`;
  const selectedLocationsForMetrics = useMemo(
    () =>
      locations.filter((location) =>
        selectedLocationIds.includes(location.shopify_location_id),
      ),
    [locations, selectedLocationIds],
  );
  const expensesByLocation = useMemo(
    () =>
      new Map(
        locationRows.map((row) => [row.locationId, row.expenses] as const),
      ),
    [locationRows],
  );
  const drilldownRows = useMemo(
    () =>
      applyLocationDrilldowns({
        orderLines: salesRows,
        activeDrilldowns,
        period,
      }),
    [salesRows, activeDrilldowns, period],
  );
  const hasActiveDrilldowns = Boolean(
    activeDrilldowns.period ||
    activeDrilldowns.vendor ||
    activeDrilldowns.staff ||
    activeDrilldowns.location,
  );
  const locationsForDrilldownMetrics = useMemo(() => {
    if (!hasActiveDrilldowns) return selectedLocationsForMetrics;

    const locationIdsWithRows = new Set(
      drilldownRows
        .map((row) => row.retail_location_id)
        .filter((value): value is string => Boolean(value)),
    );

    return selectedLocationsForMetrics.filter((location) =>
      activeDrilldowns.location
        ? location.shopify_location_id === activeDrilldowns.location.value
        : locationIdsWithRows.has(location.shopify_location_id),
    );
  }, [
    activeDrilldowns.location,
    drilldownRows,
    hasActiveDrilldowns,
    selectedLocationsForMetrics,
  ]);
  const drilldownTrendRows = useMemo(
    () =>
      computeTrendRows({
        orderLines: drilldownRows,
        refundTransactions,
        startDate,
        endDate,
        period,
        financialMetricsVersion,
      }).rows,
    [
      drilldownRows,
      refundTransactions,
      startDate,
      endDate,
      period,
      financialMetricsVersion,
    ],
  );
  const drilldownRevenueByVendor = useMemo(
    () =>
      computeRevenueBreakdown({
        orderLines: drilldownRows,
        limit: 7,
        getLabel: getVendorDrilldownValue,
        getValue: getVendorDrilldownValue,
      }),
    [drilldownRows],
  );
  const drilldownRevenueByStaff = useMemo(
    () =>
      computeRevenueBreakdown({
        orderLines: drilldownRows,
        limit: 7,
        getLabel: getStaffDrilldownLabel,
        getValue: getStaffDrilldownValue,
      }),
    [drilldownRows],
  );
  const drilldownLocationRows = useMemo(
    () =>
      computeMetrics({
        locations: locationsForDrilldownMetrics,
        orderLines: drilldownRows,
        expensesByLocation,
        financialMetricsVersion,
        refundsByLocation: allocateRefundsByLocation({
          orderLines: drilldownRows,
          refundTransactions,
        }),
      }).rows,
    [
      locationsForDrilldownMetrics,
      drilldownRows,
      expensesByLocation,
      financialMetricsVersion,
      refundTransactions,
    ],
  );
  const toggleDrilldown = (
    key: keyof ActiveLocationDrilldowns,
    next: { value: string; label: string },
  ) => {
    setActiveDrilldowns((current) => ({
      ...current,
      [key]: current[key]?.value === next.value ? null : next,
    }));
  };
  const hasNoSyncedLocations = locations.length === 0;
  const isDataPreparing = !lastSuccessfulSync && salesRows.length === 0;
  const hasNoSalesForRange =
    !hasNoSyncedLocations && !isDataPreparing && salesRows.length === 0;
  const shouldShowAnalytics = !hasNoSyncedLocations && !isDataPreparing;

  return (
    <ShopOpsPage className="shopops-locations-page">
      <style>{`
        .shopops-chart-interactive:focus-visible {
          outline: 3px solid #93c5fd !important;
          outline-offset: 2px;
        }
        .shopops-period-segmented-scroll {
          max-width: 100%;
          overflow-x: auto;
          scrollbar-color: #cbd5e1 transparent;
          scrollbar-width: thin;
        }
        .shopops-period-segmented {
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 9px;
          display: inline-flex;
          overflow: hidden;
          padding: 2px;
          white-space: nowrap;
        }
        .shopops-period-segmented__option {
          cursor: pointer;
          position: relative;
        }
        .shopops-period-segmented__option input {
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          height: 1px;
          overflow: hidden;
          position: absolute;
          white-space: nowrap;
          width: 1px;
        }
        .shopops-period-segmented__option span {
          border-radius: 6px;
          color: #616161;
          display: block;
          font-size: 12px;
          line-height: 1;
          padding: 7px 10px;
        }
        .shopops-period-segmented__option input:checked + span {
          background: white;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
          color: #1d4ed8;
          font-weight: 800;
        }
        .shopops-period-segmented__option input:focus-visible + span {
          outline: 3px solid #93c5fd;
          outline-offset: -1px;
        }
        .shopops-staff-leaderboard-row[data-selectable="true"][data-selected="false"]:hover {
          background: #f8fafc !important;
        }
        .shopops-staff-leaderboard__staff-button {
          align-items: center;
          background: transparent;
          border: 0;
          color: #202223;
          cursor: pointer;
          display: flex;
          font: inherit;
          font-size: 13px;
          font-weight: 800;
          gap: 7px;
          max-width: 100%;
          padding: 5px 0;
          text-align: left;
        }
        .shopops-staff-leaderboard__staff-button:focus-visible {
          outline: 3px solid #93c5fd;
          outline-offset: 2px;
        }
        .shopops-staff-leaderboard__staff-name {
          color: #202223;
          display: block;
          font-size: 13px;
          font-weight: 800;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .shopops-staff-leaderboard__badge {
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 999px;
          color: #6b7280;
          flex: 0 0 auto;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
        }
        @media (max-width: 1100px) {
          .shopops-breakdown-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .shopops-location-chart-card {
            padding: 16px !important;
          }
        }
      `}</style>
      <PageHeader
        description={
          data.canManageReportingLocations
            ? "Review location performance and choose which locations appear in ShopOps."
            : "Review performance for assigned reporting locations."
        }
        icon={LocationIcon}
        title="Compare Locations"
      />
      {data.dashboardAccessNotice ? (
        <PageNotice
          cta={{ to: "/app/locations", label: "View locations" }}
          title="Overview access is not included"
          message="Your ShopOps role provides access to assigned locations only."
          tone="info"
        />
      ) : null}
      <SectionTabs
        activeTab="performance"
        ariaLabel="Locations sections"
        tabs={[
          { value: "performance", label: "Performance" },
          ...(data.canManageReportingLocations
            ? [
                {
                  value: "reporting" as const,
                  label: "Reporting locations",
                },
              ]
            : []),
        ]}
      />
      <ContentCard className="shopops-dashboard-filter-card">
        <ReportFilterPanel
          actions={
            <>
              <AppButton
                type="submit"
                name="preset"
                value="today"
                variant="secondary"
                onClick={() => setIsDirty(false)}
                disabled={isApplyingFilters}
              >
                {isApplyingToday ? "Applying today..." : "Today"}
              </AppButton>
              <AppButton
                type="submit"
                variant="primary"
                onClick={() => setIsDirty(false)}
                disabled={isApplyingFilters}
              >
                {isApplyingFilters && !isApplyingToday
                  ? "Applying..."
                  : "Apply"}
              </AppButton>
            </>
          }
          changed={isDirty}
          hiddenFields={
            <input
              type="hidden"
              name="locations"
              value={allLocationsSelected ? "" : draftLocationIds.join(",")}
            />
          }
          id="locations-filter-form"
          onSubmit={() => setIsDirty(false)}
          preservedSearchParams={preservedSearchParams}
        >
          <ReportFilterField htmlFor="locations-start-date" label="Start date">
            <input
              className="shopops-report-filter-control"
              id="locations-start-date"
              name="startDate"
              type="date"
              defaultValue={startDate}
              onChange={() => setIsDirty(true)}
            />
          </ReportFilterField>
          <ReportFilterField htmlFor="locations-end-date" label="End date">
            <input
              className="shopops-report-filter-control"
              id="locations-end-date"
              name="endDate"
              type="date"
              defaultValue={endDate}
              onChange={() => setIsDirty(true)}
            />
          </ReportFilterField>
          <ReportFilterField htmlFor="locations-staff" label="Staff">
            <select
              className="shopops-report-filter-control"
              id="locations-staff"
              name="staff"
              defaultValue={selectedStaff}
              onChange={() => setIsDirty(true)}
            >
              <option value="">All staff</option>
              {staffOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ReportFilterField>
          <ReportFilterField htmlFor="locations-vendor" label="Vendor">
            <select
              className="shopops-report-filter-control"
              id="locations-vendor"
              name="vendor"
              defaultValue={selectedVendor}
              onChange={() => setIsDirty(true)}
            >
              <option value="">All vendors</option>
              {vendorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </ReportFilterField>

          <ReportFilterField
            helper={locations.length > 1 ? locationSummary : undefined}
            label={locations.length > 1 ? "Locations" : "Location"}
            wide={locations.length > 1}
          >
            {locations.length > 1 ? (
              <div className="shopops-report-filter-options">
                <button
                  aria-pressed={allLocationsSelected}
                  className="shopops-report-filter-option"
                  data-selected={allLocationsSelected ? "true" : "false"}
                  type="button"
                  onClick={() => {
                    setDraftLocationIds(
                      locations.map((location) => location.shopify_location_id),
                    );
                    setIsDirty(true);
                  }}
                >
                  {allLocationsSelected ? (
                    <span aria-hidden="true">✓</span>
                  ) : null}
                  {allLocationsLabel}
                </button>
                {locations.map((location) => (
                  <label
                    className="shopops-report-filter-option"
                    data-selected={
                      draftLocationIds.includes(location.shopify_location_id)
                        ? "true"
                        : "false"
                    }
                    key={location.shopify_location_id}
                  >
                    <input
                      type="checkbox"
                      checked={draftLocationIds.includes(
                        location.shopify_location_id,
                      )}
                      onChange={(event) => {
                        setDraftLocationIds((current) =>
                          event.target.checked
                            ? Array.from(
                                new Set([
                                  ...current,
                                  location.shopify_location_id,
                                ]),
                              )
                            : current.filter(
                                (id) => id !== location.shopify_location_id,
                              ),
                        );
                        setIsDirty(true);
                      }}
                    />
                    {location.name}
                  </label>
                ))}
              </div>
            ) : (
              <ReadOnlyReportLocation
                helper={
                  !data.canManageReportingLocations && locations.length === 1
                    ? "Restricted by your ShopOps access."
                    : locations.length === 1
                      ? "Only reporting location."
                      : "No reporting location is available."
                }
                value={locations[0]?.name ?? "No location access"}
              />
            )}
          </ReportFilterField>
        </ReportFilterPanel>
      </ContentCard>

      <p className="shopops-data-scope-note">
        Expenses include active location-specific amounts. Global expenses are
        shared equally across all active locations.
        {financialMetricsVersion === "v2"
          ? " Refunds are order-level cash movements allocated to locations from matching order lines."
          : ""}
      </p>

      {debugInfo ? (
        <details className="shopops-support-diagnostics">
          <summary>Support diagnostics</summary>
          <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
        </details>
      ) : null}

      {hasNoSyncedLocations ? (
        <PageNotice
          title="Your data is being prepared"
          message="No locations have synced yet. Location reports appear after Shopify data sync completes."
          bullets={[
            data.canManageSync
              ? "Open Sync Status to confirm whether locations, products, inventory, and orders have synced."
              : "Ask an Admin to confirm whether Shopify data has synced.",
            "Location reporting becomes useful once Shopify data is available.",
          ]}
          cta={
            dataSyncPath
              ? { to: dataSyncPath, label: "Open Sync Status" }
              : undefined
          }
          tone="info"
        />
      ) : isDataPreparing ? (
        <PageNotice
          title="Your data is being prepared"
          message="Reports appear after Shopify data sync completes."
          bullets={[
            "Location comparisons populate after successful sync runs create sales rows.",
            "ShopOps Studio uses synced Shopify data to report sales, margins, inventory, staff attribution, expenses, refunds, returns, and sync health.",
          ]}
          cta={
            dataSyncPath
              ? { to: dataSyncPath, label: "Open Sync Status" }
              : undefined
          }
          tone="info"
        />
      ) : hasNoSalesForRange ? (
        <CompactEmptyDataNotice
          title={
            isTodayRange
              ? "No sales yet today."
              : "No sales for this date range."
          }
          guidance={
            isTodayRange
              ? "Sales will appear here as today's Shopify orders are synced."
              : "Try another date range or confirm sync status."
          }
          action={
            dataSyncPath ? (
              <AppButtonLink compact to={dataSyncPath} variant="secondary">
                Open Sync Status
              </AppButtonLink>
            ) : undefined
          }
        />
      ) : null}

      {shouldShowAnalytics ? (
        isApplyingFilters ? (
          <LocationsContentSkeleton />
        ) : (
          <>
            <KpiGrid
              kpis={kpis}
              comparisonKpis={data.comparisonKpis}
              selectedDays={data.selectedDays}
              financialMetricsVersion={financialMetricsVersion}
              hasOperatingExpenses={hasOperatingExpenses}
              canManageCosts={data.canManageCosts}
            />
            <ActiveLocationsDrilldownChips
              activeDrilldowns={activeDrilldowns}
              onClearOne={(key) =>
                setActiveDrilldowns((current) => ({
                  ...current,
                  [key]: null,
                }))
              }
              onClearAll={() => setActiveDrilldowns({})}
            />
            <TrendChart
              rows={drilldownTrendRows}
              period={period}
              financialMetricsVersion={financialMetricsVersion}
              onFilterChange={() => setIsDirty(true)}
              selectedPeriod={activeDrilldowns.period?.value ?? null}
              onSelectPeriod={(row) =>
                toggleDrilldown("period", {
                  value: row.period,
                  label: row.period,
                })
              }
            />
            <RevenueBreakdownSection
              revenueByVendor={drilldownRevenueByVendor}
              revenueByStaff={drilldownRevenueByStaff}
              financialMetricsVersion={financialMetricsVersion}
              activeDrilldowns={activeDrilldowns}
              onSelectVendor={(row) =>
                toggleDrilldown("vendor", {
                  value: row.value,
                  label: row.label,
                })
              }
              onSelectStaff={(row) =>
                toggleDrilldown("staff", {
                  value: row.value,
                  label: row.label,
                })
              }
            />
            <LocationTable
              rows={drilldownLocationRows}
              financialMetricsVersion={financialMetricsVersion}
              selectedLocation={activeDrilldowns.location?.value ?? null}
              onSelectLocation={(row) =>
                toggleDrilldown("location", {
                  value: row.locationId,
                  label: row.locationName,
                })
              }
            />
          </>
        )
      ) : null}
    </ShopOpsPage>
  );
}
