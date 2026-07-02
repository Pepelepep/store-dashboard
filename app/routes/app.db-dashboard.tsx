import type { LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getPermissionContext } from "../lib/auth/permissions.server";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
import { ActiveDrilldownBadge } from "../components/dashboard/ActiveDrilldownBadge";
import { BestSellersCard } from "../components/dashboard/BestSellersCard";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { KpiCards } from "../components/dashboard/KpiCards";
import { RecentOrderLinesCard } from "../components/dashboard/RecentOrderLinesCard";
import { SalesByHourCard } from "../components/dashboard/SalesByHourCard";
import { SalesByStaffCard } from "../components/dashboard/SalesByStaffCard";
import { SalesByVendorCard } from "../components/dashboard/SalesByVendorCard";
import { StockAlertsCard } from "../components/dashboard/StockAlertsCard";
import { PageNotice } from "../components/ui/PageNotice";
import {
  buildShopifyOrderUrl,
  applyDashboardDrilldowns,
  computeBestSellers,
  computeExpensesForRange,
  computeSalesByHour,
  computeSalesByStaff,
  computeSalesByVendor,
  computeStockAlerts,
  daysBetween,
  getBestSellerDrilldownValue,
  getLineCogsV2,
  getLineDiscounts,
  getLineGrossSales,
  getLineNetSales,
  getLineRefundedAmount,
  getLineReturnedQuantity,
  getLineReturns,
  getStaffDisplayLabel,
  getStaffFilterValue,
  getTodayStoreDate,
  getVendorFilterValue,
  isActiveInventoryProduct,
  nextDate,
  normalizeFinancialMetricsVersion,
  storeDateToUtcIso,
  UNKNOWN_STAFF_FILTER_VALUE,
} from "../lib/dashboard/dashboard-metrics";
import type {
  ActiveDrilldowns,
  DashboardLoaderData as LoaderData,
  DashboardSalesOrderLineRow,
  FixedExpenseDbRow,
  InventoryLevelDbRow,
  LocationRow,
  OrderLineDbRow,
  ProductDbRow,
  RecentOrderRow,
  VariantDbRow,
} from "../lib/dashboard/dashboard-types";

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

    if (vendor) {
      vendors.add(vendor);
    }
  }

  return Array.from(vendors)
    .sort((a, b) => a.localeCompare(b))
    .map((vendor) => ({
      value: vendor,
      label: vendor,
    }));
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

type OrderTransactionDbRow = {
  shopify_order_id: string;
  shopify_transaction_id: string;
  kind: string | null;
  status: string | null;
  amount: number | null;
  processed_at: string | null;
};

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
  const errors: string[] = [];

  for (const batch of chunkArray(orderIds, 500)) {
    const { data, error } = await supabase
      .from("order_transactions")
      .select(
        "shopify_order_id, shopify_transaction_id, kind, status, amount, processed_at",
      )
      .eq("shop_domain", shop)
      .gte("processed_at", startDateUtc)
      .lt("processed_at", endExclusiveUtc)
      .in("shopify_order_id", batch);

    if (error) {
      errors.push(error.message);
      continue;
    }

    rows.push(
      ...((data ?? []) as OrderTransactionDbRow[]).filter(
        isSuccessfulRefundTransaction,
      ),
    );
  }

  return { rows, errors };
}

function getRecentOrderChips(row: DashboardSalesOrderLineRow) {
  const chips: string[] = [];
  const refundedAmount = getLineRefundedAmount(row);
  const netSales = getLineNetSales(row);

  if (getLineDiscounts(row) > 0) chips.push("Discounted");
  if (getLineReturns(row) > 0 || getLineReturnedQuantity(row) > 0) {
    chips.push("Returned");
  }
  if (refundedAmount > 0) chips.push("Refunded");
  if (refundedAmount > 0 && netSales > 0) chips.push("Partial refund");

  return chips;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.db-dashboard",
    shop: session.shop,
    supabase,
  });
  const permissions = await getPermissionContext({
    request,
    session,
    supabase,
  });
  const url = new URL(request.url);
  const preservedSearchParams = Array.from(url.searchParams.entries())
    .filter(
      ([name]) =>
        ![
          "locationId",
          "startDate",
          "endDate",
          "preset",
          "staff",
          "vendor",
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
  const endExclusive = nextDate(endDate);
  const startDateUtc = storeDateToUtcIso(startDate);
  const endExclusiveUtc = storeDateToUtcIso(endExclusive);
  const selectedDays = daysBetween(startDate, endExclusive);
  const errors: string[] = [];
  const financialMetricsVersion = normalizeFinancialMetricsVersion(
    process.env.FINANCIAL_METRICS_VERSION,
  );
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const orderLinesSelect = isFinancialMetricsV2
    ? "*"
    : "order_name, shopify_order_id, created_at_shopify, retail_location_id, retail_location_name, product_title, variant_title, sku, vendor, quantity, unit_price, revenue, unit_cost, cogs, gross_profit, cost_source, staff_member_id, staff_member_name, staff_member_email, staff_source";

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name, is_active")
    .eq("shop_domain", session.shop)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (locationsError) errors.push(locationsError.message);

  const allLocations = (locationsData ?? []) as LocationRow[];
  const locations = permissions.isAdmin
    ? allLocations
    : allLocations.filter((location) =>
        permissions.allowedLocationIds.has(location.shopify_location_id),
      );
  const noAssignedLocations = !permissions.isAdmin && locations.length === 0;
  const requestedLocationId = url.searchParams.get("locationId");
  const selectedLocation =
    locations.find(
      (location) => location.shopify_location_id === requestedLocationId,
    ) ??
    locations[0] ??
    null;
  const selectedLocationId = selectedLocation?.shopify_location_id ?? null;
  const selectedLocationName = selectedLocation?.name ?? null;

  const { data: lastSuccessfulSyncRun, error: lastSuccessfulSyncError } =
    await supabase
      .from("sync_runs")
      .select("finished_at")
      .eq("shop_domain", session.shop)
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentSyncFailureCount, error: recentSyncFailureError } =
    await supabase
      .from("sync_runs")
      .select("*", { count: "exact", head: true })
      .eq("shop_domain", session.shop)
      .eq("status", "error")
      .gte("started_at", since24h);

  const [
    orderLinesResult,
    inventoryResult,
    variantsResult,
    productsResult,
    expensesResult,
  ] = await Promise.all([
    selectedLocationId
      ? supabase
          .from("order_lines")
          .select(orderLinesSelect)
          .eq("shop_domain", session.shop)
          .eq("retail_location_id", selectedLocationId)
          .gte("created_at_shopify", startDateUtc)
          .lt("created_at_shopify", endExclusiveUtc)
          .order("created_at_shopify", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    selectedLocationId
      ? supabase
          .from("inventory_levels")
          .select(
            "shopify_location_id, shopify_variant_id, inventory_item_id, sku, available, tracked",
          )
          .eq("shop_domain", session.shop)
          .eq("shopify_location_id", selectedLocationId)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("variants")
      .select(
        "shopify_variant_id, shopify_product_id, inventory_item_id, title, sku, unit_cost",
      )
      .eq("shop_domain", session.shop),
    supabase
      .from("products")
      .select("shopify_product_id, title, vendor, status")
      .eq("shop_domain", session.shop),
    supabase
      .from("fixed_expenses")
      .select(
        "expense_name, expense_category, monthly_amount, shopify_location_id, location_name, start_month, end_month, is_active",
      )
      .eq("shop_domain", session.shop)
      .eq("is_active", true),
  ]);

  if (orderLinesResult.error) errors.push(orderLinesResult.error.message);
  if (inventoryResult.error) errors.push(inventoryResult.error.message);
  if (variantsResult.error) errors.push(variantsResult.error.message);
  if (productsResult.error) errors.push(productsResult.error.message);
  if (expensesResult.error) errors.push(expensesResult.error.message);
  if (lastSuccessfulSyncError) errors.push(lastSuccessfulSyncError.message);
  if (recentSyncFailureError) errors.push(recentSyncFailureError.message);

  const orderLines = (orderLinesResult.data ?? []) as unknown as OrderLineDbRow[];
  const inventoryRows = (inventoryResult.data ?? []) as InventoryLevelDbRow[];
  const variants = (variantsResult.data ?? []) as VariantDbRow[];
  const products = (productsResult.data ?? []) as ProductDbRow[];
  const expenses = (expensesResult.data ?? []) as FixedExpenseDbRow[];
  if (allLocations.length === 0 || orderLines.length === 0) {
    logEmptyDataState({
      route: "app.db-dashboard",
      shop: session.shop,
      reason:
        allLocations.length === 0
          ? "no_synced_locations"
          : "no_order_lines_for_selected_period",
      counts: {
        locations: allLocations.length,
        orderLines: orderLines.length,
        products: products.length,
        inventoryRows: inventoryRows.length,
        expenses: expenses.length,
      },
    });
  }
  const variantsById = new Map(
    variants.map((variant) => [variant.shopify_variant_id, variant]),
  );
  const productsById = new Map(
    products.map((product) => [product.shopify_product_id, product]),
  );
  const activeInventoryRows = inventoryRows.filter((inventory) =>
    isActiveInventoryProduct({ inventory, variantsById, productsById }),
  );
  const staffOptions = buildStaffOptions(orderLines);
  const vendorOptions = buildVendorOptions(orderLines);
  const filteredOrderLines = filterOrderLines({
    orderLines,
    selectedStaff,
    selectedVendor,
  });
  const revenue = isFinancialMetricsV2
    ? filteredOrderLines.reduce((sum, row) => sum + getLineNetSales(row), 0)
    : filteredOrderLines.reduce(
        (sum, row) => sum + Number(row.revenue ?? 0),
        0,
      );
  const grossSales = isFinancialMetricsV2
    ? filteredOrderLines.reduce((sum, row) => sum + getLineGrossSales(row), 0)
    : revenue;
  const discounts = isFinancialMetricsV2
    ? filteredOrderLines.reduce((sum, row) => sum + getLineDiscounts(row), 0)
    : 0;
  const returns = isFinancialMetricsV2
    ? filteredOrderLines.reduce((sum, row) => sum + getLineReturns(row), 0)
    : 0;
  const returnedQuantity = isFinancialMetricsV2
    ? filteredOrderLines.reduce(
        (sum, row) => sum + getLineReturnedQuantity(row),
        0,
      )
    : 0;
  const returnedOrdersCount = isFinancialMetricsV2
    ? new Set(
        filteredOrderLines
          .filter(
            (row) =>
              getLineReturns(row) > 0 || getLineReturnedQuantity(row) > 0,
          )
          .map((row) => row.shopify_order_id),
      ).size
    : 0;
  const cogs = isFinancialMetricsV2
    ? filteredOrderLines.reduce((sum, row) => sum + getLineCogsV2(row), 0)
    : filteredOrderLines.reduce((sum, row) => sum + Number(row.cogs ?? 0), 0);
  const grossProfit = isFinancialMetricsV2
    ? revenue - cogs
    : filteredOrderLines.reduce(
        (sum, row) => sum + Number(row.gross_profit ?? 0),
        0,
      );
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const uniqueOrders = new Set(
    filteredOrderLines.map((row) => row.shopify_order_id),
  );
  const ordersCount = uniqueOrders.size;
  const refundTransactionsResult =
    isFinancialMetricsV2 && uniqueOrders.size > 0
      ? await fetchRefundTransactionsForOrders({
          supabase,
          shop: session.shop,
          orderIds: Array.from(uniqueOrders),
          startDateUtc,
          endExclusiveUtc,
        })
      : { rows: [], errors: [] };
  errors.push(...refundTransactionsResult.errors);
  const refunds = refundTransactionsResult.rows.reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  );
  const refundTransactionsCount = refundTransactionsResult.rows.length;
  const refundedOrdersCount = new Set(
    refundTransactionsResult.rows.map((row) => row.shopify_order_id),
  ).size;
  const refundAllocationWarning =
    isFinancialMetricsV2 && (selectedStaff || selectedVendor)
      ? "Refunds are order-level and may not be fully allocated to individual staff/vendor/product."
      : null;
  const unitsSold = filteredOrderLines.reduce(
    (sum, row) => sum + Number(row.quantity ?? 0),
    0,
  );
  const averageOrderValue = ordersCount > 0 ? revenue / ordersCount : 0;
  const inventoryUnits = activeInventoryRows.reduce(
    (sum, row) => sum + Number(row.available ?? 0),
    0,
  );
  const expensesToDate = computeExpensesForRange({
    expenses,
    selectedLocationId,
    selectedDays,
    startDate,
    endDate,
    activeLocationCount: locations.length,
  });
  const netProfit =
    expensesToDate === null ? null : grossProfit - Number(expensesToDate);
  const stockAlerts = computeStockAlerts({
    inventoryRows: activeInventoryRows,
    orderLines,
    variantsById,
    productsById,
    periodDays: selectedDays,
  }).filter((row) => !selectedVendor || row.vendor === selectedVendor);
  const criticalStockCount = stockAlerts.filter(
    (row) => row.status === "Critical",
  ).length;
  const salesOrderLines: DashboardSalesOrderLineRow[] = filteredOrderLines.map(
    (row) => ({
      order_name: row.order_name,
      shopify_order_id: row.shopify_order_id,
      created_at_shopify: row.created_at_shopify,
      product_title: row.product_title,
      sku: row.sku,
      quantity: Number(row.quantity ?? 0),
      revenue: isFinancialMetricsV2
        ? getLineNetSales(row)
        : Number(row.revenue ?? 0),
      cogs: isFinancialMetricsV2
        ? getLineCogsV2(row)
        : row.cogs === null
          ? null
          : Number(row.cogs ?? 0),
      gross_profit: isFinancialMetricsV2
        ? getLineNetSales(row) - getLineCogsV2(row)
        : row.gross_profit === null
          ? null
          : Number(row.gross_profit ?? 0),
      gross_sales: isFinancialMetricsV2 ? getLineGrossSales(row) : undefined,
      discounts: isFinancialMetricsV2 ? getLineDiscounts(row) : undefined,
      returns: isFinancialMetricsV2 ? getLineReturns(row) : undefined,
      net_sales: isFinancialMetricsV2 ? getLineNetSales(row) : undefined,
      refunded_amount: isFinancialMetricsV2
        ? getLineRefundedAmount(row)
        : undefined,
      returned_quantity: isFinancialMetricsV2
        ? getLineReturnedQuantity(row)
        : undefined,
      cost_at_sale: isFinancialMetricsV2
        ? row.cost_at_sale === null || row.cost_at_sale === undefined
          ? null
          : Number(row.cost_at_sale)
        : undefined,
      vendor: row.vendor,
      staff_member_id: row.staff_member_id,
      staff_member_name: row.staff_member_name,
      staff_member_email: row.staff_member_email,
    }),
  );

  return {
    shop: session.shop,
    locations,
    selectedLocationId,
    selectedLocationName,
    selectedStaff,
    selectedVendor,
    staffOptions,
    vendorOptions,
    startDate,
    endDate,
    preservedSearchParams,
    lastSuccessfulSync: lastSuccessfulSyncRun?.finished_at ?? null,
    readiness: {
      canAdmin: permissions.isAdmin,
      activeLocationsCount: allLocations.length,
      accessibleLocationsCount: locations.length,
      selectedLocationsCount: selectedLocationId ? 1 : 0,
      orderLinesForSelectedPeriod: orderLines.length,
      productsCount: products.length,
      inventoryRowsCount: inventoryRows.length,
      hasRecentSyncFailure: (recentSyncFailureCount ?? 0) > 0,
      noAssignedLocations,
    },
    selectedDays,
    financialMetricsVersion,
    kpis: {
      revenue,
      grossSales,
      discounts,
      returns,
      refunds,
      refundTransactionsCount,
      refundedOrdersCount,
      returnedQuantity,
      returnedOrdersCount,
      refundAllocationWarning,
      cogs,
      grossProfit,
      grossMarginPct,
      ordersCount,
      unitsSold,
      averageOrderValue,
      inventoryUnits,
      criticalStockCount,
      expenses: expensesToDate,
      netProfit,
    },
    stockAlerts,
    salesOrderLines,
    errors,
  } satisfies LoaderData;
}

function createRecentOrders({
  shop,
  orderLines,
}: {
  shop: string;
  orderLines: DashboardSalesOrderLineRow[];
}): RecentOrderRow[] {
  return orderLines.slice(0, 30).map((row) => ({
    orderName: row.order_name,
    orderUrl: buildShopifyOrderUrl(shop, row.shopify_order_id),
    date: row.created_at_shopify,
    product: row.product_title ?? "-",
    sku: row.sku ?? "-",
    quantity: Number(row.quantity ?? 0),
    revenue: Number(row.revenue ?? 0),
    cogs: row.cogs === null ? null : Number(row.cogs ?? 0),
    grossProfit:
      row.gross_profit === null ? null : Number(row.gross_profit ?? 0),
    grossSales: row.gross_sales ?? null,
    discounts: row.discounts ?? null,
    netSales: row.net_sales ?? null,
    returns: row.returns ?? null,
    refundedAmount: row.refunded_amount ?? null,
    returnedQuantity: row.returned_quantity ?? null,
    costAtSale: row.cost_at_sale ?? null,
    chips: getRecentOrderChips(row),
    costSource: "-",
  }));
}

function isSameDrilldown(
  current: { value: string; label: string } | null | undefined,
  next: { value: string; label: string },
) {
  return String(current?.value) === String(next.value);
}

const emptyDrilldowns: ActiveDrilldowns = {};

export default function DbDashboardPage() {
  const {
    shop,
    locations,
    selectedLocationId,
    selectedLocationName,
    selectedStaff,
    selectedVendor,
    staffOptions,
    vendorOptions,
    startDate,
    endDate,
    preservedSearchParams,
    lastSuccessfulSync,
    readiness,
    selectedDays,
    financialMetricsVersion,
    kpis,
    stockAlerts,
    salesOrderLines,
    errors,
  } = useLoaderData<LoaderData>();
  const [activeDrilldowns, setActiveDrilldowns] =
    useState<ActiveDrilldowns>(emptyDrilldowns);
  const drilldownOrderLines = useMemo(
    () => applyDashboardDrilldowns(salesOrderLines, activeDrilldowns),
    [salesOrderLines, activeDrilldowns],
  );
  const drilldownBestSellers = useMemo(
    () => computeBestSellers(drilldownOrderLines),
    [drilldownOrderLines],
  );
  const drilldownSalesByVendor = useMemo(
    () => computeSalesByVendor(drilldownOrderLines),
    [drilldownOrderLines],
  );
  const drilldownSalesByStaff = useMemo(
    () => computeSalesByStaff(drilldownOrderLines),
    [drilldownOrderLines],
  );
  const drilldownSalesByHour = useMemo(
    () => computeSalesByHour(drilldownOrderLines),
    [drilldownOrderLines],
  );
  const drilldownRecentOrders = useMemo(
    () => createRecentOrders({ shop, orderLines: drilldownOrderLines }),
    [shop, drilldownOrderLines],
  );
  const selectedHour = activeDrilldowns.hour ?? null;
  const selectedProductKey = activeDrilldowns.product?.value ?? null;
  const selectedStaffKey = activeDrilldowns.staff?.value ?? null;
  const selectedVendorKey = activeDrilldowns.vendor?.value ?? null;
  const toggleHourDrilldown = (hour: number) => {
    setActiveDrilldowns((current) => ({
      ...current,
      hour: current.hour === hour ? null : hour,
    }));
  };
  const toggleDrilldown = (
    key: "product" | "staff" | "vendor",
    next: { value: string; label: string },
  ) => {
    setActiveDrilldowns((current) => ({
      ...current,
      [key]: isSameDrilldown(current[key], next) ? null : next,
    }));
  };
  const syncCenterCta = readiness.canAdmin
    ? { to: "/app/admin/sync", label: "Open Sync Status" }
    : undefined;
  const isFirstRunPreparing =
    readiness.activeLocationsCount === 0 ||
    (!lastSuccessfulSync && readiness.orderLinesForSelectedPeriod === 0);
  const hasNoSalesForPeriod =
    !isFirstRunPreparing &&
    readiness.accessibleLocationsCount > 0 &&
    readiness.orderLinesForSelectedPeriod === 0;
  const hasProductInventoryGap =
    !isFirstRunPreparing &&
    (readiness.productsCount === 0 || readiness.inventoryRowsCount === 0);
  const confidenceStatus = isFirstRunPreparing
    ? "Preparing"
    : readiness.hasRecentSyncFailure || hasProductInventoryGap
      ? "Needs review"
      : "Current";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f6f7",
        padding: 28,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        {readiness.noAssignedLocations ? (
          <PageNotice
            title="You do not have access to any locations yet."
            message="Ask an app admin to assign your location access."
            bullets={[
              "ShopOps Studio keeps dashboard data filtered to locations you are allowed to view.",
              "After an admin grants access, return to the dashboard to review your assigned location reports.",
            ]}
            tone="warning"
          />
        ) : isFirstRunPreparing ? (
          <PageNotice
            title="Your data is being prepared"
            message="Reports appear after Shopify data sync completes. ShopOps Studio helps multi-location merchants understand sales, margins, inventory, staff attribution, expenses, refunds, returns, and sync health."
            bullets={
              readiness.canAdmin
                ? [
                    "Check Sync Status to confirm whether locations, products, inventory, and orders have synced.",
                    "Dashboard reports populate automatically once synced Shopify data is available.",
                    "You can return here once sync finishes to review sales, margins, inventory, and data confidence.",
                  ]
                : [
                    "Ask an app admin to confirm sync status.",
                    "If you should see a location, ask an app admin to assign your location access.",
                  ]
            }
            cta={syncCenterCta}
            tone="info"
          />
        ) : null}

        <DashboardHeader
          locations={locations}
          selectedLocationId={selectedLocationId}
          selectedLocationName={selectedLocationName}
          selectedStaff={selectedStaff}
          selectedVendor={selectedVendor}
          staffOptions={staffOptions}
          vendorOptions={vendorOptions}
          startDate={startDate}
          endDate={endDate}
          preservedSearchParams={preservedSearchParams}
          lastSuccessfulSync={lastSuccessfulSync}
          selectedDays={selectedDays}
          confidenceStatus={confidenceStatus}
        />

        {errors.length > 0 ? (
          <section
            style={{
              background: "#fff4f4",
              border: "1px solid #f2b8b5",
              borderRadius: 14,
              padding: 18,
              marginBottom: 20,
            }}
          >
            <strong>Errors</strong>
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(errors, null, 2)}
            </pre>
          </section>
        ) : null}

        {!readiness.noAssignedLocations && hasNoSalesForPeriod ? (
          <PageNotice
            title="No sales for this period."
            message="Try another date range or confirm sync status."
            bullets={[
              "Filters remain available so you can review another location, staff member, vendor, or date range.",
              readiness.canAdmin
                ? "Admins can check Sync Status if sales should already be available."
                : "Ask an app admin to confirm sync status if sales should already be available.",
            ]}
            cta={syncCenterCta}
            tone="neutral"
          />
        ) : null}

        {!readiness.noAssignedLocations && hasProductInventoryGap ? (
          <PageNotice
            title="Inventory and margin context may still be preparing."
            message="Inventory and margin context may appear after product and inventory sync completes."
            bullets={[
              "Sales reporting can appear before every product, variant, or inventory row is available.",
              "Stock alerts and cost context may be limited until product and inventory syncs finish.",
            ]}
            cta={syncCenterCta}
            tone="warning"
          />
        ) : null}

        {!readiness.noAssignedLocations && readiness.hasRecentSyncFailure ? (
          <PageNotice
            title="Recent sync failures need review."
            message="Some sync work failed in the last 24 hours, so reports may be incomplete until an admin reviews sync health."
            bullets={[
              readiness.canAdmin
                ? "Open Sync Status to review failed sync runs and recent jobs."
                : "Ask an app admin to review sync status if reports look incomplete.",
            ]}
            cta={syncCenterCta}
            tone="warning"
          />
        ) : null}

        {!readiness.noAssignedLocations && !isFirstRunPreparing ? (
          <>
            <KpiCards
              kpis={kpis}
              financialMetricsVersion={financialMetricsVersion}
            />

            <ActiveDrilldownBadge
              activeDrilldowns={activeDrilldowns}
              onClearOne={(key) =>
                setActiveDrilldowns((current) => ({
                  ...current,
                  [key]: null,
                }))
              }
              onClearAll={() => setActiveDrilldowns(emptyDrilldowns)}
            />

            <div style={{ marginBottom: 20 }}>
              <SalesByHourCard
                salesByHour={drilldownSalesByHour}
                financialMetricsVersion={financialMetricsVersion}
                selectedHour={selectedHour}
                onSelectHour={toggleHourDrilldown}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
                gap: 20,
                marginBottom: 20,
              }}
            >
              <BestSellersCard
                bestSellers={drilldownBestSellers}
                financialMetricsVersion={financialMetricsVersion}
                selectedProductKey={selectedProductKey}
                onSelectBestSeller={(row) =>
                  toggleDrilldown("product", {
                    value: getBestSellerDrilldownValue(row),
                    label:
                      row.sku && row.sku !== "-"
                        ? `${row.product} / ${row.sku}`
                        : row.product,
                  })
                }
              />

              <StockAlertsCard stockAlerts={stockAlerts} />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: 20,
                marginBottom: 20,
              }}
            >
              <SalesByStaffCard
                salesByStaff={drilldownSalesByStaff}
                financialMetricsVersion={financialMetricsVersion}
                selectedStaffKey={selectedStaffKey}
                onSelectStaff={(row) =>
                  toggleDrilldown("staff", {
                    value: row.staffKey,
                    label: row.staff,
                  })
                }
              />

              <SalesByVendorCard
                salesByVendor={drilldownSalesByVendor}
                financialMetricsVersion={financialMetricsVersion}
                selectedVendorKey={selectedVendorKey}
                onSelectVendor={(row) =>
                  toggleDrilldown("vendor", {
                    value: row.vendor,
                    label: row.vendor,
                  })
                }
              />
            </div>

            <RecentOrderLinesCard
              recentOrders={drilldownRecentOrders}
              financialMetricsVersion={financialMetricsVersion}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
