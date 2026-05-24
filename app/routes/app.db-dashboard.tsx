import type { LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getPermissionContext } from "../lib/auth/permissions.server";
import { ActiveDrilldownBadge } from "../components/dashboard/ActiveDrilldownBadge";
import { BestSellersCard } from "../components/dashboard/BestSellersCard";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { KpiCards } from "../components/dashboard/KpiCards";
import { RecentOrderLinesCard } from "../components/dashboard/RecentOrderLinesCard";
import { SalesByHourCard } from "../components/dashboard/SalesByHourCard";
import { SalesByStaffCard } from "../components/dashboard/SalesByStaffCard";
import { SalesByVendorCard } from "../components/dashboard/SalesByVendorCard";
import { StockAlertsCard } from "../components/dashboard/StockAlertsCard";
import {
  buildShopifyOrderUrl,
  applyDashboardDrilldown,
  computeBestSellers,
  computeExpensesForRange,
  computeSalesByHour,
  computeSalesByStaff,
  computeSalesByVendor,
  computeStockAlerts,
  daysBetween,
  getBestSellerDrilldownValue,
  getStaffDisplayLabel,
  getStaffFilterValue,
  getTodayStoreDate,
  getVendorFilterValue,
  isActiveInventoryProduct,
  nextDate,
  storeDateToUtcIso,
  UNKNOWN_STAFF_FILTER_VALUE,
} from "../lib/dashboard/dashboard-metrics";
import type {
  DashboardDrilldown,
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  const permissions = await getPermissionContext({ request, session, supabase });
  const url = new URL(request.url);
  const preservedSearchParams = Array.from(url.searchParams.entries())
    .filter(
      ([name]) =>
        !["locationId", "startDate", "endDate", "preset", "staff", "vendor"].includes(name),
    )
    .map(([name, value]) => ({ name, value }));
  const today = getTodayStoreDate();
  const preset = url.searchParams.get("preset");
  const startDate = preset === "today" ? today : url.searchParams.get("startDate") || today;
  const endDate = preset === "today" ? today : url.searchParams.get("endDate") || today;
  const selectedStaff = url.searchParams.get("staff") || "";
  const selectedVendor = url.searchParams.get("vendor") || "";
  const endExclusive = nextDate(endDate);
  const startDateUtc = storeDateToUtcIso(startDate);
  const endExclusiveUtc = storeDateToUtcIso(endExclusive);
  const selectedDays = daysBetween(startDate, endExclusive);
  const errors: string[] = [];

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
  if (!permissions.isAdmin && locations.length === 0) {
    throw new Response("Forbidden: no location access configured", {
      status: 403,
    });
  }
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
          .select(
            "order_name, shopify_order_id, created_at_shopify, retail_location_id, retail_location_name, product_title, variant_title, sku, vendor, quantity, unit_price, revenue, unit_cost, cogs, gross_profit, cost_source, staff_member_id, staff_member_name, staff_member_email, staff_source",
          )
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

  const orderLines = (orderLinesResult.data ?? []) as OrderLineDbRow[];
  const inventoryRows = (inventoryResult.data ?? []) as InventoryLevelDbRow[];
  const variants = (variantsResult.data ?? []) as VariantDbRow[];
  const products = (productsResult.data ?? []) as ProductDbRow[];
  const expenses = (expensesResult.data ?? []) as FixedExpenseDbRow[];
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
  const revenue = filteredOrderLines.reduce(
    (sum, row) => sum + Number(row.revenue ?? 0),
    0,
  );
  const cogs = filteredOrderLines.reduce((sum, row) => sum + Number(row.cogs ?? 0), 0);
  const grossProfit = filteredOrderLines.reduce(
    (sum, row) => sum + Number(row.gross_profit ?? 0),
    0,
  );
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const uniqueOrders = new Set(filteredOrderLines.map((row) => row.shopify_order_id));
  const ordersCount = uniqueOrders.size;
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
      revenue: Number(row.revenue ?? 0),
      cogs: row.cogs === null ? null : Number(row.cogs ?? 0),
      gross_profit:
        row.gross_profit === null ? null : Number(row.gross_profit ?? 0),
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
    selectedDays,
    kpis: {
      revenue,
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
    costSource: "-",
  }));
}

function isSameDrilldown(
  current: DashboardDrilldown | null,
  next: DashboardDrilldown,
) {
  return (
    current?.type === next.type && String(current.value) === String(next.value)
  );
}

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
    selectedDays,
    kpis,
    stockAlerts,
    salesOrderLines,
    errors,
  } = useLoaderData<LoaderData>();
  const [activeDrilldown, setActiveDrilldown] =
    useState<DashboardDrilldown | null>(null);
  const drilldownOrderLines = useMemo(
    () => applyDashboardDrilldown(salesOrderLines, activeDrilldown),
    [salesOrderLines, activeDrilldown],
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
  const selectedHour =
    activeDrilldown?.type === "hour" ? Number(activeDrilldown.value) : null;
  const selectedProductKey =
    activeDrilldown?.type === "product" ? String(activeDrilldown.value) : null;
  const selectedStaffKey =
    activeDrilldown?.type === "staff" ? String(activeDrilldown.value) : null;
  const selectedVendorKey =
    activeDrilldown?.type === "vendor" ? String(activeDrilldown.value) : null;
  const toggleDrilldown = (next: DashboardDrilldown) => {
    setActiveDrilldown((current) =>
      isSameDrilldown(current, next) ? null : next,
    );
  };

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

        <KpiCards
          kpis={kpis}
          selectedLocationName={selectedLocationName}
          startDate={startDate}
          endDate={endDate}
        />

        <ActiveDrilldownBadge
          activeDrilldown={activeDrilldown}
          onClear={() => setActiveDrilldown(null)}
        />

        <div style={{ marginBottom: 20 }}>
          <SalesByHourCard
            salesByHour={drilldownSalesByHour}
            selectedHour={selectedHour}
            onSelectHour={(hour) =>
              toggleDrilldown({
                type: "hour",
                value: hour,
                label: `${String(hour).padStart(2, "0")}:00`,
              })
            }
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
            selectedProductKey={selectedProductKey}
            onSelectBestSeller={(row) =>
              toggleDrilldown({
                type: "product",
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
            selectedStaffKey={selectedStaffKey}
            onSelectStaff={(row) =>
              toggleDrilldown({
                type: "staff",
                value: row.staffKey,
                label: row.staff,
              })
            }
          />

          <SalesByVendorCard
            salesByVendor={drilldownSalesByVendor}
            selectedVendorKey={selectedVendorKey}
            onSelectVendor={(row) =>
              toggleDrilldown({
                type: "vendor",
                value: row.vendor,
                label: row.vendor,
              })
            }
          />
        </div>

        <RecentOrderLinesCard recentOrders={drilldownRecentOrders} />
      </div>
    </main>
  );
}
