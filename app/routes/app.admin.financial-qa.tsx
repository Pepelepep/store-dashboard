import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import { HelperText } from "../components/ui/HelperText";
import { PageNotice } from "../components/ui/PageNotice";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import {
  daysBetween,
  formatStoreDateTime,
  getLineNetSales,
  getTodayStoreDate,
  nextDate,
  storeDateToUtcIso,
} from "../lib/dashboard/dashboard-metrics";
import type {
  LocationRow,
  OrderLineDbRow,
} from "../lib/dashboard/dashboard-types";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";
import { authenticate } from "../shopify.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

type OrderFinancialRow = {
  shopify_order_id: string;
  order_name: string;
  created_at_shopify: string;
  financial_status: string | null;
  gross_sales: number | null;
  discounts: number | null;
  total_discount_amount: number | null;
  current_total_discount_amount: number | null;
  line_discount_amount: number | null;
  shipping_discount_amount: number | null;
  returns: number | null;
  net_sales: number | null;
  refunds: number | null;
  taxes: number | null;
  shipping: number | null;
  total_sales: number | null;
  transactions_total: number | null;
  financial_data_complete: boolean | null;
  financial_incomplete_reason: string | null;
};

type QaOrderRow = OrderFinancialRow & {
  legacyRevenue: number;
  lineLevelNetSales: number;
  orderLineDelta: number | null;
  discountReconciliationDelta: number;
  legacyLineDelta: number;
  flags: string[];
};

type Summary = {
  ordersCount: number;
  financialFieldsPopulated: number;
  incompleteFinancialData: number;
  grossSales: number;
  discounts: number;
  returns: number;
  netSales: number;
  refunds: number;
  taxes: number;
  shipping: number;
  totalSales: number;
  transactionsTotal: number;
  discountMismatches: number;
  legacyRevenue: number;
  orderLevelNetSales: number;
  lineLevelNetSales: number;
  orderLineDelta: number;
  legacyLineDelta: number;
};

type LoaderData = {
  shop: string;
  startDate: string;
  endDate: string;
  selectedDays: number;
  selectedLocationId: string;
  locations: Array<{
    shopify_location_id: string;
    name: string;
  }>;
  filters: {
    incompleteOnly: boolean;
    refundsOrReturnsOnly: boolean;
    deltaOnly: boolean;
  };
  summary: Summary;
  orders: QaOrderRow[];
  errors: string[];
};

const PAGE_SIZE = 1000;
const ALL_LOCATIONS_VALUE = "__all__";
const MONEY_FIELDS: Array<keyof OrderFinancialRow> = [
  "gross_sales",
  "discounts",
  "returns",
  "net_sales",
  "refunds",
  "taxes",
  "shipping",
  "total_sales",
  "transactions_total",
];

const DISCOUNT_RECONCILIATION_TOLERANCE = 0.02;

function getDefaultDateRange() {
  const today = getTodayStoreDate();

  return {
    startDate: today,
    endDate: today,
  };
}

function numberValue(value: number | null | undefined) {
  return Number(value ?? 0);
}

function hasMissingFinancials(order: OrderFinancialRow) {
  return MONEY_FIELDS.some((field) => order[field] === null);
}

function getOrderLineDelta({
  orderLevelNetSales,
  lineLevelNetSales,
}: {
  orderLevelNetSales: number | null;
  lineLevelNetSales: number;
}) {
  if (orderLevelNetSales === null) return null;

  return Number(orderLevelNetSales) - lineLevelNetSales;
}

function getLegacyLineDelta({
  legacyRevenue,
  lineLevelNetSales,
}: {
  legacyRevenue: number;
  lineLevelNetSales: number;
}) {
  return legacyRevenue - lineLevelNetSales;
}

function getFlags({
  order,
  orderLineDelta,
  discountReconciliationDelta,
  legacyLineDelta,
}: {
  order: OrderFinancialRow;
  orderLineDelta: number | null;
  discountReconciliationDelta: number;
  legacyLineDelta: number;
}) {
  const flags: string[] = [];

  if (hasMissingFinancials(order)) flags.push("missing_financials");
  if (order.financial_data_complete === false) {
    flags.push("incomplete_financial_data");
  }
  if (numberValue(order.refunds) > 0) flags.push("has_refund");
  if (numberValue(order.returns) > 0) flags.push("has_return");
  if (orderLineDelta !== null && Math.abs(orderLineDelta) > 0.01) {
    flags.push("order_line_delta");
  }
  if (
    numberValue(order.discounts) > 0 &&
    Math.abs(discountReconciliationDelta) > DISCOUNT_RECONCILIATION_TOLERANCE
  ) {
    flags.push("discount_mismatch");
  }
  if (Math.abs(legacyLineDelta) > 0.01) {
    flags.push("legacy_line_delta");
  }

  return flags;
}

function isReviewFlag(flag: string) {
  return !["has_refund", "has_return"].includes(flag);
}

function getFlagLabel(flag: string) {
  if (flag === "discount_mismatch") {
    return "Discount allocations need review";
  }
  if (flag === "legacy_line_delta") {
    return "Legacy line total differs from order total";
  }
  if (flag === "incomplete_financial_data") {
    return "Financial data incomplete";
  }
  if (flag === "missing_financials") {
    return "Financial fields missing";
  }
  if (flag === "order_line_delta") {
    return "Order-line totals need review";
  }
  if (flag === "has_refund") {
    return "Has refund";
  }
  if (flag === "has_return") {
    return "Has return";
  }

  return flag.replaceAll("_", " ");
}

async function fetchAllOrders({
  supabase,
  shop,
  startDateUtc,
  endExclusiveUtc,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  startDateUtc: string;
  endExclusiveUtc: string;
}) {
  const rows: OrderFinancialRow[] = [];
  const errors: string[] = [];
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("orders")
      .select(
        "shopify_order_id, order_name, created_at_shopify, financial_status, gross_sales, discounts, total_discount_amount, current_total_discount_amount, line_discount_amount, shipping_discount_amount, returns, net_sales, refunds, taxes, shipping, total_sales, transactions_total, financial_data_complete, financial_incomplete_reason",
      )
      .eq("shop_domain", shop)
      .gte("created_at_shopify", startDateUtc)
      .lt("created_at_shopify", endExclusiveUtc)
      .order("created_at_shopify", { ascending: false })
      .range(from, to);

    if (error) {
      errors.push(error.message);
      break;
    }

    const page = (data ?? []) as OrderFinancialRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return { rows, errors };
}

async function fetchOrderLines({
  supabase,
  shop,
  startDateUtc,
  endExclusiveUtc,
  selectedLocationId,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  startDateUtc: string;
  endExclusiveUtc: string;
  selectedLocationId: string;
}) {
  const rows: OrderLineDbRow[] = [];
  const errors: string[] = [];
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    let query = supabase
      .from("order_lines")
      .select("*")
      .eq("shop_domain", shop)
      .gte("created_at_shopify", startDateUtc)
      .lt("created_at_shopify", endExclusiveUtc)
      .order("created_at_shopify", { ascending: false })
      .range(from, to);

    if (selectedLocationId !== ALL_LOCATIONS_VALUE) {
      query = query.eq("retail_location_id", selectedLocationId);
    }

    const { data, error } = await query;

    if (error) {
      errors.push(error.message);
      break;
    }

    const page = (data ?? []) as unknown as OrderLineDbRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return { rows, errors };
}

function getLineSummariesByOrder(orderLines: OrderLineDbRow[]) {
  const summaries = new Map<
    string,
    {
      legacyRevenue: number;
      lineLevelNetSales: number;
    }
  >();

  for (const row of orderLines) {
    const current = summaries.get(row.shopify_order_id) ?? {
      legacyRevenue: 0,
      lineLevelNetSales: 0,
    };

    current.legacyRevenue += numberValue(row.revenue);
    current.lineLevelNetSales += getLineNetSales(row);
    summaries.set(row.shopify_order_id, current);
  }

  return summaries;
}

function getSummary(orders: QaOrderRow[]): Summary {
  return orders.reduce<Summary>(
    (summary, order) => {
      summary.ordersCount += 1;
      if (!order.flags.includes("missing_financials")) {
        summary.financialFieldsPopulated += 1;
      }
      if (order.financial_data_complete === false) {
        summary.incompleteFinancialData += 1;
      }

      summary.grossSales += numberValue(order.gross_sales);
      summary.discounts += numberValue(order.discounts);
      summary.returns += numberValue(order.returns);
      summary.netSales += numberValue(order.net_sales);
      summary.refunds += numberValue(order.refunds);
      summary.taxes += numberValue(order.taxes);
      summary.shipping += numberValue(order.shipping);
      summary.totalSales += numberValue(order.total_sales);
      summary.transactionsTotal += numberValue(order.transactions_total);
      if (order.flags.includes("discount_mismatch")) {
        summary.discountMismatches += 1;
      }
      summary.legacyRevenue += order.legacyRevenue;
      summary.orderLevelNetSales += numberValue(order.net_sales);
      summary.lineLevelNetSales += order.lineLevelNetSales;
      summary.orderLineDelta += order.orderLineDelta ?? 0;
      summary.legacyLineDelta += order.legacyLineDelta;

      return summary;
    },
    {
      ordersCount: 0,
      financialFieldsPopulated: 0,
      incompleteFinancialData: 0,
      grossSales: 0,
      discounts: 0,
      returns: 0,
      netSales: 0,
      refunds: 0,
      taxes: 0,
      shipping: 0,
      totalSales: 0,
      transactionsTotal: 0,
      discountMismatches: 0,
      legacyRevenue: 0,
      orderLevelNetSales: 0,
      lineLevelNetSales: 0,
      orderLineDelta: 0,
      legacyLineDelta: 0,
    },
  );
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(numberValue(value));
}

function formatDateTime(value: string) {
  return formatStoreDateTime(value);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.financial-qa",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });

  const url = new URL(request.url);
  const defaults = getDefaultDateRange();
  const startDate = url.searchParams.get("startDate") || defaults.startDate;
  const endDate = url.searchParams.get("endDate") || defaults.endDate;
  const endExclusive = nextDate(endDate);
  const startDateUtc = storeDateToUtcIso(startDate);
  const endExclusiveUtc = storeDateToUtcIso(endExclusive);
  const selectedDays = daysBetween(startDate, endExclusive);
  const filters = {
    incompleteOnly: url.searchParams.get("incomplete") === "1",
    refundsOrReturnsOnly: url.searchParams.get("refundsOrReturns") === "1",
    deltaOnly: url.searchParams.get("delta") === "1",
  };
  const errors: string[] = [];

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name, is_active")
    .eq("shop_domain", session.shop)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (locationsError) errors.push(locationsError.message);

  const locations = (locationsData ?? []) as LocationRow[];
  const requestedLocationId = url.searchParams.get("locationId");
  const selectedLocationId =
    requestedLocationId === ALL_LOCATIONS_VALUE
      ? ALL_LOCATIONS_VALUE
      : (locations.find(
          (location) => location.shopify_location_id === requestedLocationId,
        )?.shopify_location_id ??
        locations[0]?.shopify_location_id ??
        ALL_LOCATIONS_VALUE);

  const ordersResult = await fetchAllOrders({
    supabase,
    shop: session.shop,
    startDateUtc,
    endExclusiveUtc,
  });
  errors.push(...ordersResult.errors);

  const orderLinesResult = await fetchOrderLines({
    supabase,
    shop: session.shop,
    startDateUtc,
    endExclusiveUtc,
    selectedLocationId,
  });
  errors.push(...orderLinesResult.errors);
  if (ordersResult.rows.length === 0 && orderLinesResult.rows.length === 0) {
    logEmptyDataState({
      route: "app.admin.financial-qa",
      shop: session.shop,
      reason: "no_orders_or_order_lines",
      counts: {
        locations: locations.length,
        orders: ordersResult.rows.length,
        orderLines: orderLinesResult.rows.length,
      },
    });
  }

  const lineSummariesByOrder = getLineSummariesByOrder(orderLinesResult.rows);
  const orderRows =
    selectedLocationId === ALL_LOCATIONS_VALUE
      ? ordersResult.rows
      : ordersResult.rows.filter((order) =>
          lineSummariesByOrder.has(order.shopify_order_id),
        );

  const qaRows = orderRows.map((order) => {
    const lineSummary = lineSummariesByOrder.get(order.shopify_order_id) ?? {
      legacyRevenue: 0,
      lineLevelNetSales: 0,
    };
    const orderLineDelta = getOrderLineDelta({
      orderLevelNetSales: order.net_sales,
      lineLevelNetSales: lineSummary.lineLevelNetSales,
    });
    const legacyLineDelta = getLegacyLineDelta({
      legacyRevenue: lineSummary.legacyRevenue,
      lineLevelNetSales: lineSummary.lineLevelNetSales,
    });
    const discountReconciliationDelta =
      numberValue(order.line_discount_amount) +
      numberValue(order.shipping_discount_amount) -
      numberValue(order.discounts);
    const flags = getFlags({
      order,
      orderLineDelta,
      discountReconciliationDelta,
      legacyLineDelta,
    });

    return {
      ...order,
      legacyRevenue: lineSummary.legacyRevenue,
      lineLevelNetSales: lineSummary.lineLevelNetSales,
      orderLineDelta,
      discountReconciliationDelta,
      legacyLineDelta,
      flags,
    };
  });

  for (const [shopifyOrderId, lineSummary] of lineSummariesByOrder) {
    if (qaRows.some((order) => order.shopify_order_id === shopifyOrderId)) {
      continue;
    }

    const legacyLineDelta = getLegacyLineDelta({
      legacyRevenue: lineSummary.legacyRevenue,
      lineLevelNetSales: lineSummary.lineLevelNetSales,
    });
    qaRows.push({
      shopify_order_id: shopifyOrderId,
      order_name: shopifyOrderId,
      created_at_shopify: startDateUtc,
      financial_status: null,
      gross_sales: null,
      discounts: null,
      total_discount_amount: null,
      current_total_discount_amount: null,
      line_discount_amount: null,
      shipping_discount_amount: null,
      returns: null,
      net_sales: null,
      refunds: null,
      taxes: null,
      shipping: null,
      total_sales: null,
      transactions_total: null,
      financial_data_complete: null,
      financial_incomplete_reason: "Missing order-level financial row",
      legacyRevenue: lineSummary.legacyRevenue,
      lineLevelNetSales: lineSummary.lineLevelNetSales,
      orderLineDelta: null,
      discountReconciliationDelta: 0,
      legacyLineDelta,
      flags: ["missing_financials"],
    });
  }

  const filteredOrders = qaRows.filter((order) => {
    if (
      filters.incompleteOnly &&
      !order.flags.includes("incomplete_financial_data")
    ) {
      return false;
    }

    if (
      filters.refundsOrReturnsOnly &&
      !order.flags.includes("has_refund") &&
      !order.flags.includes("has_return")
    ) {
      return false;
    }

    if (
      filters.deltaOnly &&
      !order.flags.includes("order_line_delta") &&
      !order.flags.includes("discount_mismatch") &&
      !order.flags.includes("legacy_line_delta")
    ) {
      return false;
    }

    return true;
  });

  return {
    shop: session.shop,
    startDate,
    endDate,
    selectedDays,
    selectedLocationId,
    locations: locations.map((location) => ({
      shopify_location_id: location.shopify_location_id,
      name: location.name,
    })),
    filters,
    summary: getSummary(filteredOrders),
    orders: filteredOrders,
    errors,
  } satisfies LoaderData;
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
  title,
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warning" | "error";
  title?: string;
}) {
  return (
    <div
      title={title}
      style={{
        background:
          tone === "error"
            ? "#fff4f4"
            : tone === "warning"
              ? "#fff8e5"
              : "white",
        border: "1px solid #e3e3e3",
        borderRadius: 10,
        padding: 14,
      }}
    >
      <HelperText>{label}</HelperText>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function FlagBadge({ flag }: { flag: string }) {
  const variant =
    flag === "missing_financials" || flag === "incomplete_financial_data"
      ? "error"
      : flag === "order_line_delta" ||
          flag === "discount_mismatch" ||
          flag === "legacy_line_delta"
        ? "warning"
        : "info";

  return (
    <StatusBadge variant={variant} style={{ marginRight: 4, marginBottom: 4 }}>
      {getFlagLabel(flag)}
    </StatusBadge>
  );
}

export default function FinancialQaPage() {
  const {
    shop,
    startDate,
    endDate,
    selectedDays,
    selectedLocationId,
    locations,
    filters,
    summary,
    orders,
    errors,
  } = useLoaderData<typeof loader>();
  const selectedLocationName =
    selectedLocationId === ALL_LOCATIONS_VALUE
      ? "All locations"
      : (locations.find(
          (location) => location.shopify_location_id === selectedLocationId,
        )?.name ?? "Unknown location");
  const ordersNeedingReview = orders.filter((order) =>
    order.flags.some(isReviewFlag),
  ).length;
  const hasDiscountIssues = summary.discountMismatches > 0;
  const hasRefunds = summary.refunds > 0;
  const hasReturns = summary.returns > 0;
  const hasOrderLineIssues = Math.abs(summary.orderLineDelta) > 0.01;
  const hasTaxShippingTotals = summary.taxes > 0 || summary.shipping > 0;

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
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 32 }}>Report Accuracy</h1>
          <HelperText>
            {shop} · Review whether synced Shopify order totals line up with
            line-level reporting data.
          </HelperText>
        </header>

        {orders.length === 0 ? (
          <PageNotice
            title="Report Accuracy is waiting for synced orders."
            message="Report Accuracy becomes useful after Shopify orders and order lines have synced."
            bullets={[
              "Use Sync Status to review locations, products, inventory, and orders sync status.",
              "This page will compare order-level and line-level financial totals once order data exists.",
            ]}
            cta={{ to: "/app/admin/sync", label: "Open Sync Status" }}
            tone="info"
          />
        ) : null}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <SummaryCard label="Orders checked" value={summary.ordersCount} />
          <SummaryCard
            label="Need review"
            value={ordersNeedingReview}
            tone={ordersNeedingReview > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Discounts"
            value={hasDiscountIssues ? "Review" : "OK"}
            tone={hasDiscountIssues ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Refunds"
            value={hasRefunds ? "Present" : "None"}
            tone={hasRefunds ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Returns"
            value={hasReturns ? "Present" : "None"}
            tone={hasReturns ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Taxes & shipping"
            value={hasTaxShippingTotals ? "Present" : "None"}
          />
          <SummaryCard
            label="Order-line totals"
            value={hasOrderLineIssues ? "Review" : "OK"}
            tone={hasOrderLineIssues ? "warning" : "neutral"}
          />
        </section>

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <Form
            method="get"
            style={{ display: "flex", gap: 16, flexWrap: "wrap" }}
          >
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Sale Date Start
              <input name="startDate" type="date" defaultValue={startDate} />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Sale Date End
              <input name="endDate" type="date" defaultValue={endDate} />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              Location
              <select name="locationId" defaultValue={selectedLocationId}>
                <option value={ALL_LOCATIONS_VALUE}>All locations</option>
                {locations.map((location) => (
                  <option
                    key={location.shopify_location_id}
                    value={location.shopify_location_id}
                  >
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <input
                name="incomplete"
                type="checkbox"
                value="1"
                defaultChecked={filters.incompleteOnly}
              />
              Incomplete only
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <input
                name="refundsOrReturns"
                type="checkbox"
                value="1"
                defaultChecked={filters.refundsOrReturnsOnly}
              />
              Refunds or returns
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <input
                name="delta"
                type="checkbox"
                value="1"
                defaultChecked={filters.deltaOnly}
              />
              Delta only
            </label>
            <button
              type="submit"
              style={{
                alignSelf: "end",
                background: "#2563eb",
                border: "1px solid #2563eb",
                borderRadius: 8,
                color: "white",
                fontWeight: 800,
                padding: "8px 14px",
              }}
            >
              Apply
            </button>
          </Form>
          <HelperText>
            Sale Date range uses store timezone. End date is inclusive in the
            UI. Current comparison: {selectedLocationName}, {selectedDays}{" "}
            {selectedDays > 1 ? "days" : "day"}.
          </HelperText>
        </section>

        {errors.length > 0 ? (
          <section
            style={{
              background: "#fff4f4",
              border: "1px solid #f2b8b5",
              borderRadius: 12,
              color: "#b42318",
              marginBottom: 20,
              padding: 14,
            }}
          >
            {errors.join(" · ")}
          </section>
        ) : null}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <SummaryCard label="Orders" value={summary.ordersCount} />
          <SummaryCard
            label="Financial fields populated"
            value={summary.financialFieldsPopulated}
          />
          <SummaryCard
            label="Incomplete financial data"
            value={summary.incompleteFinancialData}
            tone={summary.incompleteFinancialData > 0 ? "error" : "neutral"}
          />
          <SummaryCard
            label="Gross sales"
            value={formatCurrency(summary.grossSales)}
            title="Gross Sales: product sales before discounts and returns."
          />
          <SummaryCard
            label="Discounts"
            value={formatCurrency(summary.discounts)}
            title="Discounts: Shopify discount allocations applied to orders and line items."
          />
          <SummaryCard
            label="Discount mismatches"
            value={summary.discountMismatches}
            tone={summary.discountMismatches > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Returns"
            value={formatCurrency(summary.returns)}
            title="Returns: returned line-item value used in net sales calculations where available."
          />
          <SummaryCard
            label="Order-level Net Sales"
            value={formatCurrency(summary.orderLevelNetSales)}
            title="Net Sales: Gross Sales minus Discounts and Returns."
          />
          <SummaryCard
            label="Line-level Net Sales"
            value={formatCurrency(summary.lineLevelNetSales)}
          />
          <SummaryCard
            label="Order - Line Delta"
            value={formatCurrency(summary.orderLineDelta)}
            tone={
              Math.abs(summary.orderLineDelta) > 0.01 ? "warning" : "neutral"
            }
          />
          <SummaryCard
            label="Refunds"
            value={formatCurrency(summary.refunds)}
            title="Refunds: cash refunded on Shopify orders, reported separately from returns."
          />
          <SummaryCard
            label="Taxes"
            value={formatCurrency(summary.taxes)}
            title="Taxes: Shopify tax totals, informational reporting only."
          />
          <SummaryCard
            label="Shipping"
            value={formatCurrency(summary.shipping)}
            title="Shipping: Shopify shipping totals, tracked separately from product margin."
          />
          <SummaryCard
            label="Total sales"
            value={formatCurrency(summary.totalSales)}
          />
          <SummaryCard
            label="Transactions total"
            value={formatCurrency(summary.transactionsTotal)}
          />
        </section>

        <details
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 800 }}>
            Advanced order diagnostics
          </summary>
          <HelperText>
            Raw order-level and line-level totals for support review.
          </HelperText>
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table
              style={{
                borderCollapse: "collapse",
                minWidth: 2200,
                width: "100%",
              }}
            >
              <thead>
                <tr style={{ background: "#f6f6f7", textAlign: "left" }}>
                  {[
                    "Order",
                    "Created",
                    "Status",
                    "Gross",
                    "Discounts",
                    "Discount Delta",
                    "Returns",
                    "Order Net",
                    "Line Net",
                    "Order - Line",
                    "Refunds",
                    "Taxes",
                    "Shipping",
                    "Total",
                    "Transactions",
                    "Legacy revenue",
                    "Legacy - Line",
                    "Complete",
                    "Reason",
                    "Flags",
                  ].map((heading) => (
                    <th
                      key={heading}
                      style={{ borderBottom: "1px solid #e3e3e3", padding: 10 }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.shopify_order_id}>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      <div style={{ fontWeight: 800 }}>{order.order_name}</div>
                      <HelperText>{order.shopify_order_id}</HelperText>
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatDateTime(order.created_at_shopify)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {order.financial_status ?? "-"}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.gross_sales)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.discounts)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.discountReconciliationDelta)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.returns)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.net_sales)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.lineLevelNetSales)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {order.orderLineDelta === null
                        ? "-"
                        : formatCurrency(order.orderLineDelta)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.refunds)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.taxes)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.shipping)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.total_sales)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.transactions_total)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.legacyRevenue)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {formatCurrency(order.legacyLineDelta)}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      <StatusBadge
                        variant={
                          order.financial_data_complete === false
                            ? "error"
                            : "success"
                        }
                      >
                        {order.financial_data_complete === false ? "No" : "Yes"}
                      </StatusBadge>
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {order.financial_incomplete_reason ?? "-"}
                    </td>
                    <td
                      style={{ borderBottom: "1px solid #f0f0f0", padding: 10 }}
                    >
                      {order.flags.length > 0
                        ? order.flags.map((flag) => (
                            <FlagBadge key={flag} flag={flag} />
                          ))
                        : "-"}
                    </td>
                  </tr>
                ))}
                {orders.length === 0 ? (
                  <tr>
                    <td
                      colSpan={20}
                      style={{ padding: 18, textAlign: "center" }}
                    >
                      No orders match the selected QA filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </main>
  );
}
