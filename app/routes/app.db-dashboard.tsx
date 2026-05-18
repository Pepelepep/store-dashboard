import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getPermissionContext } from "../lib/auth/permissions.server";

type LocationRow = {
  shopify_location_id: string;
  name: string;
  is_active: boolean;
};

type OrderLineDbRow = {
  order_name: string;
  shopify_order_id: string;
  created_at_shopify: string;
  retail_location_id: string | null;
  retail_location_name: string | null;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  vendor: string | null;
  quantity: number;
  unit_price: number;
  revenue: number;
  unit_cost: number | null;
  cogs: number | null;
  gross_profit: number | null;
  cost_source: string | null;
};

type InventoryLevelDbRow = {
  shopify_location_id: string;
  shopify_variant_id: string | null;
  inventory_item_id: string;
  sku: string | null;
  available: number;
  tracked: boolean;
};

type VariantDbRow = {
  shopify_variant_id: string;
  shopify_product_id: string | null;
  inventory_item_id: string | null;
  title: string | null;
  sku: string | null;
  unit_cost: number | null;
};

type ProductDbRow = {
  shopify_product_id: string;
  title: string;
  vendor: string | null;
  status: string | null;
};

type FixedExpenseDbRow = {
  expense_name: string;
  expense_category: string | null;
  monthly_amount: number;
  shopify_location_id: string | null;
  location_name: string | null;
  start_month: string;
  end_month: string | null;
  is_active: boolean;
};

type BestSellerRow = {
  product: string;
  sku: string;
  vendor: string;
  units: number;
  revenue: number;
};

type VendorRow = {
  vendor: string;
  units: number;
  revenue: number;
};

type StockAlertRow = {
  product: string;
  variant: string;
  sku: string;
  vendor: string;
  available: number;
  unitsSold: number;
  daysLeft: number | null;
  status: "Critical" | "Warning" | "Healthy" | "No sales";
};

type RecentOrderRow = {
  orderName: string;
  orderUrl: string;
  date: string;
  product: string;
  sku: string;
  quantity: number;
  revenue: number;
  cogs: number | null;
  grossProfit: number | null;
  costSource: string;
};

type LoaderData = {
  shop: string;
  locations: LocationRow[];
  selectedLocationId: string | null;
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
  lastSuccessfulSync: string | null;
  selectedDays: number;
  kpis: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number | null;
    ordersCount: number;
    unitsSold: number;
    averageOrderValue: number;
    inventoryUnits: number;
    criticalStockCount: number;
    expenses: number | null;
    netProfit: number | null;
  };
  bestSellers: BestSellerRow[];
  salesByVendor: VendorRow[];
  stockAlerts: StockAlertRow[];
  recentOrders: RecentOrderRow[];
  errors: string[];
};

const STORE_TIME_ZONE = "America/Toronto";

function getDatePartsInStoreTimezone(date: Date) {
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

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function getTodayStoreDate() {
  const { year, month, day } = getDatePartsInStoreTimezone(new Date());

  return `${year}-${month}-${day}`;
}

function parseDateOnlyUtc(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnlyUtc(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function nextDate(date: string) {
  return formatDateOnlyUtc(addDays(parseDateOnlyUtc(date), 1));
}

function daysBetween(startDate: string, endExclusiveDate: string) {
  const start = parseDateOnlyUtc(startDate);
  const end = parseDateOnlyUtc(endExclusiveDate);

  return Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return localAsUtc - date.getTime();
}

function storeDateToUtcIso(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const firstOffset = getTimeZoneOffsetMs(utcGuess, STORE_TIME_ZONE);
  const firstUtc = new Date(utcGuess.getTime() - firstOffset);
  const finalOffset = getTimeZoneOffsetMs(firstUtc, STORE_TIME_ZONE);

  return new Date(utcGuess.getTime() - finalOffset).toISOString();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-CA").format(value);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(1)}%`;
}

function formatStoreDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildShopifyOrderUrl(shopDomain: string, shopifyOrderId: string) {
  const numericId = shopifyOrderId.split("/").pop();
  const storeHandle = shopDomain.replace(".myshopify.com", "");

  return `https://admin.shopify.com/store/${storeHandle}/orders/${numericId}`;
}

function computeBestSellers(orderLines: OrderLineDbRow[]) {
  const grouped = new Map<string, BestSellerRow>();

  for (const row of orderLines) {
    const product = row.product_title ?? "Unknown product";
    const sku = row.sku ?? "-";
    const vendor = row.vendor ?? "-";
    const key = `${product}__${sku}`;

    const existing = grouped.get(key);

    if (existing) {
      existing.units += Number(row.quantity ?? 0);
      existing.revenue += Number(row.revenue ?? 0);
    } else {
      grouped.set(key, {
        product,
        sku,
        vendor,
        units: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function computeSalesByVendor(orderLines: OrderLineDbRow[]) {
  const grouped = new Map<string, VendorRow>();

  for (const row of orderLines) {
    const vendor = row.vendor ?? "-";
    const existing = grouped.get(vendor);

    if (existing) {
      existing.units += Number(row.quantity ?? 0);
      existing.revenue += Number(row.revenue ?? 0);
    } else {
      grouped.set(vendor, {
        vendor,
        units: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

function computeStockAlerts({
  inventoryRows,
  orderLines,
  variantsById,
  productsById,
  periodDays,
}: {
  inventoryRows: InventoryLevelDbRow[];
  orderLines: OrderLineDbRow[];
  variantsById: Map<string, VariantDbRow>;
  productsById: Map<string, ProductDbRow>;
  periodDays: number;
}) {
  const soldBySku = new Map<string, number>();

  for (const row of orderLines) {
    const sku = row.sku ?? "-";
    soldBySku.set(sku, (soldBySku.get(sku) ?? 0) + Number(row.quantity ?? 0));
  }

  const alerts = inventoryRows.map((inventory): StockAlertRow => {
    const variant = inventory.shopify_variant_id
      ? variantsById.get(inventory.shopify_variant_id)
      : undefined;

    const product = variant?.shopify_product_id
      ? productsById.get(variant.shopify_product_id)
      : undefined;

    const sku = inventory.sku ?? variant?.sku ?? "-";
    const unitsSold = soldBySku.get(sku) ?? 0;
    const avgDailySales = unitsSold / periodDays;
    const daysLeft =
      avgDailySales > 0
        ? Number(inventory.available ?? 0) / avgDailySales
        : null;

    let status: StockAlertRow["status"] = "Healthy";

    if (unitsSold === 0) {
      status = "No sales";
    } else if (daysLeft !== null && daysLeft <= 3) {
      status = "Critical";
    } else if (daysLeft !== null && daysLeft <= 7) {
      status = "Warning";
    }

    return {
      product: product?.title ?? "Unknown product",
      variant: variant?.title ?? "-",
      sku,
      vendor: product?.vendor ?? "-",
      available: Number(inventory.available ?? 0),
      unitsSold,
      daysLeft,
      status,
    };
  });

  return alerts
    .filter((row) => row.status === "Critical" || row.status === "Warning")
    .sort((a, b) => {
      const aDays = a.daysLeft ?? 999999;
      const bDays = b.daysLeft ?? 999999;
      return aDays - bDays;
    })
    .slice(0, 15);
}

function isActiveInventoryProduct({
  inventory,
  variantsById,
  productsById,
}: {
  inventory: InventoryLevelDbRow;
  variantsById: Map<string, VariantDbRow>;
  productsById: Map<string, ProductDbRow>;
}) {
  const variant = inventory.shopify_variant_id
    ? variantsById.get(inventory.shopify_variant_id)
    : undefined;

  const product = variant?.shopify_product_id
    ? productsById.get(variant.shopify_product_id)
    : undefined;

  return product?.status !== "DELETED";
}

function getDaysInMonth(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function getMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthKeyFromDateString(value: string | null) {
  if (!value) return null;
  return value.slice(0, 7);
}

function computeExpensesForRange({
  expenses,
  selectedLocationId,
  selectedDays,
  startDate,
  endDate,
  activeLocationCount,
}: {
  expenses: FixedExpenseDbRow[];
  selectedLocationId: string | null;
  selectedDays: number;
  startDate: string;
  endDate: string;
  activeLocationCount: number;
}) {
  const rangeStart = parseDateOnlyUtc(startDate);
  const rangeEndExclusive = addDays(parseDateOnlyUtc(endDate), 1);
  let total = 0;

  for (
    let current = new Date(rangeStart);
    current < rangeEndExclusive;
    current = addDays(current, 1)
  ) {
    const currentMonthKey = getMonthKey(current);
    const daysInMonth = getDaysInMonth(current);

    for (const expense of expenses) {
      if (!expense.is_active) continue;

      const expenseStartMonth = getMonthKeyFromDateString(expense.start_month);
      const expenseEndMonth = getMonthKeyFromDateString(expense.end_month);

      if (expenseStartMonth && currentMonthKey < expenseStartMonth) continue;
      if (expenseEndMonth && currentMonthKey > expenseEndMonth) continue;

      const isGlobalExpense = !expense.shopify_location_id;
      const isSelectedLocationExpense =
        expense.shopify_location_id === selectedLocationId;

      if (!isGlobalExpense && !isSelectedLocationExpense) continue;

      const monthlyAmount = Number(expense.monthly_amount ?? 0);
      const dailyAmount = monthlyAmount / daysInMonth;

      total += isGlobalExpense
        ? dailyAmount / Math.max(activeLocationCount, 1)
        : dailyAmount;
    }
  }

  return selectedDays > 0 ? total : null;
}

function escapeCsvValue(value: unknown) {
  const stringValue = String(value ?? "");
  const escaped = stringValue.replace(/"/g, '""');

  return `"${escaped}"`;
}

function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
) {
  const csvContent = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function ExportButton({
  label = "CSV",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "1px solid #d1d5db",
        background: "#ffffff",
        borderRadius: 10,
        padding: "7px 10px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        color: "#202223",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  exportValue,
  selectedLocationName,
  startDate,
  endDate,
}: {
  title: string;
  value: string;
  subtitle: string;
  exportValue: string | number;
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
        minHeight: 132,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <div style={{ color: "#5f6368", fontSize: 14, fontWeight: 700 }}>
          {title}
        </div>
        <ExportButton
          onClick={() =>
            downloadCsv(
              `${title.toLowerCase().replaceAll(" ", "-")}.csv`,
              ["Metric", "Value", "Location", "Start date", "End date"],
              [
                [
                  title,
                  exportValue,
                  selectedLocationName ?? "-",
                  startDate,
                  endDate,
                ],
              ],
            )
          }
        />
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        {value}
      </div>
      <div style={{ color: "#707070", fontSize: 13, lineHeight: 1.35 }}>
        {subtitle}
      </div>
    </section>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
  exportConfig,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  exportConfig?: {
    filename: string;
    headers: string[];
    rows: Array<Array<unknown>>;
  };
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        minHeight: 420,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h2>
          {subtitle ? (
            <p
              style={{
                margin: "6px 0 0",
                color: "#616161",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {exportConfig ? (
          <ExportButton
            onClick={() =>
              downloadCsv(
                exportConfig.filename,
                exportConfig.headers,
                exportConfig.rows,
              )
            }
          />
        ) : null}
      </div>
      {children}
    </section>
  );
}

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

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number | React.ReactNode>>;
}) {
  return (
    <div
      style={{
        overflowX: "auto",
        overflowY: "auto",
        maxHeight: 320,
        border: "1px solid #f0f0f0",
        borderRadius: 12,
      }}
    >
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
      >
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                style={{
                  textAlign: "left",
                  padding: "12px 10px",
                  borderBottom: "1px solid #dcdcdc",
                  color: "#616161",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  position: "sticky",
                  top: 0,
                  background: "white",
                  zIndex: 1,
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{
                      padding: "12px 10px",
                      borderBottom: "1px solid #f0f0f0",
                      verticalAlign: "top",
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={headers.length}
                style={{ padding: 16, color: "#707070" }}
              >
                No data for this selection.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  const permissions = await getPermissionContext({ request, session, supabase });
  const url = new URL(request.url);
  const today = getTodayStoreDate();
  const preset = url.searchParams.get("preset");
  const startDate = preset === "today" ? today : url.searchParams.get("startDate") || today;
  const endDate = preset === "today" ? today : url.searchParams.get("endDate") || today;
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
            "order_name, shopify_order_id, created_at_shopify, retail_location_id, retail_location_name, product_title, variant_title, sku, vendor, quantity, unit_price, revenue, unit_cost, cogs, gross_profit, cost_source",
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
  const revenue = orderLines.reduce(
    (sum, row) => sum + Number(row.revenue ?? 0),
    0,
  );
  const cogs = orderLines.reduce((sum, row) => sum + Number(row.cogs ?? 0), 0);
  const grossProfit = orderLines.reduce(
    (sum, row) => sum + Number(row.gross_profit ?? 0),
    0,
  );
  const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const uniqueOrders = new Set(orderLines.map((row) => row.shopify_order_id));
  const ordersCount = uniqueOrders.size;
  const unitsSold = orderLines.reduce(
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
  });
  const criticalStockCount = stockAlerts.filter(
    (row) => row.status === "Critical",
  ).length;
  const recentOrders: RecentOrderRow[] = orderLines.slice(0, 30).map((row) => ({
    orderName: row.order_name,
    orderUrl: buildShopifyOrderUrl(session.shop, row.shopify_order_id),
    date: row.created_at_shopify,
    product: row.product_title ?? "-",
    sku: row.sku ?? "-",
    quantity: Number(row.quantity ?? 0),
    revenue: Number(row.revenue ?? 0),
    cogs: row.cogs === null ? null : Number(row.cogs ?? 0),
    grossProfit:
      row.gross_profit === null ? null : Number(row.gross_profit ?? 0),
    costSource: row.cost_source ?? "-",
  }));

  return {
    shop: session.shop,
    locations,
    selectedLocationId,
    selectedLocationName,
    startDate,
    endDate,
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
    bestSellers: computeBestSellers(orderLines),
    salesByVendor: computeSalesByVendor(orderLines),
    stockAlerts,
    recentOrders,
    errors,
  } satisfies LoaderData;
}

export default function DbDashboardPage() {
  const {
    locations,
    selectedLocationId,
    selectedLocationName,
    startDate,
    endDate,
    lastSuccessfulSync,
    selectedDays,
    kpis,
    bestSellers,
    salesByVendor,
    stockAlerts,
    recentOrders,
    errors,
  } = useLoaderData<LoaderData>();

  const canSwitchLocation = locations.length > 1;

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
        <header
          style={{
            marginBottom: 24,
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 20,
            padding: 24,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <Form method="get">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 24,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 260, flex: "1 1 420px" }}>
                <div
                  style={{
                    color: "#5f6368",
                    fontSize: 14,
                    marginBottom: 6,
                    fontWeight: 700,
                  }}
                >
                  Synced Shopify data
                </div>

                <h1 style={{ margin: 0, fontSize: 34, fontWeight: 850 }}>
                  Store dashboard
                </h1>

                <p style={{ marginTop: 8, color: "#6b7280", fontSize: 16 }}>
                  Sales, margin and operational risks by location.
                </p>
              </div>

              <div
                style={{
                  width: 360,
                  maxWidth: "100%",
                  flex: "0 1 360px",
                }}
              >
                <label
                  htmlFor="locationId"
                  style={{
                    display: "block",
                    fontSize: 14,
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Location
                </label>
                <select
                  id="locationId"
                  name="locationId"
                  defaultValue={selectedLocationId ?? ""}
                  disabled={!canSwitchLocation}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid #c9c9c9",
                    background: canSwitchLocation ? "white" : "#f3f4f6",
                    color: canSwitchLocation ? "#202223" : "#6b7280",
                    fontSize: 14,
                    minHeight: 44,
                    boxSizing: "border-box",
                    cursor: canSwitchLocation ? "pointer" : "not-allowed",
                  }}
                >
                  {locations.map((location) => (
                    <option
                      key={location.shopify_location_id}
                      value={location.shopify_location_id}
                    >
                      {location.name}
                    </option>
                  ))}
                </select>
                {!canSwitchLocation ? (
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      color: "#6b7280",
                    }}
                  >
                    Location locked for this user.
                  </div>
                ) : null}
              </div>
            </div>

            <div
              style={{
                marginTop: 22,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(160px, 220px))",
                gap: 14,
                alignItems: "end",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <label
                  htmlFor="startDate"
                  style={{
                    display: "block",
                    fontSize: 14,
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  Start date
                </label>
                <input
                  id="startDate"
                  name="startDate"
                  type="date"
                  defaultValue={startDate}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 12,
                    border: "1px solid #c9c9c9",
                    background: "white",
                    fontSize: 14,
                    minHeight: 44,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <label
                  htmlFor="endDate"
                  style={{
                    display: "block",
                    fontSize: 14,
                    fontWeight: 800,
                    marginBottom: 6,
                  }}
                >
                  End date
                </label>
                <input
                  id="endDate"
                  name="endDate"
                  type="date"
                  defaultValue={endDate}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 12,
                    border: "1px solid #c9c9c9",
                    background: "white",
                    fontSize: 14,
                    minHeight: 44,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                marginTop: 16,
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <button
                type="submit"
                name="preset"
                value="today"
                style={{
                  border: "1px solid #202223",
                  background: "#202223",
                  color: "white",
                  borderRadius: 12,
                  padding: "10px 22px",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  minHeight: 44,
                  minWidth: 150,
                  whiteSpace: "nowrap",
                }}
              >
                Today
              </button>

              <button
                type="submit"
                style={{
                  border: "1px solid #c9c9c9",
                  background: "white",
                  borderRadius: 12,
                  padding: "10px 22px",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  minHeight: 44,
                  minWidth: 150,
                  whiteSpace: "nowrap",
                }}
              >
                Apply
              </button>
            </div>
          </Form>

          <div
            style={{
              marginTop: 18,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <span
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              Current location: {selectedLocationName ?? "-"}
            </span>

            <span
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              Range: {startDate} → {endDate}
            </span>

            <span
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {selectedDays} {selectedDays > 1 ? "days" : "day"}
            </span>

            <span
              style={{
                background: "white",
                border: "1px solid #e5e7eb",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              Data updated:{" "}
              {lastSuccessfulSync
                ? formatStoreDateTime(lastSuccessfulSync)
                : "unavailable"}
            </span>
          </div>
        </header>

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

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            marginBottom: 22,
          }}
        >
          <KpiCard
            title="Revenue"
            value={formatCurrency(kpis.revenue)}
            subtitle="Synced retail sales"
            exportValue={kpis.revenue}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
          <KpiCard
            title="Orders"
            value={formatNumber(kpis.ordersCount)}
            subtitle="Unique orders for this location"
            exportValue={kpis.ordersCount}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
          <KpiCard
            title="Units sold"
            value={formatNumber(kpis.unitsSold)}
            subtitle="Quantity sold from order lines"
            exportValue={kpis.unitsSold}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
          <KpiCard
            title="COGS"
            value={formatCurrency(kpis.cogs)}
            subtitle="Product costs"
            exportValue={kpis.cogs}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
          <KpiCard
            title="Gross profit"
            value={formatCurrency(kpis.grossProfit)}
            subtitle="Revenue minus COGS"
            exportValue={kpis.grossProfit}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
          <KpiCard
            title="Gross margin"
            value={formatPercent(kpis.grossMarginPct)}
            subtitle="Gross profit / revenue"
            exportValue={kpis.grossMarginPct ?? ""}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
          <KpiCard
            title="Expenses"
            value={
              kpis.expenses === null ? "Not configured" : formatCurrency(kpis.expenses)
            }
            subtitle="Fixed expenses from DB"
            exportValue={kpis.expenses ?? "Not configured"}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
          <KpiCard
            title="Net profit"
            value={
              kpis.netProfit === null ? "Not available" : formatCurrency(kpis.netProfit)
            }
            subtitle="Gross profit minus expenses"
            exportValue={kpis.netProfit ?? "Not available"}
            selectedLocationName={selectedLocationName}
            startDate={startDate}
            endDate={endDate}
          />
        </section>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
            gap: 20,
            marginBottom: 20,
          }}
        >
          <SectionCard
            title="Best sellers"
            exportConfig={{
              filename: "best-sellers.csv",
              headers: ["Product", "SKU", "Vendor", "Units", "Revenue"],
              rows: bestSellers.map((row) => [
                row.product,
                row.sku,
                row.vendor,
                row.units,
                row.revenue,
              ]),
            }}
          >
            <Table
              headers={["Product", "SKU", "Vendor", "Units", "Revenue"]}
              rows={bestSellers.map((row) => [
                row.product,
                row.sku,
                row.vendor,
                row.units,
                formatCurrency(row.revenue),
              ])}
            />
          </SectionCard>

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
            <Table
              headers={["Product", "SKU", "Available", "Sold", "Days left", "Status"]}
              rows={stockAlerts.map((row) => [
                row.product,
                row.sku,
                row.available,
                row.unitsSold,
                row.daysLeft === null ? "-" : row.daysLeft.toFixed(1),
                <StatusBadge key={`${row.sku}-${row.status}`} status={row.status} />,
              ])}
            />
          </SectionCard>
        </div>

        <SectionCard
          title="Sales by vendor"
          exportConfig={{
            filename: "sales-by-vendor.csv",
            headers: ["Vendor", "Units", "Revenue"],
            rows: salesByVendor.map((row) => [row.vendor, row.units, row.revenue]),
          }}
        >
          <Table
            headers={["Vendor", "Units", "Revenue"]}
            rows={salesByVendor.map((row) => [
              row.vendor,
              row.units,
              formatCurrency(row.revenue),
            ])}
          />
        </SectionCard>

        <div style={{ height: 20 }} />

        <SectionCard
          title="Recent order lines"
          exportConfig={{
            filename: "recent-order-lines.csv",
            headers: [
              "Order",
              "Date",
              "Product",
              "SKU",
              "Qty",
              "Revenue",
              "COGS",
              "Gross profit",
              "Cost source",
            ],
            rows: recentOrders.map((row) => [
              row.orderName,
              formatStoreDateTime(row.date),
              row.product,
              row.sku,
              row.quantity,
              row.revenue,
              row.cogs ?? "-",
              row.grossProfit ?? "-",
              row.costSource,
            ]),
          }}
        >
          <Table
            headers={[
              "Order",
              "Date",
              "Product",
              "SKU",
              "Qty",
              "Revenue",
              "COGS",
              "Gross profit",
              "Cost source",
            ]}
            rows={recentOrders.map((row) => [
              <a href={row.orderUrl} target="_blank" rel="noreferrer">
                {row.orderName}
              </a>,
              formatStoreDateTime(row.date),
              row.product,
              row.sku,
              row.quantity,
              formatCurrency(row.revenue),
              row.cogs === null ? "-" : formatCurrency(row.cogs),
              row.grossProfit === null ? "-" : formatCurrency(row.grossProfit),
              row.costSource,
            ])}
          />
        </SectionCard>
      </div>
    </main>
  );
}
