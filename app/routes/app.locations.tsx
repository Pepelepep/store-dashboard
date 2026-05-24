import type { LoaderFunctionArgs } from "react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Form, useLoaderData } from "react-router";

import { AppButton } from "../components/ui/AppButton";
import { StatusBadge } from "../components/ui/StatusBadge";
import { getPermissionContext } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import {
  daysBetween,
  formatCurrency,
  formatNumber,
  formatPercent,
  getStaffDisplayLabel,
  getStaffFilterValue,
  getTodayStoreDate,
  getVendorFilterValue,
  nextDate,
  STORE_TIME_ZONE,
  storeDateToUtcIso,
  UNKNOWN_STAFF_FILTER_VALUE,
} from "../lib/dashboard/dashboard-metrics";
import type {
  DashboardFilterOption,
  FixedExpenseDbRow,
  LocationRow,
  OrderLineDbRow,
} from "../lib/dashboard/dashboard-types";
import { authenticate } from "../shopify.server";

type LocationMetricRow = {
  locationId: string;
  locationName: string;
  revenue: number;
  ordersCount: number;
  unitsSold: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
  expenses: number;
  netProfit: number;
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
  | "shopify_order_id"
  | "quantity"
  | "revenue"
  | "cogs"
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
  selectedDays: number;
  period: Period;
  kpis: Omit<LocationMetricRow, "locationId" | "locationName">;
  locationRows: LocationMetricRow[];
  trendRows: TrendRow[];
  revenueByVendor: RevenueBreakdownRow[];
  revenueByStaff: RevenueBreakdownRow[];
  salesRows: LocationsSalesRow[];
  hasGlobalExpenses: boolean;
  errors: string[];
};

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

function getDaysInMonth(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function getMonthKeyFromDateString(value: string | null) {
  return value ? value.slice(0, 7) : null;
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
      label: "Unknown staff",
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

type BucketKind = "day" | "month" | "year";

function getBucketKind(rangeDays: number): BucketKind {
  if (rangeDays <= 45) return "day";
  if (rangeDays <= 548) return "month";
  return "year";
}

function getBucketKey(value: string, bucketKind: BucketKind) {
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
  const dateKey = `${values.year}-${values.month}-${values.day}`;

  if (bucketKind === "day") return dateKey;
  if (bucketKind === "month") return dateKey.slice(0, 7);
  return dateKey.slice(0, 4);
}

function buildBucketKeys({
  startDate,
  endDate,
  selectedDays,
}: {
  startDate: string;
  endDate: string;
  selectedDays: number;
}) {
  const bucketKind = getBucketKind(selectedDays);
  const keys: string[] = [];
  const seen = new Set<string>();
  const endExclusiveDate = addDays(parseDateOnlyUtc(endDate), 1);

  for (
    let current = parseDateOnlyUtc(startDate);
    current < endExclusiveDate;
    current = addDays(current, 1)
  ) {
    const key =
      bucketKind === "day"
        ? formatDateOnlyUtc(current)
        : bucketKind === "month"
          ? getMonthKey(current)
          : getYearKey(current);

    if (!seen.has(key)) {
      keys.push(key);
      seen.add(key);
    }
  }

  return { bucketKind, keys };
}

function computeLocationExpenses({
  expenses,
  selectedDays,
  startDate,
  endDate,
}: {
  expenses: FixedExpenseDbRow[];
  selectedDays: number;
  startDate: string;
  endDate: string;
}) {
  const totals = new Map<string, number>();
  const rangeStart = parseDateOnlyUtc(startDate);
  const rangeEndExclusive = addDays(parseDateOnlyUtc(endDate), 1);

  for (
    let current = new Date(rangeStart);
    current < rangeEndExclusive;
    current = addDays(current, 1)
  ) {
    const currentMonthKey = getMonthKey(current);
    const daysInMonth = getDaysInMonth(current);

    for (const expense of expenses) {
      if (!expense.is_active || !expense.shopify_location_id) continue;

      const expenseStartMonth = getMonthKeyFromDateString(expense.start_month);
      const expenseEndMonth = getMonthKeyFromDateString(expense.end_month);

      if (expenseStartMonth && currentMonthKey < expenseStartMonth) continue;
      if (expenseEndMonth && currentMonthKey > expenseEndMonth) continue;

      const dailyAmount = Number(expense.monthly_amount ?? 0) / daysInMonth;
      totals.set(
        expense.shopify_location_id,
        (totals.get(expense.shopify_location_id) ?? 0) + dailyAmount,
      );
    }
  }

  return selectedDays > 0 ? totals : new Map<string, number>();
}

function getVendorDrilldownValue(row: LocationsSalesRow) {
  return row.vendor?.trim() || "Unknown vendor";
}

function getStaffDrilldownValue(row: LocationsSalesRow) {
  return (
    row.staff_member_id ||
    row.staff_member_email ||
    row.staff_member_name ||
    "Unknown staff"
  );
}

function getStaffDrilldownLabel(row: LocationsSalesRow) {
  return (
    row.staff_member_name ||
    row.staff_member_email ||
    row.staff_member_id ||
    "Unknown staff"
  );
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
}: {
  locations: LocationRow[];
  orderLines: LocationsSalesRow[];
  expensesByLocation: Map<string, number>;
}) {
  const rows = locations.map((location): LocationMetricRow => {
    const rowsForLocation = orderLines.filter(
      (row) => row.retail_location_id === location.shopify_location_id,
    );
    const revenue = rowsForLocation.reduce(
      (sum, row) => sum + Number(row.revenue ?? 0),
      0,
    );
    const cogs = rowsForLocation.reduce(
      (sum, row) => sum + Number(row.cogs ?? 0),
      0,
    );
    const grossProfit = revenue - cogs;
    const orderIds = new Set(
      rowsForLocation.map((row) => row.shopify_order_id).filter(Boolean),
    );
    const ordersCount = orderIds.size;
    const unitsSold = rowsForLocation.reduce(
      (sum, row) => sum + Number(row.quantity ?? 0),
      0,
    );
    const expenses = expensesByLocation.get(location.shopify_location_id) ?? 0;

    return {
      locationId: location.shopify_location_id,
      locationName: location.name,
      revenue,
      ordersCount,
      unitsSold,
      cogs,
      grossProfit,
      grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : null,
      expenses,
      netProfit: grossProfit - expenses,
      averageOrderValue: ordersCount > 0 ? revenue / ordersCount : 0,
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue);

  const totals = rows.reduce(
    (sum, row) => ({
      revenue: sum.revenue + row.revenue,
      ordersCount: sum.ordersCount + row.ordersCount,
      unitsSold: sum.unitsSold + row.unitsSold,
      cogs: sum.cogs + row.cogs,
      grossProfit: sum.grossProfit + row.grossProfit,
      grossMarginPct: null,
      expenses: sum.expenses + row.expenses,
      netProfit: sum.netProfit + row.netProfit,
      averageOrderValue: null,
    }),
    {
      revenue: 0,
      ordersCount: 0,
      unitsSold: 0,
      cogs: 0,
      grossProfit: 0,
      grossMarginPct: null as number | null,
      expenses: 0,
      netProfit: 0,
      averageOrderValue: null as number | null,
    },
  );

  return {
    rows,
    totals: {
      ...totals,
      grossMarginPct:
        totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : null,
      averageOrderValue:
        totals.ordersCount > 0 ? totals.revenue / totals.ordersCount : 0,
    },
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
  startDate,
  endDate,
  period,
}: {
  orderLines: LocationsSalesRow[];
  startDate: string;
  endDate: string;
  period: Period;
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

  return {
    rows: Array.from(rowsByBucket.values()),
  };
}

function computeRevenueBreakdown({
  orderLines,
  getLabel,
  getValue,
  limit = 8,
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

  if (sortedRows.length <= limit) {
    return sortedRows;
  }

  const visibleRows = sortedRows.slice(0, limit - 1);
  const otherRows = sortedRows.slice(limit - 1);
  const others = otherRows.reduce(
    (sum, row) => ({
      label: "Others",
      value: "Others",
      revenue: sum.revenue + row.revenue,
      ordersCount: sum.ordersCount + row.ordersCount,
      unitsSold: sum.unitsSold + row.unitsSold,
      percent: sum.percent + row.percent,
    }),
    {
      label: "Others",
      value: "Others",
      revenue: 0,
      ordersCount: 0,
      unitsSold: 0,
      percent: 0,
    },
  );

  return [...visibleRows, others];
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  const permissions = await getPermissionContext({ request, session, supabase });
  const url = new URL(request.url);
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
  const period = getSelectedPeriod(url.searchParams.get("period"), selectedDays);
  const startDateUtc = storeDateToUtcIso(startDate);
  const endExclusiveUtc = storeDateToUtcIso(nextDate(endDate));
  const errors: string[] = [];

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name, is_active")
    .eq("shop_domain", session.shop)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (locationsError) errors.push(locationsError.message);

  const allLocations = (locationsData ?? []) as LocationRow[];
  const accessibleLocations = permissions.isAdmin
    ? allLocations
    : allLocations.filter((location) =>
        permissions.allowedLocationIds.has(location.shopify_location_id),
      );

  if (!permissions.isAdmin && accessibleLocations.length === 0) {
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

  const [orderLinesResult, expensesResult] = await Promise.all([
    selectedLocationIds.length > 0
      ? supabase
          .from("order_lines")
          .select(
            "order_name, shopify_order_id, created_at_shopify, retail_location_id, retail_location_name, product_title, variant_title, sku, vendor, quantity, unit_price, revenue, unit_cost, cogs, gross_profit, cost_source, staff_member_id, staff_member_name, staff_member_email, staff_source",
          )
          .eq("shop_domain", session.shop)
          .in("retail_location_id", selectedLocationIds)
          .gte("created_at_shopify", startDateUtc)
          .lt("created_at_shopify", endExclusiveUtc)
          .order("created_at_shopify", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("fixed_expenses")
      .select(
        "expense_name, expense_category, monthly_amount, shopify_location_id, location_name, start_month, end_month, is_active",
      )
      .eq("shop_domain", session.shop)
      .eq("is_active", true),
  ]);

  if (orderLinesResult.error) errors.push(orderLinesResult.error.message);
  if (expensesResult.error) errors.push(expensesResult.error.message);

  const orderLines = (orderLinesResult.data ?? []) as OrderLineDbRow[];
  const expenses = (expensesResult.data ?? []) as FixedExpenseDbRow[];
  const staffOptions = buildStaffOptions(orderLines);
  const vendorOptions = buildVendorOptions(orderLines);
  const filteredOrderLines = filterOrderLines({
    orderLines,
    selectedStaff,
    selectedVendor,
  });
  const locationSpecificExpenses = expenses.filter(
    (expense) =>
      expense.shopify_location_id &&
      selectedLocationIds.includes(expense.shopify_location_id),
  );
  const hasGlobalExpenses = expenses.some((expense) => !expense.shopify_location_id);
  const expensesByLocation = computeLocationExpenses({
    expenses: locationSpecificExpenses,
    selectedDays,
    startDate,
    endDate,
  });
  const metrics = computeMetrics({
    locations: safeSelectedLocations,
    orderLines: filteredOrderLines,
    expensesByLocation,
  });
  const trend = computeTrendRows({
    orderLines: filteredOrderLines,
    startDate,
    endDate,
    period,
  });
  const revenueByVendor = computeRevenueBreakdown({
    orderLines: filteredOrderLines,
    limit: 8,
    getLabel: getVendorDrilldownValue,
    getValue: getVendorDrilldownValue,
  });
  const revenueByStaff = computeRevenueBreakdown({
    orderLines: filteredOrderLines,
    limit: 8,
    getLabel: getStaffDrilldownLabel,
    getValue: getStaffDrilldownValue,
  });
  const salesRows: LocationsSalesRow[] = filteredOrderLines.map((row) => ({
    created_at_shopify: row.created_at_shopify,
    retail_location_id: row.retail_location_id,
    retail_location_name: row.retail_location_name,
    vendor: row.vendor,
    staff_member_id: row.staff_member_id,
    staff_member_name: row.staff_member_name,
    staff_member_email: row.staff_member_email,
    shopify_order_id: row.shopify_order_id,
    quantity: Number(row.quantity ?? 0),
    revenue: Number(row.revenue ?? 0),
    cogs: row.cogs === null ? null : Number(row.cogs ?? 0),
  }));

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
    selectedDays,
    period,
    kpis: metrics.totals,
    locationRows: metrics.rows,
    trendRows: trend.rows,
    revenueByVendor,
    revenueByStaff,
    salesRows,
    hasGlobalExpenses,
    errors,
  } satisfies LoaderData;
}

function KpiGrid({ kpis }: { kpis: LoaderData["kpis"] }) {
  const items = [
    { label: "Revenue", value: formatCurrency(kpis.revenue) },
    { label: "Orders", value: formatNumber(kpis.ordersCount) },
    { label: "Units sold", value: formatNumber(kpis.unitsSold) },
    { label: "COGS", value: formatCurrency(kpis.cogs) },
    { label: "Gross profit", value: formatCurrency(kpis.grossProfit) },
    { label: "Gross margin", value: formatPercent(kpis.grossMarginPct) },
    { label: "Expenses", value: formatCurrency(kpis.expenses) },
    { label: "Net profit", value: formatCurrency(kpis.netProfit) },
    {
      label: "AOV",
      value: formatCurrency(kpis.averageOrderValue),
      title: "Average Order Value = Revenue / Orders",
    },
  ];

  return (
    <section
      style={{
        display: "grid",
        gap: 14,
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        marginBottom: 20,
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          title={item.title}
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ color: "#616161", fontSize: 12, fontWeight: 800 }}>
            {item.label}
          </div>
          <div style={{ color: "#202223", fontSize: 22, fontWeight: 800 }}>
            {item.value}
          </div>
        </div>
      ))}
    </section>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        alignItems: "center",
        color: "#616161",
        display: "inline-flex",
        fontSize: 12,
        fontWeight: 700,
        gap: 6,
      }}
    >
      <span
        style={{
          background: color,
          borderRadius: 999,
          height: 10,
          width: 10,
        }}
      />
      {label}
    </span>
  );
}

function TrendChart({
  rows,
  period,
  onFilterChange,
  selectedPeriod,
  onSelectPeriod,
}: {
  rows: TrendRow[];
  period: Period;
  onFilterChange: () => void;
  selectedPeriod?: string | null;
  onSelectPeriod?: (row: TrendRow) => void;
}) {
  const [hoveredPeriod, setHoveredPeriod] = useState<string | null>(null);
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 0);
  const maxOrders = Math.max(...rows.map((row) => row.ordersCount), 0);
  const hasSales = rows.some((row) => row.revenue > 0 || row.ordersCount > 0);
  const revenueMaxHeight = 150;
  const ordersMaxHeight = 84;
  const barGap = rows.length > 90 ? 0 : rows.length > 60 ? 1 : rows.length > 32 ? 2 : 4;

  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 14,
        marginBottom: 20,
        padding: 18,
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
          <h2 style={{ fontSize: 18, margin: 0 }}>Sales trend by period</h2>
          <p style={{ color: "#616161", margin: "4px 0 0" }}>
            Revenue and orders grouped by {period}.
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

      {hasSales ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <LegendItem color="#2563eb" label="Revenue" />
            <LegendItem color="#14b8a6" label="Orders" />
          </div>
          <div
            style={{
              display: "grid",
              gap: barGap,
              gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`,
              width: "100%",
            }}
          >
            {rows.map((row, index) => {
              const isSelected = selectedPeriod === row.period;
              const isHovered = hoveredPeriod === row.period;
              const labelStep =
                rows.length > 48
                  ? 8
                  : rows.length > 32
                    ? 6
                    : rows.length > 20
                      ? 4
                      : rows.length > 12
                        ? 2
                        : 1;
              const showLabel =
                index === 0 ||
                index === rows.length - 1 ||
                index % labelStep === 0;
              const valueLabelStep =
                rows.length > 24 ? labelStep : rows.length > 14 ? 2 : 1;
              const showValueLabel =
                index % valueLabelStep === 0 || rows.length <= 14;
              const revenueHeight =
                maxRevenue > 0
                  ? Math.max((row.revenue / maxRevenue) * revenueMaxHeight, 3)
                  : 0;
              const ordersHeight =
                maxOrders > 0
                  ? Math.max((row.ordersCount / maxOrders) * ordersMaxHeight, 3)
                  : 0;

              return (
                <div
                  key={row.period}
                  title={[
                    `Period: ${row.period}`,
                    `Revenue: ${formatCurrency(row.revenue)}`,
                    `Orders: ${formatNumber(row.ordersCount)}`,
                    `Units: ${formatNumber(row.unitsSold)}`,
                  ].join("\n")}
                  role={onSelectPeriod ? "button" : undefined}
                  tabIndex={onSelectPeriod ? 0 : undefined}
                  onClick={() => onSelectPeriod?.(row)}
                  onKeyDown={(event) => {
                    if (!onSelectPeriod) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectPeriod(row);
                    }
                  }}
                  onMouseEnter={() => setHoveredPeriod(row.period)}
                  onMouseLeave={() => setHoveredPeriod(null)}
                  style={{
                    background: isSelected
                      ? "#eff6ff"
                      : isHovered && onSelectPeriod
                        ? "#fafafa"
                        : undefined,
                    borderRadius: 8,
                    cursor: onSelectPeriod ? "pointer" : undefined,
                    display: "grid",
                    gridTemplateRows: "22px 150px 24px 84px 18px",
                    justifyItems: "center",
                    minWidth: 0,
                    outline: isSelected ? "2px solid #2563eb" : undefined,
                    outlineOffset: 2,
                  }}
                >
                  <div
                    style={{
                      color: "#374151",
                      fontSize: 10,
                      fontWeight: 800,
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.revenue > 0 && showValueLabel
                      ? formatCompactCurrency(row.revenue)
                      : ""}
                  </div>
                  <div
                    style={{
                      alignItems: "flex-end",
                      display: "flex",
                      height: revenueMaxHeight,
                      justifyContent: "center",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        background: row.revenue > 0 ? "#2563eb" : "#e5e7eb",
                        borderRadius: "6px 6px 2px 2px",
                        height: revenueHeight,
                        maxWidth: 26,
                        minWidth: rows.length > 60 ? 2 : 4,
                        width: "68%",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      color: "#616161",
                      fontSize: 10,
                      fontWeight: 800,
                      lineHeight: "24px",
                      position: "relative",
                      overflow: "hidden",
                      textAlign: "center",
                      textOverflow: "clip",
                      whiteSpace: "nowrap",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        background: "#d1d5db",
                        height: 1,
                        left: 0,
                        position: "absolute",
                        right: 0,
                        top: 0,
                      }}
                    />
                    {showLabel ? row.label : ""}
                  </div>
                  <div
                    style={{
                      alignItems: "flex-start",
                      display: "flex",
                      height: ordersMaxHeight,
                      justifyContent: "center",
                      width: "100%",
                    }}
                  >
                    <div
                      style={{
                        background:
                          row.ordersCount > 0 ? "#14b8a6" : "#e5e7eb",
                        borderRadius: "2px 2px 6px 6px",
                        height: ordersHeight,
                        maxWidth: 26,
                        minWidth: rows.length > 60 ? 2 : 4,
                        width: "68%",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      color: "#374151",
                      fontSize: 10,
                      fontWeight: 800,
                      lineHeight: 1,
                    }}
                  >
                    {row.ordersCount > 0 && showValueLabel
                      ? formatNumber(row.ordersCount)
                      : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #f0f0f0",
            borderRadius: 12,
            color: "#707070",
            padding: 16,
          }}
        >
          No sales available for this period.
        </div>
      )}
    </section>
  );
}

function LocationTable({
  rows,
  selectedLocation,
  onSelectLocation,
}: {
  rows: LocationMetricRow[];
  selectedLocation?: string | null;
  onSelectLocation?: (row: LocationMetricRow) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    {
      key: "revenue",
      direction: "desc",
    },
  );
  const headers: Array<{
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
      <h2 style={{ fontSize: 18, margin: "0 0 14px" }}>
        Location comparison
      </h2>
      <div style={{ border: "1px solid #f0f0f0", borderRadius: 12, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}>
          <thead>
            <tr>
              {headers.map((header) => (
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
                    textAlign: "left",
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
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              sortedRows.map((row) => {
                const isSelected = selectedLocation === row.locationId;
                const isHovered = hoveredLocation === row.locationId;

                return (
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
                  }}
                >
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong>{row.locationName}</strong>
                      {row.netProfit < 0 ? (
                        <StatusBadge variant="warning">Negative net profit</StatusBadge>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatCurrency(row.revenue)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatNumber(row.ordersCount)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatNumber(row.unitsSold)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatCurrency(row.cogs)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatCurrency(row.grossProfit)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatPercent(row.grossMarginPct)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatCurrency(row.expenses)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatCurrency(row.netProfit)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f0f0f0", padding: "12px 10px" }}>
                    {formatCurrency(row.averageOrderValue)}
                  </td>
                </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={10} style={{ color: "#707070", padding: 16 }}>
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

const breakdownColors = [
  "#2563eb",
  "#14b8a6",
  "#f59e0b",
  "#7c3aed",
  "#ef4444",
  "#0891b2",
  "#65a30d",
  "#db2777",
];

function RevenueByVendorCard({
  rows,
  selectedVendor,
  onSelectVendor,
}: {
  rows: RevenueBreakdownRow[];
  selectedVendor?: string | null;
  onSelectVendor?: (row: RevenueBreakdownRow) => void;
}) {
  const [hoveredVendor, setHoveredVendor] = useState<string | null>(null);
  const hasRevenue = rows.some((row) => row.revenue > 0);
  let currentPercent = 0;
  const gradientStops = rows
    .map((row, index) => {
      const start = currentPercent;
      const end = currentPercent + row.percent;
      currentPercent = end;
      return `${breakdownColors[index % breakdownColors.length]} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 14,
        padding: 18,
      }}
    >
      <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Revenue by Vendor</h2>
      <p style={{ color: "#616161", margin: "0 0 16px" }}>
        Revenue share for the current filters.
      </p>

      {hasRevenue ? (
        <div
          style={{
            alignItems: "center",
            display: "grid",
            gap: 18,
            gridTemplateColumns: "160px minmax(0, 1fr)",
          }}
        >
          <div
            aria-label="Revenue by vendor donut chart"
            style={{
              aspectRatio: "1 / 1",
              background: `conic-gradient(${gradientStops})`,
              borderRadius: "50%",
              position: "relative",
              width: "100%",
            }}
          >
            <div
              style={{
                background: "white",
                borderRadius: "50%",
                inset: 38,
                position: "absolute",
              }}
            />
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((row, index) => (
              <div
                key={row.label}
                title={[
                  `Vendor: ${row.label}`,
                  `Revenue: ${formatCurrency(row.revenue)}`,
                  `Percent: ${row.percent.toFixed(1)}%`,
                  `Orders: ${formatNumber(row.ordersCount)}`,
                ].join("\n")}
                role={onSelectVendor ? "button" : undefined}
                tabIndex={onSelectVendor ? 0 : undefined}
                onClick={() => onSelectVendor?.(row)}
                onKeyDown={(event) => {
                  if (!onSelectVendor) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectVendor(row);
                  }
                }}
                onMouseEnter={() => setHoveredVendor(row.value)}
                onMouseLeave={() => setHoveredVendor(null)}
                style={{
                  alignItems: "center",
                  background:
                    selectedVendor === row.value
                      ? "#eff6ff"
                      : hoveredVendor === row.value && onSelectVendor
                        ? "#fafafa"
                        : undefined,
                  borderRadius: 8,
                  cursor: onSelectVendor ? "pointer" : undefined,
                  display: "grid",
                  gap: 8,
                  gridTemplateColumns: "10px minmax(0, 1fr) auto",
                  padding: "4px 6px",
                }}
              >
                <span
                  style={{
                    background:
                      breakdownColors[index % breakdownColors.length],
                    borderRadius: 999,
                    height: 10,
                    width: 10,
                  }}
                />
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
                </span>
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
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #f0f0f0",
            borderRadius: 12,
            color: "#707070",
            padding: 16,
          }}
        >
          No vendor revenue available for this period.
        </div>
      )}
    </section>
  );
}

function RevenueByStaffCard({
  rows,
  selectedStaff,
  onSelectStaff,
}: {
  rows: RevenueBreakdownRow[];
  selectedStaff?: string | null;
  onSelectStaff?: (row: RevenueBreakdownRow) => void;
}) {
  const [hoveredStaff, setHoveredStaff] = useState<string | null>(null);
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 0);

  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 14,
        padding: 18,
      }}
    >
      <h2 style={{ fontSize: 18, margin: "0 0 4px" }}>Revenue by Staff</h2>
      <p style={{ color: "#616161", margin: "0 0 16px" }}>
        Top staff revenue for the current filters.
      </p>

      {rows.length > 0 && maxRevenue > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            gridTemplateColumns: "minmax(96px, 132px) minmax(0, 1fr)",
          }}
        >
          {rows.map((row) => {
            const width = Math.max((row.revenue / maxRevenue) * 100, 2);
            const isSelected = selectedStaff === row.value;
            const isHovered = hoveredStaff === row.value;

            return (
              <Fragment key={row.label}>
                <div
                  title={row.label}
                  style={{
                    alignSelf: "center",
                    background: isSelected
                      ? "#eff6ff"
                      : isHovered && onSelectStaff
                        ? "#fafafa"
                        : undefined,
                    borderRadius: 8,
                    color: "#202223",
                    cursor: onSelectStaff ? "pointer" : undefined,
                    fontSize: 13,
                    fontWeight: 700,
                    overflow: "hidden",
                    padding: "4px 6px",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  onClick={() => onSelectStaff?.(row)}
                  onMouseEnter={() => setHoveredStaff(row.value)}
                  onMouseLeave={() => setHoveredStaff(null)}
                >
                  {row.label}
                </div>
                <div
                  title={[
                    `Staff: ${row.label}`,
                    `Revenue: ${formatCurrency(row.revenue)}`,
                    `Orders: ${formatNumber(row.ordersCount)}`,
                    `Units: ${formatNumber(row.unitsSold)}`,
                  ].join("\n")}
                  style={{
                    alignItems: "center",
                    background: isSelected
                      ? "#eff6ff"
                      : isHovered && onSelectStaff
                        ? "#fafafa"
                        : undefined,
                    borderRadius: 8,
                    cursor: onSelectStaff ? "pointer" : undefined,
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 8,
                    minWidth: 0,
                    padding: "4px 6px",
                  }}
                  role={onSelectStaff ? "button" : undefined}
                  tabIndex={onSelectStaff ? 0 : undefined}
                  onClick={() => onSelectStaff?.(row)}
                  onKeyDown={(event) => {
                    if (!onSelectStaff) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectStaff(row);
                    }
                  }}
                  onMouseEnter={() => setHoveredStaff(row.value)}
                  onMouseLeave={() => setHoveredStaff(null)}
                >
                  <div
                    style={{
                      background: "#eef2f7",
                      borderRadius: 999,
                      height: 12,
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        background: "#2563eb",
                        borderRadius: 999,
                        height: "100%",
                        left: 0,
                        position: "absolute",
                        top: 0,
                        width: `${width}%`,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      color: "#616161",
                      fontSize: 12,
                      fontWeight: 800,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatCurrency(row.revenue)}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #f0f0f0",
            borderRadius: 12,
            color: "#707070",
            padding: 16,
          }}
        >
          No staff revenue available for this period.
        </div>
      )}
    </section>
  );
}

function RevenueBreakdownSection({
  revenueByVendor,
  revenueByStaff,
  activeDrilldowns,
  onSelectVendor,
  onSelectStaff,
}: {
  revenueByVendor: RevenueBreakdownRow[];
  revenueByStaff: RevenueBreakdownRow[];
  activeDrilldowns: ActiveLocationDrilldowns;
  onSelectVendor: (row: RevenueBreakdownRow) => void;
  onSelectStaff: (row: RevenueBreakdownRow) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 20,
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        marginBottom: 20,
      }}
    >
      <RevenueByVendorCard
        rows={revenueByVendor}
        selectedVendor={activeDrilldowns.vendor?.value ?? null}
        onSelectVendor={onSelectVendor}
      />
      <RevenueByStaffCard
        rows={revenueByStaff}
        selectedStaff={activeDrilldowns.staff?.value ?? null}
        onSelectStaff={onSelectStaff}
      />
    </div>
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
    kpis,
    locationRows,
    salesRows,
    period,
    hasGlobalExpenses,
    errors,
  } = useLoaderData<LoaderData>();
  const [draftLocationIds, setDraftLocationIds] = useState(selectedLocationIds);
  const [isDirty, setIsDirty] = useState(false);
  const [activeDrilldowns, setActiveDrilldowns] =
    useState<ActiveLocationDrilldowns>({});
  useEffect(() => {
    setDraftLocationIds(selectedLocationIds);
    setIsDirty(false);
    setActiveDrilldowns({});
  }, [selectedLocationIds]);
  const allLocationsSelected = draftLocationIds.length === locations.length;
  const locationSummary = allLocationsSelected
    ? "All locations"
    : draftLocationIds.length === 1
      ? locations.find(
          (location) => location.shopify_location_id === draftLocationIds[0],
        )?.name || "1 location selected"
      : `${draftLocationIds.length} locations selected`;
  const selectedLocationKey = selectedLocationIds.join("|");
  const selectedLocationsForMetrics = useMemo(
    () =>
      locations.filter((location) =>
        selectedLocationIds.includes(location.shopify_location_id),
      ),
    [locations, selectedLocationKey],
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
        startDate,
        endDate,
        period,
      }).rows,
    [drilldownRows, startDate, endDate, period],
  );
  const drilldownRevenueByVendor = useMemo(
    () =>
      computeRevenueBreakdown({
        orderLines: drilldownRows,
        limit: 8,
        getLabel: getVendorDrilldownValue,
        getValue: getVendorDrilldownValue,
      }),
    [drilldownRows],
  );
  const drilldownRevenueByStaff = useMemo(
    () =>
      computeRevenueBreakdown({
        orderLines: drilldownRows,
        limit: 8,
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
      }).rows,
    [locationsForDrilldownMetrics, drilldownRows, expensesByLocation],
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

  return (
    <main
      style={{
        background: "#f6f6f7",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        minHeight: "100vh",
        padding: 28,
      }}
    >
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
            <h1 style={{ fontSize: 28, lineHeight: 1.15, margin: 0 }}>
              Locations
            </h1>
            <p style={{ color: "#616161", margin: "6px 0 0" }}>
              Compare sales, margin and expenses across locations.
            </p>
          </div>

          <Form
            id="locations-filter-form"
            method="get"
            onSubmit={() => setIsDirty(false)}
            style={{ display: "grid", gap: 16 }}
          >
            {preservedSearchParams.map(({ name, value }, index) => (
              <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
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
                  style={{ border: "1px solid #c9cccf", borderRadius: 10, padding: 10 }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                End date
                <input
                  name="endDate"
                  type="date"
                  defaultValue={endDate}
                  onChange={() => setIsDirty(true)}
                  style={{ border: "1px solid #c9cccf", borderRadius: 10, padding: 10 }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Staff
                <select
                  name="staff"
                  defaultValue={selectedStaff}
                  onChange={() => setIsDirty(true)}
                  style={{ border: "1px solid #c9cccf", borderRadius: 10, padding: 10 }}
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
                  style={{ border: "1px solid #c9cccf", borderRadius: 10, padding: 10 }}
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
                <div style={{ color: "#616161", fontSize: 13, fontWeight: 800 }}>
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
                      checked={draftLocationIds.includes(location.shopify_location_id)}
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

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <AppButton
                type="submit"
                name="preset"
                value="today"
                variant="secondary"
                onClick={() => setIsDirty(false)}
              >
                Today
              </AppButton>
              <AppButton
                type="submit"
                variant="primary"
                onClick={() => setIsDirty(false)}
              >
                Apply
              </AppButton>
            </div>
          </Form>
        </section>

        <p style={{ color: "#707070", fontSize: 13, margin: "0 0 16px" }}>
          V1 expenses include location-specific active fixed expenses only.
          Global/unassigned expenses are not allocated
          {hasGlobalExpenses ? " in this view." : "."}
        </p>

        {errors.length > 0 ? (
          <section
            style={{
              background: "#fff4f4",
              border: "1px solid #f2b8b5",
              borderRadius: 14,
              marginBottom: 20,
              padding: 18,
            }}
          >
            <strong>Errors</strong>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(errors, null, 2)}
            </pre>
          </section>
        ) : null}

        <KpiGrid kpis={kpis} />
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
          selectedLocation={activeDrilldowns.location?.value ?? null}
          onSelectLocation={(row) =>
            toggleDrilldown("location", {
              value: row.locationId,
              label: row.locationName,
            })
          }
        />
      </div>
    </main>
  );
}
