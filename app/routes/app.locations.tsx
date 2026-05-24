import type { LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
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
  revenue: number;
  ordersCount: number;
  unitsSold: number;
};

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
  bucketLabel: string;
  kpis: Omit<LocationMetricRow, "locationId" | "locationName">;
  locationRows: LocationMetricRow[];
  trendRows: TrendRow[];
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

function computeMetrics({
  locations,
  orderLines,
  expensesByLocation,
}: {
  locations: LocationRow[];
  orderLines: OrderLineDbRow[];
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

function computeTrendRows({
  orderLines,
  startDate,
  endDate,
  selectedDays,
}: {
  orderLines: OrderLineDbRow[];
  startDate: string;
  endDate: string;
  selectedDays: number;
}) {
  const { bucketKind, keys } = buildBucketKeys({
    startDate,
    endDate,
    selectedDays,
  });
  const ordersByBucket = new Map<string, Set<string>>();
  const rowsByBucket = new Map<string, TrendRow>(
    keys.map((key) => [
      key,
      {
        period: key,
        revenue: 0,
        ordersCount: 0,
        unitsSold: 0,
      },
    ]),
  );

  for (const row of orderLines) {
    const key = getBucketKey(row.created_at_shopify, bucketKind);
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
    bucketLabel: bucketKind === "day" ? "day" : bucketKind,
    rows: Array.from(rowsByBucket.values()),
  };
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
    selectedDays,
  });

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
    bucketLabel: trend.bucketLabel,
    kpis: metrics.totals,
    locationRows: metrics.rows,
    trendRows: trend.rows,
    hasGlobalExpenses,
    errors,
  } satisfies LoaderData;
}

function KpiGrid({ kpis }: { kpis: LoaderData["kpis"] }) {
  const items = [
    ["Revenue", formatCurrency(kpis.revenue)],
    ["Orders", formatNumber(kpis.ordersCount)],
    ["Units sold", formatNumber(kpis.unitsSold)],
    ["COGS", formatCurrency(kpis.cogs)],
    ["Gross profit", formatCurrency(kpis.grossProfit)],
    ["Gross margin", formatPercent(kpis.grossMarginPct)],
    ["Expenses", formatCurrency(kpis.expenses)],
    ["Net profit", formatCurrency(kpis.netProfit)],
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
      {items.map(([label, value]) => (
        <div
          key={label}
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 14,
            padding: 16,
          }}
        >
          <div style={{ color: "#616161", fontSize: 12, fontWeight: 800 }}>
            {label}
          </div>
          <div style={{ color: "#202223", fontSize: 22, fontWeight: 800 }}>
            {value}
          </div>
        </div>
      ))}
    </section>
  );
}

function TrendChart({
  rows,
  bucketLabel,
}: {
  rows: TrendRow[];
  bucketLabel: string;
}) {
  const maxRevenue = Math.max(...rows.map((row) => row.revenue), 0);
  const maxOrders = Math.max(...rows.map((row) => row.ordersCount), 0);
  const hasSales = rows.some((row) => row.revenue > 0 || row.ordersCount > 0);
  const revenueMaxHeight = 150;
  const ordersMaxHeight = 84;

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
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Sales trend by period</h2>
        <p style={{ color: "#616161", margin: "4px 0 0" }}>
          Revenue and orders grouped by {bucketLabel}.
        </p>
      </div>

      {hasSales ? (
        <div
          style={{
            display: "grid",
            gap: 6,
            gridTemplateColumns: `repeat(${rows.length}, minmax(38px, 1fr))`,
            overflowX: "auto",
            paddingTop: 8,
          }}
        >
          {rows.map((row) => {
            const revenueHeight =
              maxRevenue > 0
                ? Math.max((row.revenue / maxRevenue) * revenueMaxHeight, 4)
                : 0;
            const ordersHeight =
              maxOrders > 0
                ? Math.max((row.ordersCount / maxOrders) * ordersMaxHeight, 4)
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
                style={{
                  display: "grid",
                  gridTemplateRows: "18px 150px 28px 84px",
                  justifyItems: "center",
                  minWidth: 38,
                }}
              >
                <div
                  style={{
                    color: "#374151",
                    fontSize: 10,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.revenue > 0 ? formatCurrency(row.revenue) : ""}
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
                      maxWidth: 34,
                      width: "80%",
                    }}
                  />
                </div>
                <div
                  style={{
                    borderTop: "1px solid #d1d5db",
                    color: "#616161",
                    fontSize: 11,
                    fontWeight: 800,
                    lineHeight: "27px",
                    textAlign: "center",
                    width: "100%",
                  }}
                >
                  {row.period}
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
                      background: row.ordersCount > 0 ? "#14b8a6" : "#e5e7eb",
                      borderRadius: "2px 2px 6px 6px",
                      height: ordersHeight,
                      maxWidth: 34,
                      width: "80%",
                    }}
                  />
                </div>
              </div>
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
          No sales available for this period.
        </div>
      )}
    </section>
  );
}

function LocationTable({ rows }: { rows: LocationMetricRow[] }) {
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
              {[
                "Location",
                "Revenue",
                "Orders",
                "Units",
                "COGS",
                "Gross profit",
                "Gross margin",
                "Expenses",
                "Net profit",
                "AOV",
              ].map((header) => (
                <th
                  key={header}
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
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.locationId}>
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
              ))
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
    trendRows,
    bucketLabel,
    hasGlobalExpenses,
    errors,
  } = useLoaderData<LoaderData>();
  const [draftLocationIds, setDraftLocationIds] = useState(selectedLocationIds);
  useEffect(() => {
    setDraftLocationIds(selectedLocationIds);
  }, [selectedLocationIds]);
  const allLocationsSelected = draftLocationIds.length === locations.length;

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

          <Form method="get" style={{ display: "grid", gap: 16 }}>
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
                  style={{ border: "1px solid #c9cccf", borderRadius: 10, padding: 10 }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                End date
                <input
                  name="endDate"
                  type="date"
                  defaultValue={endDate}
                  style={{ border: "1px solid #c9cccf", borderRadius: 10, padding: 10 }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Staff
                <select
                  name="staff"
                  defaultValue={selectedStaff}
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
              <div style={{ color: "#616161", fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                Locations
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  onClick={() =>
                    setDraftLocationIds(
                      locations.map((location) => location.shopify_location_id),
                    )
                  }
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
                      onChange={(event) =>
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
                        )
                      }
                    />
                    {location.name}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <AppButton type="submit" name="preset" value="today" variant="secondary">
                Today
              </AppButton>
              <AppButton type="submit" variant="primary">
                Apply
              </AppButton>
            </div>
          </Form>
        </section>

        {hasGlobalExpenses ? (
          <p style={{ color: "#707070", fontSize: 13, margin: "0 0 16px" }}>
            Global expenses are not allocated across locations in this V1 view.
          </p>
        ) : null}

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
        <TrendChart rows={trendRows} bucketLabel={bucketLabel} />
        <LocationTable rows={locationRows} />
      </div>
    </main>
  );
}
