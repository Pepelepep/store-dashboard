import type { LoaderFunctionArgs } from "react-router";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Link,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";

import { AppButton } from "../components/ui/AppButton";
import { NetSalesTrendPlot } from "../components/dashboard/NetSalesTrendPlot";
import { PageNotice } from "../components/ui/PageNotice";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { getDataSyncPath } from "../lib/navigation/sync-status";
import { getPermissionContext } from "../lib/auth/permissions.server";
import {
  getAccessibleLocationRows,
  hasNoAssignedLocationAccess,
} from "../lib/auth/location-performance-access";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { fetchAllSupabasePages } from "../lib/db/supabase-pagination.server";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
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

type SortKey =
  | "location"
  | "revenue"
  | "orders"
  | "units"
  | "cogs"
  | "grossProfit"
  | "grossMargin"
  | "expenses"
  | "netProfit"
  | "aov";

type LoaderData = {
  locations: LocationRow[];
  selectedLocationIds: string[];
  selectedStaff: string;
  selectedVendor: string;
  staffOptions: DashboardFilterOption[];
  vendorOptions: DashboardFilterOption[];
  startDate: string;
  endDate: string;
  preservedSearchParams: Array<{ name: string; value: string }>;
  lastSuccessfulSync: string | null;
  selectedDays: number;
  period: Period;
  kpis: Omit<LocationMetricRow, "locationId" | "locationName">;
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

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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
  const rows: OrderTransactionDbRow[] = [];

  for (const batch of chunkArray(orderIds, 500)) {
    const batchRows = await fetchAllSupabasePages<OrderTransactionDbRow>({
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
          .in("shopify_order_id", batch)
          .order("processed_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: OrderTransactionDbRow[] | null;
          error: { message: string } | null;
        }>,
    });

    rows.push(...batchRows.filter(isSuccessfulRefundTransaction));
  }

  return rows;
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

function getPeriodLabel(periodKey: string, period: Period) {
  if (period === "day") return periodKey.slice(5);
  if (period === "week") return periodKey.replace(/^(\d{4})-W/, "W");
  if (period === "month") return periodKey.slice(5);
  return periodKey;
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
        label: getPeriodLabel(key, period),
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
  const permissions = await getPermissionContext({
    request,
    session,
    supabase,
  });
  const url = new URL(request.url);
  const shouldShowDebugInfo =
    url.searchParams.get("debug") === "1" && permissions.isAdmin;
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
    url.searchParams
      .getAll("locations")
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
        .eq("is_active", true)
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: Array<LocationRow & { id: string }> | null;
        error: { message: string } | null;
      }>,
  });
  const accessibleLocations = getAccessibleLocationRows({
    locations: allLocations,
    isAdmin: permissions.isAdmin,
    allowedLocationIds: permissions.allowedLocationIds,
  });

  if (
    hasNoAssignedLocationAccess({
      activeLocationCount: allLocations.length,
      accessibleLocationCount: accessibleLocations.length,
      isAdmin: permissions.isAdmin,
    })
  ) {
    throw new Response("Forbidden: no location access configured", {
      status: 403,
    });
  }

  const selectedLocations =
    requestedLocationIds.size > 0
      ? accessibleLocations.filter((location) =>
          requestedLocationIds.has(location.shopify_location_id),
        )
      : accessibleLocations;
  const safeSelectedLocations =
    selectedLocations.length > 0 ? selectedLocations : accessibleLocations;
  const selectedLocationIds = safeSelectedLocations.map(
    (location) => location.shopify_location_id,
  );
  const selectedLocationIdSet = new Set(selectedLocationIds);
  const isAllAccessibleLocationsSelected =
    selectedLocationIds.length === accessibleLocations.length &&
    accessibleLocations.every((location) =>
      selectedLocationIdSet.has(location.shopify_location_id),
    );
  const shouldFilterOrderLinesByLocation =
    !permissions.isAdmin || !isAllAccessibleLocationsSelected;

  const [orderLinesResult, expenses] = await Promise.all([
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
  const staffAliasesByKey = await fetchStaffIdentityAliasesForOrderLines({
    supabase,
    shop: session.shop,
    orderLines: rawOrderLines,
  });
  const orderLines = rawOrderLines.map((row) => {
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
  });
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
  const salesRows: LocationsSalesRow[] = filteredOrderLines.map((row) => ({
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
  const orderIdsForRefunds = Array.from(
    new Set(
      salesRows
        .map((row) => row.shopify_order_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const refundTransactions =
    isFinancialMetricsV2 && orderIdsForRefunds.length > 0
      ? await fetchRefundTransactionsForOrders({
          supabase,
          shop: session.shop,
          orderIds: orderIdsForRefunds,
          startDateUtc,
          endExclusiveUtc,
        })
      : [];
  const refundsByLocation = isFinancialMetricsV2
    ? allocateRefundsByLocation({
        orderLines: salesRows,
        refundTransactions,
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
  const selectedExpensesByLocation = new Map(
    selectedLocationIds.map((locationId) => [
      locationId,
      expensesByLocation.get(locationId) ?? 0,
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
    locations: accessibleLocations,
    selectedLocationIds,
    selectedStaff,
    selectedVendor,
    staffOptions,
    vendorOptions,
    startDate,
    endDate,
    preservedSearchParams,
    lastSuccessfulSync: lastSuccessfulSyncRun?.finished_at ?? null,
    selectedDays,
    period,
    financialMetricsVersion,
    kpis,
    hasOperatingExpenses: expenses.length > 0,
    locationRows: metrics.rows,
    trendRows: trend.rows,
    revenueByVendor,
    revenueByStaff,
    salesRows,
    refundTransactions,
    debugInfo,
  } satisfies LoaderData;
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

function KpiGrid({
  kpis,
  financialMetricsVersion,
  hasOperatingExpenses,
}: {
  kpis: LoaderData["kpis"];
  financialMetricsVersion: FinancialMetricsVersion;
  hasOperatingExpenses: boolean;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const location = useLocation();
  const setupSearch = new URLSearchParams(location.search);
  setupSearch.set("tab", "product-costs");
  const productCostsPath = `/app/admin/setup?${setupSearch.toString()}`;
  const expensesSearch = new URLSearchParams(location.search);
  expensesSearch.set("tab", "expenses");
  const expensesPath = `/app/admin/setup?${expensesSearch.toString()}`;
  const grossProfitNotice = kpis.cogsIncomplete ? (
    <div
      role="status"
      style={{
        background: "#fff8e5",
        border: "1px solid #e5c07b",
        borderRadius: 8,
        color: "#5c4813",
        fontSize: 12,
        marginTop: 8,
        padding: "7px 8px",
      }}
    >
      <div>
        {formatNumber(kpis.missingCogsLineCount)} sales{" "}
        {kpis.missingCogsLineCount === 1 ? "line is" : "lines are"} missing
        product costs.
      </div>
      <Link
        style={{ color: "#1d4ed8", display: "inline-block", marginTop: 4 }}
        to={productCostsPath}
      >
        Review product costs
      </Link>
    </div>
  ) : kpis.includesEstimatedCogs ? (
    <div
      role="status"
      style={{
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: 8,
        color: "#1e3a5f",
        fontSize: 12,
        marginTop: 8,
        padding: "7px 8px",
      }}
    >
      <div>Includes estimated product costs</div>
      <Link
        style={{ color: "#1d4ed8", display: "inline-block", marginTop: 4 }}
        to={productCostsPath}
      >
        Review product costs
      </Link>
    </div>
  ) : null;
  const expensesNotice = !hasOperatingExpenses ? (
    <div
      role="status"
      style={{
        background: "#f8fafc",
        border: "1px solid #d9dee5",
        borderRadius: 8,
        color: "#4b5563",
        fontSize: 12,
        marginTop: 8,
        padding: "7px 8px",
      }}
    >
      <div>No operating expenses configured.</div>
      <Link
        style={{ color: "#1d4ed8", display: "inline-block", marginTop: 4 }}
        to={expensesPath}
      >
        Add expenses
      </Link>
    </div>
  ) : null;
  const items: Array<{
    label: string;
    value: string;
    title?: string;
    notice?: ReactNode;
  }> = isFinancialMetricsV2
    ? [
        {
          label: "Net Sales",
          value: formatCurrency(kpis.revenue),
          title: "Net Sales: Gross Sales minus Discounts and Returns.",
        },
        {
          label: "COGS",
          value: formatCurrency(kpis.cogs),
          title:
            "COGS: cost of goods sold from synced Shopify inventory item cost data where available.",
        },
        {
          label: "Gross profit",
          value:
            kpis.grossProfit === null ? "—" : formatCurrency(kpis.grossProfit),
          notice: grossProfitNotice,
          title: "Gross Profit: Net Sales minus COGS.",
        },
        {
          label: "Gross margin",
          value: formatPercent(kpis.grossMarginPct),
          title: "Margin: Gross Profit divided by Net Sales.",
        },
        {
          label: "Expenses",
          value: formatCurrency(kpis.expenses),
        },
        {
          label: "Net profit",
          value: kpis.netProfit === null ? "—" : formatCurrency(kpis.netProfit),
          notice: expensesNotice,
          title: "Gross profit minus configured fixed expenses.",
        },
        {
          label: "Refunds",
          value: formatCurrency(kpis.refunds ?? 0),
          title:
            "Refunds: cash refunded on Shopify orders, reported separately from returns.",
        },
        {
          label: "Returns",
          value: `${formatCurrency(kpis.returns ?? 0)} · ${formatNumber(
            kpis.returnedUnits ?? 0,
          )} units`,
          title:
            "Returns: returned line-item value used in net sales calculations where available.",
        },
        {
          label: "AOV (Net)",
          value: formatCurrency(kpis.averageOrderValue),
          title: "AOV (Net) = Net Sales / Orders",
        },
        { label: "Orders", value: formatNumber(kpis.ordersCount) },
      ]
    : [
        { label: "Revenue", value: formatCurrency(kpis.revenue) },
        { label: "Orders", value: formatNumber(kpis.ordersCount) },
        { label: "Units sold", value: formatNumber(kpis.unitsSold) },
        {
          label: "COGS",
          value: formatCurrency(kpis.cogs),
          title:
            "COGS: cost of goods sold from synced Shopify inventory item cost data where available.",
        },
        {
          label: "Gross profit",
          value:
            kpis.grossProfit === null ? "—" : formatCurrency(kpis.grossProfit),
          notice: grossProfitNotice,
          title: "Gross Profit: Net Sales minus COGS.",
        },
        {
          label: "Gross margin",
          value: formatPercent(kpis.grossMarginPct),
          title: "Margin: Gross Profit divided by Net Sales.",
        },
        { label: "Expenses", value: formatCurrency(kpis.expenses) },
        {
          label: "Net profit",
          value: kpis.netProfit === null ? "—" : formatCurrency(kpis.netProfit),
          notice: expensesNotice,
        },
        {
          label: "AOV",
          value: formatCurrency(kpis.averageOrderValue),
          title: "Average Order Value = Revenue / Orders",
        },
      ];

  return (
    <>
      <section
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          marginBottom: 20,
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            title={item.title}
            style={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 18,
              boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
              minHeight: 132,
              padding: 20,
            }}
          >
            <div
              style={{
                color: "#5f6368",
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 10,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                color: "#202223",
                fontSize: 28,
                fontWeight: 800,
                marginBottom: 8,
              }}
            >
              {item.value}
            </div>
            {item.notice}
          </div>
        ))}
      </section>
      {isFinancialMetricsV2 ? (
        <details
          style={{
            color: "#616161",
            fontSize: 13,
            lineHeight: 1.5,
            marginTop: -8,
            marginBottom: 20,
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>
            Metric definitions
          </summary>
          <div style={{ marginTop: 8 }}>
            Gross Sales: product sales before discounts and returns. Discounts:
            Shopify discount allocations applied to orders and line items. Net
            Sales: Gross Sales minus Discounts and Returns. COGS: cost of goods
            sold from synced Shopify inventory item cost data where available.
            Gross Profit: Net Sales minus COGS. Margin: Gross Profit divided by
            Net Sales. Refunds: cash refunded on Shopify orders, reported
            separately from returns. Returns: returned line-item value used in
            net sales calculations where available.
          </div>
        </details>
      ) : null}
    </>
  );
}

const LOCATION_CHART_CARD_STYLE: CSSProperties = {
  background: "white",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.06)",
  padding: 20,
};

const LOCATION_CHART_EMPTY_STYLE: CSSProperties = {
  alignItems: "center",
  background: "#fafafa",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  color: "#707070",
  display: "flex",
  minHeight: 180,
  padding: 16,
};

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
    <section
      className="shopops-location-chart-card"
      style={{
        ...LOCATION_CHART_CARD_STYLE,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          alignItems: "start",
          display: "flex",
          gap: 12,
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ fontSize: 20, margin: 0 }}>
            {isFinancialMetricsV2 ? "Net sales trend" : "Sales trend by period"}
          </h2>
          <p
            style={{
              color: "#616161",
              fontSize: 13,
              lineHeight: 1.45,
              margin: "4px 0 0",
            }}
          >
            {isFinancialMetricsV2
              ? "Includes order-level cash refunds. Select a period for order and unit details."
              : `${revenueLabel} grouped by ${period}. Orders are available in each period's details.`}
          </p>
        </div>
        <label
          style={{
            alignItems: "center",
            color: "#616161",
            display: "inline-flex",
            fontSize: 13,
            fontWeight: 800,
            gap: 8,
            whiteSpace: "nowrap",
          }}
        >
          Group by
          <select
            form="locations-filter-form"
            name="period"
            defaultValue={period}
            onChange={onFilterChange}
            style={{
              border: "1px solid #c9cccf",
              borderRadius: 10,
              padding: "7px 10px",
            }}
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="year">Year</option>
          </select>
        </label>
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
  const v2Headers = [
    "Location",
    "Gross Sales",
    "Discounts",
    "Returns",
    "Returned Units",
    "Net Sales",
    "Refunds",
    "Orders",
    "Units Sold",
    "COGS",
    "Gross Profit",
    "Gross Margin",
    "Expenses",
    "Net Profit",
    "AOV (Net)",
  ];
  const sortedRows = useMemo(() => {
    const getValue = (row: LocationMetricRow) => {
      if (sort.key === "location") return row.locationName.toLowerCase();
      if (sort.key === "revenue") return row.revenue;
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
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);

  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 14,
        padding: 18,
      }}
    >
      <h2 style={{ fontSize: 18, margin: "0 0 14px" }}>Location comparison</h2>
      <div
        style={{
          border: "1px solid #f0f0f0",
          borderRadius: 12,
          overflowX: "auto",
        }}
      >
        <table
          style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}
        >
          <thead>
            <tr>
              {(isFinancialMetricsV2 ? [] : legacyHeaders).map((header) => (
                <th
                  key={header.key}
                  title={header.title}
                  style={{
                    background: "white",
                    borderBottom: "1px solid #dcdcdc",
                    color: "#616161",
                    fontWeight: 800,
                    padding: "12px 10px",
                    position: "sticky",
                    textAlign: header.key === "location" ? "left" : "right",
                    top: 0,
                    whiteSpace: "nowrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => updateSort(header.key)}
                    style={{
                      alignItems: "center",
                      background: "transparent",
                      border: 0,
                      color: "inherit",
                      cursor: "pointer",
                      display: "inline-flex",
                      font: "inherit",
                      fontWeight: "inherit",
                      gap: 4,
                      padding: 0,
                    }}
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
                      key={header}
                      title={
                        header === "Refunds"
                          ? "Refunds are order-level cash movements allocated to locations from matching order lines."
                          : header === "Gross Margin"
                            ? "Gross Margin is based on Net Sales."
                            : undefined
                      }
                      style={{
                        background: "white",
                        borderBottom: "1px solid #dcdcdc",
                        color: "#616161",
                        fontWeight: 800,
                        padding: "12px 10px",
                        position: "sticky",
                        textAlign: header === "Location" ? "left" : "right",
                        top: 0,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {header}
                    </th>
                  ))
                : null}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              sortedRows.map((row) => {
                const isSelected = selectedLocation === row.locationId;
                const isHovered = hoveredLocation === row.locationId;

                return isFinancialMetricsV2 ? (
                  <tr
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
                    onMouseEnter={() => setHoveredLocation(row.locationId)}
                    onMouseLeave={() => setHoveredLocation(null)}
                    style={{
                      background: isSelected
                        ? "#eff6ff"
                        : isHovered && onSelectLocation
                          ? "#fafafa"
                          : undefined,
                      cursor: onSelectLocation ? "pointer" : undefined,
                      textAlign: "right",
                    }}
                  >
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "grid", gap: 4 }}>
                        <strong>{row.locationName}</strong>
                        {row.netProfit !== null && row.netProfit < 0 ? (
                          <StatusBadge variant="warning">
                            Negative net profit
                          </StatusBadge>
                        ) : null}
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
                      {formatCurrency(row.revenue)}
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
                    onMouseEnter={() => setHoveredLocation(row.locationId)}
                    onMouseLeave={() => setHoveredLocation(null)}
                    style={{
                      background: isSelected
                        ? "#eff6ff"
                        : isHovered && onSelectLocation
                          ? "#fafafa"
                          : undefined,
                      cursor: onSelectLocation ? "pointer" : undefined,
                      textAlign: "right",
                    }}
                  >
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "grid", gap: 4 }}>
                        <strong>{row.locationName}</strong>
                        {row.netProfit !== null && row.netProfit < 0 ? (
                          <StatusBadge variant="warning">
                            Negative net profit
                          </StatusBadge>
                        ) : null}
                      </div>
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #f0f0f0",
                        padding: "12px 10px",
                      }}
                    >
                      {formatCurrency(row.revenue)}
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
                  colSpan={isFinancialMetricsV2 ? v2Headers.length : 10}
                  style={{ color: "#707070", padding: 16 }}
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
    <div
      className="shopops-vendor-bars"
      style={{ display: "grid", gap: 8, overflowX: "auto" }}
    >
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
              `Percent: ${row.percent.toFixed(1)}%`,
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
            style={{
              alignItems: "center",
              background: isSelected
                ? "#eff6ff"
                : hoveredValue === row.value && canSelect
                  ? "#f8fafc"
                  : undefined,
              border: isSelected
                ? "1px solid #93c5fd"
                : "1px solid transparent",
              borderRadius: 8,
              cursor: canSelect ? "pointer" : undefined,
              display: "grid",
              gap: 8,
              gridTemplateColumns: "minmax(90px, 140px) minmax(0, 1fr) auto",
              minHeight: 38,
              minWidth: 430,
              padding: "6px 8px",
            }}
          >
            <span
              style={{
                color: "#202223",
                fontSize: 13,
                fontWeight: 700,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {row.label}
              {isSelected ? (
                <small
                  style={{
                    color: "#1d4ed8",
                    display: "block",
                    fontSize: 10,
                  }}
                >
                  Selected
                </small>
              ) : null}
            </span>
            <div
              aria-hidden="true"
              style={{
                alignSelf: "center",
                background: "#eef2f7",
                borderRadius: 999,
                height: 12,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: "#2563eb",
                  borderRadius: 999,
                  height: "100%",
                  width: `${width}%`,
                }}
              />
            </div>
            <span
              style={{
                color: "#616161",
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              {formatCurrency(row.revenue)} · {row.percent.toFixed(1)}%
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
  const [hoveredValue, setHoveredValue] = useState<string | null>(null);
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 0);

  return (
    <div className="shopops-staff-leaderboard" style={{ overflowX: "auto" }}>
      <div
        aria-hidden="true"
        style={{
          color: "#6b7280",
          display: "grid",
          fontSize: 11,
          fontWeight: 800,
          gap: 10,
          gridTemplateColumns: "32px minmax(140px, 1fr) auto auto",
          minWidth: 430,
          padding: "0 10px 6px",
          textTransform: "uppercase",
        }}
      >
        <span>Rank</span>
        <span>Staff</span>
        <span>{revenueLabel}</span>
        <span>Orders</span>
      </div>
      <ol
        aria-label={`Ranked staff by ${revenueLabel.toLocaleLowerCase()}`}
        style={{
          display: "grid",
          gap: 8,
          listStyle: "none",
          margin: 0,
          minWidth: 430,
          padding: 0,
        }}
      >
        {rows.map((row, index) => {
          const canSelect = Boolean(onSelect) && row.value !== "Others";
          const isSelected = selectedValue === row.value;
          const width =
            maxRevenue > 0 && row.revenue > 0
              ? Math.max((row.revenue / maxRevenue) * 100, 2)
              : 0;

          return (
            <li key={row.value}>
              <button
                aria-label={[
                  `Rank ${index + 1}`,
                  `Staff: ${row.label}`,
                  `${revenueLabel}: ${formatCurrency(row.revenue)}`,
                  `Orders: ${formatNumber(row.ordersCount)}`,
                  `Units: ${formatNumber(row.unitsSold)}`,
                ].join(". ")}
                aria-pressed={canSelect ? isSelected : undefined}
                className="shopops-chart-interactive shopops-staff-leaderboard-row"
                disabled={!canSelect}
                onBlur={() => setHoveredValue(null)}
                onClick={() => onSelect?.(row)}
                onFocus={() => setHoveredValue(row.value)}
                onMouseEnter={() => setHoveredValue(row.value)}
                onMouseLeave={() => setHoveredValue(null)}
                title={[
                  `Staff: ${row.label}`,
                  `${revenueLabel}: ${formatCurrency(row.revenue)}`,
                  `Orders: ${formatNumber(row.ordersCount)}`,
                  `Units: ${formatNumber(row.unitsSold)}`,
                ].join("\n")}
                type="button"
                style={{
                  background: isSelected
                    ? "#eff6ff"
                    : hoveredValue === row.value && canSelect
                      ? "#f8fafc"
                      : "white",
                  border: isSelected
                    ? "1px solid #93c5fd"
                    : "1px solid #e5e7eb",
                  borderRadius: 10,
                  color: "inherit",
                  cursor: canSelect ? "pointer" : "default",
                  display: "grid",
                  font: "inherit",
                  gap: "5px 10px",
                  gridTemplateColumns: "32px minmax(140px, 1fr) auto auto",
                  minHeight: 54,
                  padding: "8px 10px",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    color: "#6b7280",
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  {row.value === "Others" ? "—" : index + 1}
                </span>
                <span
                  style={{
                    color: "#202223",
                    fontSize: 13,
                    fontWeight: 800,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.label}
                  {isSelected ? (
                    <small
                      style={{
                        color: "#1d4ed8",
                        fontSize: 10,
                        marginLeft: 6,
                      }}
                    >
                      Selected
                    </small>
                  ) : null}
                </span>
                <span
                  style={{
                    color: "#202223",
                    fontSize: 13,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatCurrency(row.revenue)}
                </span>
                <span
                  style={{
                    color: "#4b5563",
                    fontSize: 13,
                    fontWeight: 700,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatNumber(row.ordersCount)}
                </span>
                <div
                  aria-hidden="true"
                  style={{
                    background: "#eef2f7",
                    borderRadius: 999,
                    gridColumn: "2 / -1",
                    height: 4,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      background: "#60a5fa",
                      borderRadius: 999,
                      height: "100%",
                      width: `${width}%`,
                    }}
                  />
                </div>
              </button>
            </li>
          );
        })}
      </ol>
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
    <section
      className="shopops-location-chart-card"
      style={LOCATION_CHART_CARD_STYLE}
    >
      <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>
        {isFinancialMetricsV2 ? "Product sales by vendor" : "Revenue by vendor"}
      </h2>
      <p
        style={{
          color: "#616161",
          fontSize: 13,
          lineHeight: 1.45,
          margin: "0 0 16px",
        }}
      >
        Ranked {revenueLabel.toLocaleLowerCase()} for the current filters.
      </p>

      {hasRevenue ? (
        <RankedBreakdownBars
          rows={rows}
          revenueLabel={revenueLabel}
          itemLabel="Vendor"
          selectedValue={selectedVendor}
          onSelect={onSelectVendor}
        />
      ) : (
        <div style={LOCATION_CHART_EMPTY_STYLE}>
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
    <section
      className="shopops-location-chart-card"
      style={LOCATION_CHART_CARD_STYLE}
    >
      <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>
        {isFinancialMetricsV2 ? "Product sales by staff" : "Revenue by staff"}
      </h2>
      <p
        style={{
          color: "#616161",
          fontSize: 13,
          lineHeight: 1.45,
          margin: "0 0 16px",
        }}
      >
        Ranked {revenueLabel.toLocaleLowerCase()} for the current filters.
      </p>

      {hasRevenue ? (
        <StaffLeaderboard
          rows={rows}
          revenueLabel={revenueLabel}
          selectedValue={selectedStaff}
          onSelect={onSelectStaff}
        />
      ) : (
        <div style={LOCATION_CHART_EMPTY_STYLE}>
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
        <p
          style={{
            color: "#616161",
            fontSize: 13,
            lineHeight: 1.45,
            margin: "0 0 10px",
          }}
        >
          Product sales include discounts and merchandise returns but exclude
          order-level cash refunds, which cannot be assigned reliably to a
          vendor or staff member.
        </p>
      ) : null}
      <div
        className="shopops-breakdown-grid"
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          marginBottom: 20,
        }}
      >
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

  if (chips.length === 0) return null;

  return (
    <div
      style={{
        alignItems: "center",
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        justifyContent: "space-between",
        marginBottom: 16,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span style={{ color: "#616161", fontSize: 13, fontWeight: 700 }}>
          Filtered by:
        </span>
        {chips.map((chip) => (
          <StatusBadge
            key={chip.key}
            variant="info"
            style={{ gap: 6, paddingRight: 6 }}
          >
            {chip.label}: {chip.value}
            <button
              type="button"
              aria-label={`Clear ${chip.label} drilldown`}
              onClick={() => onClearOne(chip.key)}
              style={{
                alignItems: "center",
                background: "transparent",
                border: 0,
                borderRadius: 999,
                color: "inherit",
                cursor: "pointer",
                display: "inline-flex",
                fontSize: 13,
                fontWeight: 900,
                height: 18,
                justifyContent: "center",
                lineHeight: 1,
                marginLeft: 2,
                padding: 0,
                width: 18,
              }}
            >
              ×
            </button>
          </StatusBadge>
        ))}
      </div>
      <AppButton variant="ghost" compact onClick={onClearAll}>
        Clear all
      </AppButton>
    </div>
  );
}

export default function LocationsPage() {
  const location = useLocation();
  const navigation = useNavigation();
  const dataSyncPath = getDataSyncPath(location.search);
  const {
    locations,
    selectedLocationIds,
    selectedStaff,
    selectedVendor,
    staffOptions,
    vendorOptions,
    startDate,
    endDate,
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
  } = useLoaderData<LoaderData>();
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
    ? "All locations"
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
    <main
      className="shopops-locations-page"
      style={{
        background: "#f6f6f7",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        minHeight: "100vh",
        padding: 28,
      }}
    >
      <style>{`
        .shopops-chart-interactive:focus-visible {
          outline: 3px solid #93c5fd !important;
          outline-offset: 2px;
        }
        @media (max-width: 1100px) {
          .shopops-breakdown-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .shopops-locations-page {
            padding: 16px !important;
          }
          .shopops-location-chart-card {
            padding: 16px !important;
          }
        }
      `}</style>
      <div style={{ margin: "0 auto", maxWidth: 1360 }}>
        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 16,
            marginBottom: 20,
            padding: 20,
          }}
        >
          <div style={{ marginBottom: 18 }}>
            <div>
              <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0 }}>
                Location Performance
              </h1>
              <p style={{ color: "#616161", margin: "6px 0 0" }}>
                Compare stores by net sales, margin, expenses, discounts,
                refunds, and inventory health.
              </p>
            </div>
          </div>

          <Form
            id="locations-filter-form"
            method="get"
            onSubmit={() => setIsDirty(false)}
            style={{ display: "grid", gap: 16 }}
          >
            {preservedSearchParams.map(({ name, value }, index) => (
              <input
                key={`${name}-${index}`}
                type="hidden"
                name={name}
                value={value}
              />
            ))}
            <input
              type="hidden"
              name="locations"
              value={allLocationsSelected ? "" : draftLocationIds.join(",")}
            />

            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              }}
            >
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Start date
                <input
                  name="startDate"
                  type="date"
                  defaultValue={startDate}
                  onChange={() => setIsDirty(true)}
                  style={{
                    border: "1px solid #c9cccf",
                    borderRadius: 10,
                    padding: 10,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                End date
                <input
                  name="endDate"
                  type="date"
                  defaultValue={endDate}
                  onChange={() => setIsDirty(true)}
                  style={{
                    border: "1px solid #c9cccf",
                    borderRadius: 10,
                    padding: 10,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Staff
                <select
                  name="staff"
                  defaultValue={selectedStaff}
                  onChange={() => setIsDirty(true)}
                  style={{
                    border: "1px solid #c9cccf",
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  <option value="">All staff</option>
                  {staffOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Vendor
                <select
                  name="vendor"
                  defaultValue={selectedVendor}
                  onChange={() => setIsDirty(true)}
                  style={{
                    border: "1px solid #c9cccf",
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  <option value="">All vendors</option>
                  {vendorOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <div
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{ color: "#616161", fontSize: 13, fontWeight: 800 }}
                >
                  Locations
                </div>
                <div style={{ color: "#707070", fontSize: 13 }}>
                  {locationSummary}
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setDraftLocationIds(
                      locations.map((location) => location.shopify_location_id),
                    );
                    setIsDirty(true);
                  }}
                  style={{
                    alignItems: "center",
                    background: "white",
                    border: `1px solid ${allLocationsSelected ? "#2563eb" : "#dcdcdc"}`,
                    borderRadius: 999,
                    color: "#202223",
                    cursor: "pointer",
                    display: "inline-flex",
                    font: "inherit",
                    gap: 8,
                    padding: "7px 10px",
                  }}
                >
                  All locations
                </button>
                {locations.map((location) => (
                  <label
                    key={location.shopify_location_id}
                    style={{
                      alignItems: "center",
                      border: `1px solid ${
                        draftLocationIds.includes(location.shopify_location_id)
                          ? "#2563eb"
                          : "#dcdcdc"
                      }`,
                      borderRadius: 999,
                      display: "inline-flex",
                      gap: 8,
                      padding: "7px 10px",
                    }}
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
            </div>

            {isDirty ? (
              <div
                style={{
                  background: "#eff8ff",
                  border: "1px solid #b2ddff",
                  borderRadius: 10,
                  color: "#175cd3",
                  fontSize: 13,
                  fontWeight: 700,
                  padding: "8px 10px",
                  width: "fit-content",
                }}
              >
                Filters changed. Click Apply to update.
              </div>
            ) : null}

            <div
              style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
            >
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
            </div>
          </Form>
        </section>

        <p style={{ color: "#707070", fontSize: 13, margin: "0 0 16px" }}>
          Expenses include active location-specific amounts. Global expenses are
          shared equally across all active locations.
          {financialMetricsVersion === "v2"
            ? " Refunds are order-level cash movements allocated to locations from matching order lines."
            : ""}
        </p>

        {debugInfo ? (
          <details
            style={{
              background: "white",
              border: "1px solid #e3e3e3",
              borderRadius: 12,
              marginBottom: 20,
              padding: 14,
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>
              Support diagnostics
            </summary>
            <pre
              style={{
                background: "#111827",
                borderRadius: 10,
                color: "#f9fafb",
                fontSize: 12,
                lineHeight: 1.45,
                margin: "10px 0 0",
                overflowX: "auto",
                padding: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          </details>
        ) : null}

        {hasNoSyncedLocations ? (
          <PageNotice
            title="Your data is being prepared"
            message="No locations have synced yet. Location reports appear after Shopify data sync completes."
            bullets={[
              "Open Sync Status to confirm whether locations, products, inventory, and orders have synced.",
              "Location reporting becomes useful once Shopify data is available.",
            ]}
            cta={{ to: dataSyncPath, label: "Open Sync Status" }}
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
            cta={{ to: dataSyncPath, label: "Open Sync Status" }}
            tone="info"
          />
        ) : hasNoSalesForRange ? (
          <PageNotice
            title="No sales for this date range."
            message="Try another date range or confirm sync status."
            bullets={[
              "Filters remain available so admins can review another location, staff member, vendor, or date range.",
              "If sales should already be available, check Sync Status for freshness or failures.",
            ]}
            cta={{ to: dataSyncPath, label: "Open Sync Status" }}
            tone="neutral"
          />
        ) : null}

        {shouldShowAnalytics ? (
          <>
            <KpiGrid
              kpis={kpis}
              financialMetricsVersion={financialMetricsVersion}
              hasOperatingExpenses={hasOperatingExpenses}
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
        ) : null}
      </div>
    </main>
  );
}
