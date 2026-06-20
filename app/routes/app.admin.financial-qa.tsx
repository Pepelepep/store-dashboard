import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import { HelperText } from "../components/ui/HelperText";
import { StatusBadge } from "../components/ui/StatusBadge";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

type OrderFinancialRow = {
  shopify_order_id: string;
  order_name: string;
  created_at_shopify: string;
  financial_status: string | null;
  gross_sales: number | null;
  discounts: number | null;
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
  legacyNewDelta: number | null;
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
  legacyRevenue: number;
  legacyNewDelta: number;
};

type LoaderData = {
  shop: string;
  startDate: string;
  endDate: string;
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

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    startDate: toDateInputValue(start),
    endDate: toDateInputValue(end),
  };
}

function nextDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);

  return toDateInputValue(value);
}

function toUtcIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

function numberValue(value: number | null | undefined) {
  return Number(value ?? 0);
}

function hasMissingFinancials(order: OrderFinancialRow) {
  return MONEY_FIELDS.some((field) => order[field] === null);
}

function getLegacyNewDelta({
  legacyRevenue,
  netSales,
}: {
  legacyRevenue: number;
  netSales: number | null;
}) {
  if (netSales === null) return null;

  return legacyRevenue - Number(netSales);
}

function getFlags(order: OrderFinancialRow, legacyNewDelta: number | null) {
  const flags: string[] = [];

  if (hasMissingFinancials(order)) flags.push("missing_financials");
  if (order.financial_data_complete === false) {
    flags.push("incomplete_financial_data");
  }
  if (numberValue(order.refunds) > 0) flags.push("has_refund");
  if (numberValue(order.returns) > 0) flags.push("has_return");
  if (legacyNewDelta !== null && Math.abs(legacyNewDelta) > 0.01) {
    flags.push("legacy_new_delta");
  }

  return flags;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function fetchAllOrders({
  supabase,
  shop,
  startDate,
  endDate,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  startDate: string;
  endDate: string;
}) {
  const rows: OrderFinancialRow[] = [];
  const errors: string[] = [];
  let from = 0;

  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("orders")
      .select(
        "shopify_order_id, order_name, created_at_shopify, financial_status, gross_sales, discounts, returns, net_sales, refunds, taxes, shipping, total_sales, transactions_total, financial_data_complete, financial_incomplete_reason",
      )
      .eq("shop_domain", shop)
      .gte("created_at_shopify", toUtcIso(startDate))
      .lt("created_at_shopify", toUtcIso(nextDate(endDate)))
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

async function getLegacyRevenueByOrder({
  supabase,
  shop,
  orderIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  orderIds: string[];
}) {
  const revenueByOrder = new Map<string, number>();
  const errors: string[] = [];

  for (const batch of chunkArray(orderIds, 500)) {
    const { data, error } = await supabase
      .from("order_lines")
      .select("shopify_order_id, revenue")
      .eq("shop_domain", shop)
      .in("shopify_order_id", batch);

    if (error) {
      errors.push(error.message);
      continue;
    }

    for (const row of (data ?? []) as Array<{
      shopify_order_id: string;
      revenue: number | null;
    }>) {
      revenueByOrder.set(
        row.shopify_order_id,
        (revenueByOrder.get(row.shopify_order_id) ?? 0) +
          numberValue(row.revenue),
      );
    }
  }

  return { revenueByOrder, errors };
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
      summary.legacyRevenue += order.legacyRevenue;
      summary.legacyNewDelta += order.legacyNewDelta ?? 0;

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
      legacyRevenue: 0,
      legacyNewDelta: 0,
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
  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await assertAdminAccess({ request, session, supabase });

  const url = new URL(request.url);
  const defaults = getDefaultDateRange();
  const startDate = url.searchParams.get("startDate") || defaults.startDate;
  const endDate = url.searchParams.get("endDate") || defaults.endDate;
  const filters = {
    incompleteOnly: url.searchParams.get("incomplete") === "1",
    refundsOrReturnsOnly: url.searchParams.get("refundsOrReturns") === "1",
    deltaOnly: url.searchParams.get("delta") === "1",
  };
  const errors: string[] = [];

  const ordersResult = await fetchAllOrders({
    supabase,
    shop: session.shop,
    startDate,
    endDate,
  });
  errors.push(...ordersResult.errors);

  const legacyRevenueResult = await getLegacyRevenueByOrder({
    supabase,
    shop: session.shop,
    orderIds: ordersResult.rows.map((order) => order.shopify_order_id),
  });
  errors.push(...legacyRevenueResult.errors);

  const qaRows = ordersResult.rows.map((order) => {
    const legacyRevenue =
      legacyRevenueResult.revenueByOrder.get(order.shopify_order_id) ?? 0;
    const legacyNewDelta = getLegacyNewDelta({
      legacyRevenue,
      netSales: order.net_sales,
    });
    const flags = getFlags(order, legacyNewDelta);

    return {
      ...order,
      legacyRevenue,
      legacyNewDelta,
      flags,
    };
  });

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

    if (filters.deltaOnly && !order.flags.includes("legacy_new_delta")) {
      return false;
    }

    return true;
  });

  return {
    shop: session.shop,
    startDate,
    endDate,
    filters,
    summary: getSummary(filteredOrders),
    orders: filteredOrders,
    errors,
  } satisfies LoaderData;
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "warning" | "error";
}) {
  return (
    <div
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
      : flag === "legacy_new_delta"
        ? "warning"
        : "info";

  return (
    <StatusBadge variant={variant} style={{ marginRight: 4, marginBottom: 4 }}>
      {flag}
    </StatusBadge>
  );
}

export default function FinancialQaPage() {
  const { shop, startDate, endDate, filters, summary, orders, errors } =
    useLoaderData<typeof loader>();

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
          <h1 style={{ margin: 0, fontSize: 32 }}>Financial QA</h1>
          <HelperText>
            {shop} · Validate order financial fields before dashboard migration.
          </HelperText>
        </header>

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
              Start
              <input name="startDate" type="date" defaultValue={startDate} />
            </label>
            <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
              End
              <input name="endDate" type="date" defaultValue={endDate} />
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
              Legacy delta
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
          />
          <SummaryCard
            label="Discounts"
            value={formatCurrency(summary.discounts)}
          />
          <SummaryCard
            label="Returns"
            value={formatCurrency(summary.returns)}
          />
          <SummaryCard
            label="Net sales"
            value={formatCurrency(summary.netSales)}
          />
          <SummaryCard
            label="Refunds"
            value={formatCurrency(summary.refunds)}
          />
          <SummaryCard label="Taxes" value={formatCurrency(summary.taxes)} />
          <SummaryCard
            label="Shipping"
            value={formatCurrency(summary.shipping)}
          />
          <SummaryCard
            label="Total sales"
            value={formatCurrency(summary.totalSales)}
          />
          <SummaryCard
            label="Transactions total"
            value={formatCurrency(summary.transactionsTotal)}
          />
          <SummaryCard
            label="Legacy revenue"
            value={formatCurrency(summary.legacyRevenue)}
          />
          <SummaryCard
            label="Legacy - net sales"
            value={formatCurrency(summary.legacyNewDelta)}
            tone={
              Math.abs(summary.legacyNewDelta) > 0.01 ? "warning" : "neutral"
            }
          />
        </section>

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                borderCollapse: "collapse",
                minWidth: 1800,
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
                    "Returns",
                    "Net",
                    "Refunds",
                    "Taxes",
                    "Shipping",
                    "Total",
                    "Transactions",
                    "Legacy revenue",
                    "Delta",
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
                      {order.legacyNewDelta === null
                        ? "-"
                        : formatCurrency(order.legacyNewDelta)}
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
                      colSpan={17}
                      style={{ padding: 18, textAlign: "center" }}
                    >
                      No orders match the selected QA filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
