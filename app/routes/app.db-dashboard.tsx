import type { LoaderFunctionArgs } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { Link, useLoaderData, useLocation } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { fetchAllSupabasePages } from "../lib/db/supabase-pagination.server";
import { assertReportingEntitlements } from "../lib/entitlements.server";
import { resolveReportingScope } from "../lib/auth/location-performance-access";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
import { fetchStaffIdentityAliasesForOrderLines } from "../lib/staff-identity/staff-identity.server";
import { resolveStaffDisplayNameForOrderLine } from "../lib/staff-identity/staff-identity";
import {
  getSyncFailureBannerState,
  getUnresolvedSyncFailureState,
} from "../lib/sync/sync-failure-resolution";
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
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { AppButtonLink } from "../components/ui/AppButton";
import {
  CompactEmptyDataNotice,
  ShopOpsPage,
} from "../components/ui/ShopOpsPage";
import { getDataSyncPath } from "../lib/navigation/sync-status";
import {
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
import { buildShopifyOrderUrl } from "../lib/shopify/order-url";
import { getRecentOrderChips } from "../lib/dashboard/recent-order-flags";
import { buildDrilldownResetKey } from "../lib/dashboard/drilldown-reset-key";
import { calculateReportedProfit, summarizeCogs } from "../lib/financial/cogs";
import { calculateNetSalesAfterCashRefunds } from "../lib/financial/net-sales";
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
      label: "Unassigned / unavailable",
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
  id: string;
  shopify_order_id: string;
  shopify_transaction_id: string;
  kind: string | null;
  status: string | null;
  amount: number | null;
  processed_at: string | null;
};

type SyncFailureInputs = Parameters<typeof getUnresolvedSyncFailureState>[0];
type SyncRunRow = SyncFailureInputs["runs"][number] & { id: string };
type SyncJobRow = SyncFailureInputs["jobs"][number] & { id: string };
type WebhookFailureRow = SyncFailureInputs["webhookEvents"][number] & {
  id: string;
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

  for (const batch of chunkArray(orderIds, 500)) {
    const batchRows = await fetchAllSupabasePages<OrderTransactionDbRow>({
      label: "Refund transactions",
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.db-dashboard",
    shop: session.shop,
    supabase,
  });
  const { permissions, entitlements } = await assertReportingEntitlements({
    deniedNotice: "dashboard_role",
    deniedRedirectTo: "/app/locations",
    request,
    requiredCapability: "view_dashboard",
    route: "app.db-dashboard",
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
  const financialMetricsVersion = normalizeFinancialMetricsVersion(
    process.env.FINANCIAL_METRICS_VERSION,
  );
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const orderLinesSelect = isFinancialMetricsV2
    ? "*"
    : "id, order_name, shopify_order_id, created_at_shopify, retail_location_id, retail_location_name, product_title, variant_title, sku, vendor, quantity, unit_price, revenue, unit_cost, cogs, gross_profit, cost_source, returned_quantity, cost_at_sale, staff_member_id, staff_member_name, staff_member_email, staff_source, shopops_staff_member_id, shopops_user_id, shopops_attributed_user_id, shopops_effective_staff_id, shopops_attribution_source, shopops_pos_location_id, shopops_pos_device_id, shopops_pos_device_name";

  const locationsData = await fetchAllSupabasePages<
    LocationRow & { id: string }
  >({
    label: "Locations",
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

  const allLocations = locationsData as LocationRow[];
  const requestedLocationId = url.searchParams.get("locationId");
  const reportingScope = resolveReportingScope({
    locations: allLocations,
    permissions,
    requestedLocationIds:
      requestedLocationId && requestedLocationId !== "all"
        ? [requestedLocationId]
        : [],
    route: "app.db-dashboard",
    shop: session.shop,
  });
  const locations = reportingScope.accessibleLocations;
  const selectedLocations = reportingScope.selectedLocations;
  const selectedLocationIds = selectedLocations.map(
    (location) => location.shopify_location_id,
  );
  const selectedLocation =
    selectedLocations.length === 1 ? selectedLocations[0] : null;
  const selectedLocationId = selectedLocation?.shopify_location_id ?? "all";
  const selectedLocationName = selectedLocation
    ? selectedLocation.name
    : reportingScope.hasAllLocations
      ? "All locations"
      : "All assigned locations";
  const noAssignedLocations = locations.length === 0;
  const canManageSync = permissions.capabilities.manage_sync;

  const { data: lastSuccessfulSyncRun, error: lastSuccessfulSyncError } =
    canManageSync
      ? await supabase
          .from("sync_runs")
          .select("finished_at")
          .eq("shop_domain", session.shop)
          .eq("status", "success")
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };

  if (lastSuccessfulSyncError) {
    throw new Error(
      `Latest successful sync could not be loaded: ${lastSuccessfulSyncError.message}`,
    );
  }

  const [
    syncRuns,
    syncJobs,
    webhookFailures,
    rawOrderLines,
    inventoryRows,
    variants,
    products,
    expenses,
  ] = await Promise.all([
    canManageSync
      ? fetchAllSupabasePages<SyncRunRow>({
          label: "Sync history",
          getRowKey: (row) => row.id,
          fetchPage: (from, to) =>
            supabase
              .from("sync_runs")
              .select("id, sync_type, status, started_at, finished_at, details")
              .eq("shop_domain", session.shop)
              .in("status", ["success", "error"])
              .order("finished_at", { ascending: false, nullsFirst: false })
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: SyncRunRow[] | null;
              error: { message: string } | null;
            }>,
        })
      : Promise.resolve([]),
    canManageSync
      ? fetchAllSupabasePages<SyncJobRow>({
          label: "Sync jobs",
          getRowKey: (row) => row.id,
          fetchPage: (from, to) =>
            supabase
              .from("sync_jobs")
              .select(
                "id, job_type, status, current_step, created_at, started_at, updated_at, finished_at, details",
              )
              .eq("shop_domain", session.shop)
              .in("status", ["success", "error"])
              .order("updated_at", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: SyncJobRow[] | null;
              error: { message: string } | null;
            }>,
        })
      : Promise.resolve([]),
    canManageSync
      ? fetchAllSupabasePages<WebhookFailureRow>({
          label: "Webhook failures",
          getRowKey: (row) => row.id,
          fetchPage: (from, to) =>
            supabase
              .from("webhook_events")
              .select(
                "id, topic, status, attempt_count, received_at, processed_at",
              )
              .eq("shop_domain", session.shop)
              .eq("status", "error")
              .order("processed_at", { ascending: false, nullsFirst: false })
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: WebhookFailureRow[] | null;
              error: { message: string } | null;
            }>,
        })
      : Promise.resolve([]),
    selectedLocationIds.length > 0
      ? fetchAllSupabasePages<OrderLineDbRow & { id: string }>({
          label: "Dashboard order lines",
          getRowKey: (row) => row.id,
          fetchPage: (from, to) =>
            supabase
              .from("order_lines")
              .select(orderLinesSelect)
              .eq("shop_domain", session.shop)
              .in("retail_location_id", selectedLocationIds)
              .gte("created_at_shopify", startDateUtc)
              .lt("created_at_shopify", endExclusiveUtc)
              .order("created_at_shopify", { ascending: false })
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: Array<OrderLineDbRow & { id: string }> | null;
              error: { message: string } | null;
            }>,
        })
      : Promise.resolve([]),
    selectedLocationIds.length > 0
      ? fetchAllSupabasePages<InventoryLevelDbRow & { id: string }>({
          label: "Inventory levels",
          getRowKey: (row) => row.id,
          fetchPage: (from, to) =>
            supabase
              .from("inventory_levels")
              .select(
                "id, shopify_location_id, shopify_variant_id, inventory_item_id, sku, available, tracked",
              )
              .eq("shop_domain", session.shop)
              .in("shopify_location_id", selectedLocationIds)
              .order("id", { ascending: true })
              .range(from, to) as unknown as PromiseLike<{
              data: Array<InventoryLevelDbRow & { id: string }> | null;
              error: { message: string } | null;
            }>,
        })
      : Promise.resolve([]),
    fetchAllSupabasePages<VariantDbRow & { id: string }>({
      label: "Product variants",
      getRowKey: (row) => row.id,
      fetchPage: (from, to) =>
        supabase
          .from("variants")
          .select(
            "id, shopify_variant_id, shopify_product_id, inventory_item_id, title, sku, unit_cost",
          )
          .eq("shop_domain", session.shop)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: Array<VariantDbRow & { id: string }> | null;
          error: { message: string } | null;
        }>,
    }),
    fetchAllSupabasePages<ProductDbRow & { id: string }>({
      label: "Products",
      getRowKey: (row) => row.id,
      fetchPage: (from, to) =>
        supabase
          .from("products")
          .select("id, shopify_product_id, title, vendor, status")
          .eq("shop_domain", session.shop)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: Array<ProductDbRow & { id: string }> | null;
          error: { message: string } | null;
        }>,
    }),
    fetchAllSupabasePages<FixedExpenseDbRow & { id: string }>({
      label: "Expenses",
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

  const syncFailureState = getUnresolvedSyncFailureState({
    runs: syncRuns,
    jobs: syncJobs,
    webhookEvents: webhookFailures,
  });
  const syncFailureBanner = getSyncFailureBannerState({
    resolution: syncFailureState,
    canAdmin: permissions.capabilities.manage_sync,
  });

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
  let revenue = isFinancialMetricsV2
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
  const cogsSummary = summarizeCogs(filteredOrderLines);
  const cogs = cogsSummary.cogs;
  const uniqueOrders = new Set(
    filteredOrderLines.map((row) => row.shopify_order_id),
  );
  const ordersCount = uniqueOrders.size;
  const refundTransactions =
    isFinancialMetricsV2 && uniqueOrders.size > 0
      ? await fetchRefundTransactionsForOrders({
          supabase,
          shop: session.shop,
          orderIds: Array.from(uniqueOrders),
          startDateUtc,
          endExclusiveUtc,
        })
      : [];
  const refunds = refundTransactions.reduce(
    (sum, row) => sum + Number(row.amount ?? 0),
    0,
  );
  if (isFinancialMetricsV2) {
    revenue = calculateNetSalesAfterCashRefunds({
      lineNetSales: revenue,
      merchandiseReturns: returns,
      totalRefunds: refunds,
    });
  }
  const refundTransactionsCount = refundTransactions.length;
  const refundedOrdersCount = new Set(
    refundTransactions.map((row) => row.shopify_order_id),
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
  const activeLocationIds = allLocations.map(
    (location) => location.shopify_location_id,
  );
  const expensesToDate =
    selectedLocationIds.length > 0
      ? selectedLocationIds.reduce(
          (sum, locationId) =>
            sum +
            (computeExpensesForRange({
              expenses,
              selectedLocationId: locationId,
              selectedDays,
              startDate,
              endDate,
              activeLocationIds,
            }) ?? 0),
          0,
        )
      : null;
  const { grossProfit, grossMarginPct, netProfit } = calculateReportedProfit({
    netSales: revenue,
    knownCogs: cogs,
    expenses: expensesToDate,
    cogsIncomplete: cogsSummary.cogsIncomplete,
  });
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
      cogs: getLineCogsV2(row),
      gross_profit:
        getLineCogsV2(row) === null
          ? null
          : (isFinancialMetricsV2
              ? getLineNetSales(row)
              : Number(row.revenue ?? 0)) - Number(getLineCogsV2(row)),
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
      staff_source: row.staff_source,
      shopops_staff_member_id: row.shopops_staff_member_id,
      shopops_user_id: row.shopops_user_id,
      shopops_attributed_user_id: row.shopops_attributed_user_id,
      shopops_effective_staff_id: row.shopops_effective_staff_id,
      shopops_attribution_source: row.shopops_attribution_source,
      shopops_pos_location_id: row.shopops_pos_location_id,
      shopops_pos_device_id: row.shopops_pos_device_id,
      shopops_pos_device_name: row.shopops_pos_device_name,
      resolved_staff_display_name: row.resolved_staff_display_name,
      resolved_staff_status: row.resolved_staff_status,
      resolved_staff_key: row.resolved_staff_key,
    }),
  );
  const staffAttributionAvailable =
    salesOrderLines.length === 0 ||
    salesOrderLines.some(
      (row) =>
        row.staff_member_id ||
        row.staff_member_name ||
        row.staff_member_email ||
        row.resolved_staff_status === "mapped" ||
        row.resolved_staff_status === "unmapped" ||
        (row.staff_source && row.staff_source !== "unavailable"),
    );

  return {
    shop: session.shop,
    locations,
    selectedLocationId,
    selectedLocationIds,
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
      canAdmin: permissions.capabilities.manage_settings,
      activeLocationsCount: locations.length,
      accessibleLocationsCount: locations.length,
      selectedLocationsCount: selectedLocationIds.length,
      orderLinesForSelectedPeriod: orderLines.length,
      productsCount: permissions.capabilities.manage_costs
        ? products.length
        : 0,
      inventoryRowsCount: inventoryRows.length,
      syncFailureBanner,
      noAssignedLocations,
      onboarding: permissions.capabilities.manage_settings
        ? {
            selectReportingLocations: entitlements.activeReportingLocations > 0,
            addProductCosts: variants.some(
              (variant) => variant.unit_cost !== null,
            ),
            addOperatingExpenses: expenses.some((expense) => expense.is_active),
            reviewDashboardAccess: entitlements.owner?.status === "active",
          }
        : {
            selectReportingLocations: true,
            addProductCosts: true,
            addOperatingExpenses: true,
            reviewDashboardAccess: true,
          },
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
      cogsIncomplete: cogsSummary.cogsIncomplete,
      includesEstimatedCogs: cogsSummary.includesEstimatedCogs,
      missingCogsLineCount: cogsSummary.missingCogsLineCount,
      knownCogsLineCount: cogsSummary.knownCogsLineCount,
      actualCogsLineCount: cogsSummary.actualCogsLineCount,
      estimatedCogsLineCount: cogsSummary.estimatedCogsLineCount,
      actualCogs: cogsSummary.actualCogs,
      estimatedCogs: cogsSummary.estimatedCogs,
      ordersCount,
      unitsSold,
      averageOrderValue,
      inventoryUnits,
      criticalStockCount,
      expenses: expensesToDate,
      netProfit,
      hasOperatingExpenses: expenses.some((expense) => expense.is_active),
    },
    stockAlerts,
    salesOrderLines,
    staffAttributionAvailable,
  } satisfies LoaderData;
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
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
  const location = useLocation();
  const {
    shop,
    locations,
    selectedLocationId,
    selectedLocationIds,
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
    staffAttributionAvailable,
  } = useLoaderData<LoaderData>();
  const [activeDrilldowns, setActiveDrilldowns] =
    useState<ActiveDrilldowns>(emptyDrilldowns);
  const drilldownResetKey = buildDrilldownResetKey({
    startDate,
    endDate,
    locationIds: selectedLocationIds,
    staff: selectedStaff,
    vendor: selectedVendor,
  });
  useEffect(() => {
    setActiveDrilldowns(emptyDrilldowns);
  }, [drilldownResetKey]);
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
    ? { to: getDataSyncPath(location.search), label: "Open Sync Status" }
    : undefined;
  const reconnectCta = readiness.syncFailureBanner.showReconnectAction
    ? {
        to: `${location.pathname}${location.search}`,
        label: "Reconnect Shopify",
        reloadDocument: true,
      }
    : undefined;
  const isFirstRunPreparing =
    readiness.activeLocationsCount === 0 ||
    (!lastSuccessfulSync && readiness.orderLinesForSelectedPeriod === 0);
  const hasNoSalesForPeriod =
    !isFirstRunPreparing &&
    readiness.accessibleLocationsCount > 0 &&
    readiness.orderLinesForSelectedPeriod === 0;
  const onboardingItems = [
    {
      complete: readiness.onboarding.selectReportingLocations,
      label: "Select reporting locations",
      to: "/app/locations?tab=reporting",
    },
    {
      complete: readiness.onboarding.addProductCosts,
      label: "Add product costs",
      to: "/app/costs?tab=products",
    },
    {
      complete: readiness.onboarding.addOperatingExpenses,
      label: "Add operating expenses",
      to: "/app/costs?tab=expenses",
    },
    {
      complete: readiness.onboarding.reviewDashboardAccess,
      label: "Review ShopOps access",
      to: "/app/people?tab=access",
    },
  ];
  const showOnboarding =
    readiness.canAdmin && onboardingItems.some((item) => !item.complete);

  return (
    <ShopOpsPage>
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
        locationAccessRestricted={!readiness.canAdmin}
      />

      {showOnboarding ? (
        <details
          open
          style={{
            background: "white",
            border: "1px solid #d1d5db",
            borderRadius: 12,
            marginBottom: 18,
            padding: "12px 16px",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>
            Finish setting up ShopOps
          </summary>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px 18px",
              marginTop: 12,
            }}
          >
            {onboardingItems.map((item) => (
              <span key={item.label}>
                {item.complete ? "✓ " : "○ "}
                {item.complete ? (
                  item.label
                ) : (
                  <Link to={item.to}>{item.label}</Link>
                )}
              </span>
            ))}
          </div>
        </details>
      ) : null}
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
                  "You can return here once sync finishes to review sales, margins, and inventory.",
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

      {!readiness.noAssignedLocations && hasNoSalesForPeriod ? (
        <CompactEmptyDataNotice
          title="No sales for this period."
          guidance="Try another date range or confirm sync status."
          action={
            syncCenterCta ? (
              <AppButtonLink compact to={syncCenterCta.to} variant="secondary">
                {syncCenterCta.label}
              </AppButtonLink>
            ) : undefined
          }
        />
      ) : null}

      {!readiness.noAssignedLocations &&
      readiness.syncFailureBanner.kind !== "hidden" ? (
        <PageNotice
          title={readiness.syncFailureBanner.title}
          message={readiness.syncFailureBanner.message}
          cta={reconnectCta}
          tone="warning"
        />
      ) : null}

      {!readiness.noAssignedLocations && !isFirstRunPreparing ? (
        <>
          <KpiCards
            kpis={kpis}
            financialMetricsVersion={financialMetricsVersion}
            canAdmin={readiness.canAdmin}
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
            className="shopops-dashboard-pair"
            style={{
              alignItems: "stretch",
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
              staffAttributionAvailable={staffAttributionAvailable}
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
    </ShopOpsPage>
  );
}
