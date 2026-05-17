import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";

type VariantCostRow = {
  shopify_variant_id: string;
  inventory_item_id: string | null;
  sku: string | null;
  unit_cost: number | null;
};

type OrderLineItemNode = {
  id: string;
  title: string;
  quantity: number;
  sku?: string | null;
  variant?: {
    id: string;
    title?: string | null;
    sku?: string | null;
    product?: {
      id: string;
      title: string;
      vendor?: string | null;
    } | null;
  } | null;
  discountedUnitPriceSet?: {
    shopMoney?: {
      amount: string;
      currencyCode: string;
    } | null;
  } | null;
};

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus?: string | null;
  totalPriceSet?: {
    shopMoney?: {
      amount: string;
      currencyCode: string;
    } | null;
  } | null;
  retailLocation?: {
    id: string;
    name: string;
  } | null;
  lineItems: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
    edges: {
      node: OrderLineItemNode;
    }[];
  };
};

type LineItemsGraphqlResponse = {
  data?: {
    node?: {
      lineItems?: OrderNode["lineItems"];
    };
  };
  errors?: unknown;
};

type OrdersConnection = {
  pageInfo: {
    hasNextPage: boolean;
    endCursor?: string | null;
  };
  edges?: {
    node: OrderNode;
  }[];
};

type OrdersGraphqlResponse = {
  data?: {
    orders?: OrdersConnection;
  };
  errors?: unknown;
};

type LoaderData = {
  shop: string;
  ordersCount: number;
  orderLinesCount: number;
};

type ActionData = {
  ok: boolean;
  ordersSynced?: number;
  orderLinesSynced?: number;
  pagesProcessed?: number;
  error?: string;
};

const ORDERS_PAGE_SIZE = 50;
const LINE_ITEMS_PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 500;

function getNumericAmount(value?: string | null) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function isCustomOrManualLine(lineItem: OrderLineItemNode) {
  return !lineItem.variant?.id;
}

function getCostInfo({
  lineItem,
  variantCost,
  revenue,
  quantity,
}: {
  lineItem: OrderLineItemNode;
  variantCost?: VariantCostRow;
  revenue: number;
  quantity: number;
}) {
  const unitCost = variantCost?.unit_cost ?? null;

  if (unitCost !== null && unitCost > 0) {
    const cogs = unitCost * quantity;

    return {
      unitCost,
      cogs,
      grossProfit: revenue - cogs,
      costSource: "SHOPIFY_UNIT_COST",
    };
  }

  if (isCustomOrManualLine(lineItem) && revenue > 0) {
    const cogs = revenue * 0.5;

    return {
      unitCost: null,
      cogs,
      grossProfit: revenue - cogs,
      costSource: "FALLBACK_50_PERCENT_CUSTOM_SALE",
    };
  }

  return {
    unitCost: unitCost ?? null,
    cogs: null,
    grossProfit: null,
    costSource: "MISSING_COST",
  };
}

function getOrderQueryFromForm(formData: FormData) {
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();

  const filters: string[] = [];

  if (startDate) {
    filters.push(`created_at:>=${startDate}`);
  }

  if (endDate) {
    filters.push(`created_at:<=${endDate}`);
  }

  return filters.join(" ");
}

async function getAllLineItemsForOrder({
  admin,
  order,
}: {
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"];
  order: OrderNode;
}) {
  const allLineItems = [...order.lineItems.edges.map((edge) => edge.node)];

  let cursor = order.lineItems.pageInfo.endCursor ?? null;
  let hasNextPage = order.lineItems.pageInfo.hasNextPage;

  while (hasNextPage && cursor) {
    const response = await admin.graphql(
      `#graphql
        query getMoreOrderLineItems($orderId: ID!, $cursor: String) {
          node(id: $orderId) {
            ... on Order {
              lineItems(first: ${LINE_ITEMS_PAGE_SIZE}, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    id
                    title
                    quantity
                    sku
                    variant {
                      id
                      title
                      sku
                      product {
                        id
                        title
                        vendor
                      }
                    }
                    discountedUnitPriceSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          orderId: order.id,
          cursor,
        },
      },
    );

    const data = (await response.json()) as LineItemsGraphqlResponse;

    if (data.errors) {
      throw new Error(JSON.stringify(data.errors));
    }

    const lineItems = data.data?.node?.lineItems;

    if (!lineItems) {
      break;
    }

    allLineItems.push(
      ...lineItems.edges.map((edge: { node: OrderLineItemNode }) => edge.node),
    );

    hasNextPage = lineItems.pageInfo.hasNextPage;
    cursor = lineItems.pageInfo.endCursor ?? null;
  }

  return allLineItems;
}

async function upsertInBatches({
  supabase,
  table,
  rows,
  onConflict,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  table: string;
  rows: Record<string, unknown>[];
  onConflict: string;
}) {
  for (const batch of chunkArray(rows, UPSERT_BATCH_SIZE)) {
    if (batch.length === 0) {
      continue;
    }

    const { error } = await supabase.from(table).upsert(batch, {
      onConflict,
    });

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  const [{ count: ordersCount }, { count: orderLinesCount }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop),
      supabase
        .from("order_lines")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop),
    ]);

  return {
    shop: session.shop,
    ordersCount: ordersCount ?? 0,
    orderLinesCount: orderLinesCount ?? 0,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  const formData = await request.formData();
  const orderQuery = getOrderQueryFromForm(formData);

  const { data: variantCostsData, error: variantCostsError } = await supabase
    .from("variants")
    .select("shopify_variant_id, inventory_item_id, sku, unit_cost")
    .eq("shop_domain", session.shop);

  if (variantCostsError) {
    return {
      ok: false,
      error: variantCostsError.message,
    };
  }

  const variantCosts = (variantCostsData ?? []) as VariantCostRow[];

  const costByVariantId = new Map<string, VariantCostRow>();
  const costBySku = new Map<string, VariantCostRow>();

  for (const row of variantCosts) {
    costByVariantId.set(row.shopify_variant_id, row);

    if (row.sku) {
      costBySku.set(row.sku, row);
    }
  }

  let cursor: string | null = null;
  let hasNextPage = true;
  let pagesProcessed = 0;
  let totalOrdersSynced = 0;
  let totalOrderLinesSynced = 0;

  try {
    while (hasNextPage) {
      const response = await admin.graphql(
        `#graphql
          query getOrdersForSync($cursor: String, $query: String) {
            orders(
              first: ${ORDERS_PAGE_SIZE},
              after: $cursor,
              sortKey: CREATED_AT,
              reverse: true,
              query: $query
            ) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  name
                  createdAt
                  displayFinancialStatus
                  totalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  retailLocation {
                    id
                    name
                  }
                  lineItems(first: ${LINE_ITEMS_PAGE_SIZE}) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    edges {
                      node {
                        id
                        title
                        quantity
                        sku
                        variant {
                          id
                          title
                          sku
                          product {
                            id
                            title
                            vendor
                          }
                        }
                        discountedUnitPriceSet {
                          shopMoney {
                            amount
                            currencyCode
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        {
          variables: {
            cursor,
            query: orderQuery || null,
          },
        },
      );

      const data = (await response.json()) as OrdersGraphqlResponse;

      if (data.errors) {
        return {
          ok: false,
          error: JSON.stringify(data.errors),
        };
      }

      const ordersConnection = data.data?.orders;
      const orders: OrderNode[] =
        ordersConnection?.edges?.map((edge: { node: OrderNode }) => edge.node) ??
        [];

      const orderRows = orders.map((order) => ({
        shop_domain: session.shop,
        shopify_order_id: order.id,
        order_name: order.name,
        created_at_shopify: order.createdAt,
        financial_status: order.displayFinancialStatus ?? null,
        retail_location_id: order.retailLocation?.id ?? null,
        retail_location_name: order.retailLocation?.name ?? null,
        total_price: getNumericAmount(order.totalPriceSet?.shopMoney?.amount),
        updated_at: new Date().toISOString(),
      }));

      const orderLineRows: Record<string, unknown>[] = [];

      for (const order of orders) {
        const allLineItems = await getAllLineItemsForOrder({ admin, order });

        for (const lineItem of allLineItems) {
          const variantId = lineItem.variant?.id ?? null;
          const sku = lineItem.sku ?? lineItem.variant?.sku ?? null;

          const unitPrice = getNumericAmount(
            lineItem.discountedUnitPriceSet?.shopMoney?.amount,
          );

          const revenue = unitPrice * lineItem.quantity;

          const variantCost =
            (variantId ? costByVariantId.get(variantId) : undefined) ??
            (sku ? costBySku.get(sku) : undefined);

          const costInfo = getCostInfo({
            lineItem,
            variantCost,
            revenue,
            quantity: lineItem.quantity,
          });

          orderLineRows.push({
            shop_domain: session.shop,
            shopify_order_id: order.id,
            shopify_line_item_id: lineItem.id,
            order_name: order.name,
            created_at_shopify: order.createdAt,
            retail_location_id: order.retailLocation?.id ?? null,
            retail_location_name: order.retailLocation?.name ?? null,
            shopify_variant_id: variantId,
            inventory_item_id: variantCost?.inventory_item_id ?? null,
            product_title: lineItem.variant?.product?.title ?? lineItem.title,
            variant_title: lineItem.variant?.title ?? null,
            sku,
            vendor: lineItem.variant?.product?.vendor ?? null,
            quantity: lineItem.quantity,
            unit_price: unitPrice,
            revenue,
            unit_cost: costInfo.unitCost,
            cogs: costInfo.cogs,
            gross_profit: costInfo.grossProfit,
            cost_source: costInfo.costSource,
          });
        }
      }

      await upsertInBatches({
        supabase,
        table: "orders",
        rows: orderRows,
        onConflict: "shop_domain,shopify_order_id",
      });

      await upsertInBatches({
        supabase,
        table: "order_lines",
        rows: orderLineRows,
        onConflict: "shop_domain,shopify_line_item_id",
      });

      totalOrdersSynced += orderRows.length;
      totalOrderLinesSynced += orderLineRows.length;
      pagesProcessed += 1;

      hasNextPage = ordersConnection?.pageInfo.hasNextPage ?? false;
      cursor = ordersConnection?.pageInfo.endCursor ?? null;

      if (orders.length === 0) {
        break;
      }
    }

    await supabase.from("sync_runs").insert({
      shop_domain: session.shop,
      sync_type: "orders",
      status: "success",
      finished_at: new Date().toISOString(),
    });

    return {
      ok: true,
      ordersSynced: totalOrdersSynced,
      orderLinesSynced: totalOrderLinesSynced,
      pagesProcessed,
    };
  } catch (error) {
    await supabase.from("sync_runs").insert({
      shop_domain: session.shop,
      sync_type: "orders",
      status: "error",
      finished_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function SyncOrdersPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
      <h1>Sync orders & order lines</h1>

      <section
        style={{
          background: "white",
          border: "1px solid #e3e3e3",
          borderRadius: 14,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <p>
          <strong>Shop:</strong> {loaderData.shop}
        </p>
        <p>
          <strong>Orders currently in DB:</strong> {loaderData.ordersCount}
        </p>
        <p>
          <strong>Order lines currently in DB:</strong>{" "}
          {loaderData.orderLinesCount}
        </p>
      </section>

      <section
        style={{
          background: "#fff8e5",
          border: "1px solid #f1c96b",
          borderRadius: 14,
          padding: 16,
          marginBottom: 20,
          color: "#5f4200",
        }}
      >
        This sync paginates through all accessible Shopify orders and order
        lines. Use the optional date range for faster incremental syncs.
      </section>

      <Form method="post">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "180px 180px auto",
            gap: 12,
            alignItems: "end",
            marginBottom: 16,
          }}
        >
          <div>
            <label
              htmlFor="startDate"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Start date optional
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 10,
                border: "1px solid #c9c9c9",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="endDate"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              End date optional
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 10,
                border: "1px solid #c9c9c9",
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              border: "1px solid #202223",
              background: "#202223",
              color: "white",
              borderRadius: 10,
              padding: "10px 14px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Refresh orders
          </button>
        </div>
      </Form>

      {actionData ? (
        <section
          style={{
            marginTop: 20,
            background: actionData.ok ? "#e8f5e9" : "#fff4f4",
            border: actionData.ok ? "1px solid #b7dfb9" : "1px solid #f2b8b5",
            borderRadius: 14,
            padding: 20,
          }}
        >
          {actionData.ok ? (
            <div>
              <p>
                Processed <strong>{actionData.pagesProcessed}</strong> order
                pages.
              </p>
              <p>
                Synced <strong>{actionData.ordersSynced}</strong> orders.
              </p>
              <p>
                Synced <strong>{actionData.orderLinesSynced}</strong> order
                lines.
              </p>
            </div>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>{actionData.error}</pre>
          )}
        </section>
      ) : null}
    </main>
  );
}
