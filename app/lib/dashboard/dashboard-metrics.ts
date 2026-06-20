import type {
  BestSellerRow,
  ActiveDrilldowns,
  DashboardSalesOrderLineRow,
  FinancialMetricsVersion,
  FixedExpenseDbRow,
  InventoryLevelDbRow,
  OrderLineDbRow,
  ProductDbRow,
  SalesByHourRow,
  StaffSalesRow,
  StockAlertRow,
  VariantDbRow,
  VendorRow,
} from "./dashboard-types";

export const STORE_TIME_ZONE = "America/Toronto";
export const UNKNOWN_STAFF_FILTER_VALUE = "__unknown_staff__";

export function normalizeFinancialMetricsVersion(
  value: string | undefined,
): FinancialMetricsVersion {
  return value === "v2" ? "v2" : "legacy";
}

export function toDashboardNumber(value: number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

type FinancialMetricLine = {
  quantity: number;
  revenue: number;
  cogs: number | null;
  gross_sales?: number | null;
  discounts?: number | null;
  returns?: number | null;
  net_sales?: number | null;
  refunded_amount?: number | null;
  returned_quantity?: number | null;
  cost_at_sale?: number | null;
};

function hasAnyV2SalesField(row: FinancialMetricLine) {
  return (
    row.gross_sales != null ||
    row.discounts != null ||
    row.returns != null ||
    row.net_sales != null
  );
}

export function getLineGrossSales(row: FinancialMetricLine) {
  return row.gross_sales === null || row.gross_sales === undefined
    ? toDashboardNumber(row.revenue)
    : toDashboardNumber(row.gross_sales);
}

export function getLineDiscounts(row: FinancialMetricLine) {
  return toDashboardNumber(row.discounts);
}

export function getLineReturns(row: FinancialMetricLine) {
  return toDashboardNumber(row.returns);
}

export function getLineNetSales(row: FinancialMetricLine) {
  if (row.net_sales !== null && row.net_sales !== undefined) {
    return toDashboardNumber(row.net_sales);
  }

  if (hasAnyV2SalesField(row)) {
    return getLineGrossSales(row) - getLineDiscounts(row) - getLineReturns(row);
  }

  return toDashboardNumber(row.revenue);
}

export function getLineRefundedAmount(row: FinancialMetricLine) {
  return toDashboardNumber(row.refunded_amount);
}

export function getLineReturnedQuantity(row: FinancialMetricLine) {
  return toDashboardNumber(row.returned_quantity);
}

export function getLineCogsV2(row: FinancialMetricLine) {
  if (row.cost_at_sale !== null && row.cost_at_sale !== undefined) {
    return (
      toDashboardNumber(row.cost_at_sale) * toDashboardNumber(row.quantity)
    );
  }

  return toDashboardNumber(row.cogs);
}

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

export function getTodayStoreDate() {
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

export function nextDate(date: string) {
  return formatDateOnlyUtc(addDays(parseDateOnlyUtc(date), 1));
}

export function daysBetween(startDate: string, endExclusiveDate: string) {
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

export function storeDateToUtcIso(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const firstOffset = getTimeZoneOffsetMs(utcGuess, STORE_TIME_ZONE);
  const firstUtc = new Date(utcGuess.getTime() - firstOffset);
  const finalOffset = getTimeZoneOffsetMs(firstUtc, STORE_TIME_ZONE);

  return new Date(utcGuess.getTime() - finalOffset).toISOString();
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-CA").format(value);
}

export function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }

  return `${value.toFixed(1)}%`;
}

export function formatStoreDateTime(value: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function buildShopifyOrderUrl(
  shopDomain: string,
  shopifyOrderId: string,
) {
  const numericId = shopifyOrderId.split("/").pop();
  const storeHandle = shopDomain.replace(".myshopify.com", "");

  return `https://admin.shopify.com/store/${storeHandle}/orders/${numericId}`;
}

type SalesMetricOrderLine = DashboardSalesOrderLineRow & {
  staff_source?: string | null;
};

export function getStaffFilterValue(row: DashboardSalesOrderLineRow) {
  return (
    row.staff_member_id || row.staff_member_email || row.staff_member_name || ""
  );
}

export function getStaffDrilldownValue(row: DashboardSalesOrderLineRow) {
  return getStaffFilterValue(row) || UNKNOWN_STAFF_FILTER_VALUE;
}

export function getStaffDisplayLabel(row: DashboardSalesOrderLineRow) {
  return (
    row.staff_member_name ||
    row.staff_member_email ||
    row.staff_member_id ||
    "Unknown staff"
  );
}

export function getVendorFilterValue(row: DashboardSalesOrderLineRow) {
  return row.vendor?.trim() || "-";
}

export function getBestSellerDrilldownValue(row: {
  product?: string | null;
  product_title?: string | null;
  sku?: string | null;
}) {
  const product = row.product ?? row.product_title ?? "Unknown product";
  const sku = row.sku ?? "-";

  return `${product}__${sku}`;
}

export function getStoreHourFromTimestamp(value: string) {
  const orderDate = new Date(value);

  if (Number.isNaN(orderDate.getTime())) {
    return null;
  }

  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: STORE_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(orderDate),
  );

  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

export function hasActiveDashboardDrilldowns(
  activeDrilldowns: ActiveDrilldowns,
) {
  return Boolean(
    (activeDrilldowns.hour !== null && activeDrilldowns.hour !== undefined) ||
    activeDrilldowns.product ||
    activeDrilldowns.staff ||
    activeDrilldowns.vendor,
  );
}

export function applyDashboardDrilldowns(
  orderLines: DashboardSalesOrderLineRow[],
  activeDrilldowns: ActiveDrilldowns,
) {
  if (!hasActiveDashboardDrilldowns(activeDrilldowns)) {
    return orderLines;
  }

  return orderLines.filter((row) => {
    if (
      activeDrilldowns.hour !== null &&
      activeDrilldowns.hour !== undefined &&
      getStoreHourFromTimestamp(row.created_at_shopify) !==
        activeDrilldowns.hour
    ) {
      return false;
    }

    if (
      activeDrilldowns.product &&
      getBestSellerDrilldownValue(row) !== activeDrilldowns.product.value
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
      activeDrilldowns.vendor &&
      getVendorFilterValue(row) !== activeDrilldowns.vendor.value
    ) {
      return false;
    }

    return true;
  });
}

export function computeBestSellers(orderLines: DashboardSalesOrderLineRow[]) {
  const grouped = new Map<string, BestSellerRow>();

  for (const row of orderLines) {
    const product = row.product_title ?? "Unknown product";
    const sku = row.sku ?? "-";
    const vendor = getVendorFilterValue(row);
    const key = getBestSellerDrilldownValue({ product, sku });

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

export function computeSalesByVendor(orderLines: DashboardSalesOrderLineRow[]) {
  const grouped = new Map<string, VendorRow>();

  for (const row of orderLines) {
    const vendor = getVendorFilterValue(row);
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

export function computeSalesByStaff(orderLines: SalesMetricOrderLine[]) {
  const grouped = new Map<string, StaffSalesRow>();

  for (const row of orderLines) {
    const staff = getStaffDisplayLabel(row);
    const staffId = row.staff_member_id ?? "-";
    const source = row.staff_source ?? "unavailable";
    const key = getStaffDrilldownValue(row);
    const existing = grouped.get(key);

    if (existing) {
      existing.units += Number(row.quantity ?? 0);
      existing.revenue += Number(row.revenue ?? 0);
    } else {
      grouped.set(key, {
        staff,
        staffId,
        staffKey: key,
        source,
        units: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

export function computeSalesByHour(orderLines: DashboardSalesOrderLineRow[]) {
  const orderIdsByHour = new Map<number, Set<string>>();
  const rows: SalesByHourRow[] = Array.from({ length: 24 }, (_, hour) => {
    orderIdsByHour.set(hour, new Set<string>());

    return {
      hour,
      revenue: 0,
      unitsSold: 0,
      ordersCount: 0,
      averageOrderValue: 0,
    };
  });

  for (const row of orderLines) {
    if (!row.created_at_shopify) {
      continue;
    }

    const hour = getStoreHourFromTimestamp(row.created_at_shopify);

    if (hour === null) {
      continue;
    }

    const hourRow = rows[hour];

    hourRow.revenue += Number(row.revenue ?? 0);
    hourRow.unitsSold += Number(row.quantity ?? 0);

    if (row.shopify_order_id) {
      orderIdsByHour.get(hour)?.add(row.shopify_order_id);
    }
  }

  for (const row of rows) {
    row.ordersCount = orderIdsByHour.get(row.hour)?.size ?? 0;
    row.averageOrderValue =
      row.ordersCount > 0 ? row.revenue / row.ordersCount : 0;
  }

  return rows;
}

export function computeStockAlerts({
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

export function isActiveInventoryProduct({
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

export function computeExpensesForRange({
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
