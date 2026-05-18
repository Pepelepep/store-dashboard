import { getSupabaseAdminClient } from "../db/supabase.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    },
  ) => Promise<Response>;
};

type LocationNode = {
  id: string;
  name: string;
  isActive: boolean;
  address?: {
    city?: string | null;
    province?: string | null;
    country?: string | null;
  } | null;
};

type ProductNode = {
  id: string;
  title: string;
  vendor?: string | null;
  productType?: string | null;
  status?: string | null;
  variants: {
    edges: {
      node: {
        id: string;
        title: string;
        sku?: string | null;
        price?: string | null;
        inventoryItem?: {
          id: string;
          unitCost?: {
            amount: string;
            currencyCode: string;
          } | null;
        } | null;
      };
    }[];
  };
};

type VariantDbRow = {
  shopify_variant_id: string;
  shopify_product_id?: string | null;
  inventory_item_id: string;
  sku: string | null;
};

type InventoryItemNode = {
  id: string;
  sku?: string | null;
  tracked: boolean;
  unitCost?: {
    amount: string;
    currencyCode: string;
  } | null;
  inventoryLevels: {
    edges: {
      node: {
        location: {
          id: string;
          name: string;
        };
        quantities: {
          name: string;
          quantity: number;
        }[];
      };
    }[];
  };
};

type VariantCostRow = {
  shopify_variant_id: string;
  inventory_item_id: string | null;
  sku: string | null;
  unit_cost: number | null;
};

type OrderLineCostRecomputeRow = {
  shopify_line_item_id: string;
  shopify_variant_id: string | null;
  shopify_product_id?: string | null;
  sku: string | null;
  quantity: number;
  revenue: number;
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

export type SyncSource = "manual_admin_sync" | "scheduled_daily_sync" | "webhook";

const INVENTORY_BATCH_SIZE = 25;
const ORDERS_PAGE_SIZE = 50;
const LINE_ITEMS_PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 500;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getNumericAmount(value?: string | null) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function parseNullableNumericAmount(value?: string | null) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function getAvailableQuantity(
  level: InventoryItemNode["inventoryLevels"]["edges"][number]["node"],
) {
  return (
    level.quantities.find((quantity) => quantity.name === "available")
      ?.quantity ?? 0
  );
}

function normalizeInventoryItemId(inventoryItemId: string) {
  return inventoryItemId.startsWith("gid://")
    ? inventoryItemId
    : `gid://shopify/InventoryItem/${inventoryItemId}`;
}

function normalizeProductId(productId: string) {
  return productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;
}

function getIncrementalOrderDateRange(lookbackDays = 7) {
  const end = new Date();
  const start = new Date();

  start.setDate(start.getDate() - lookbackDays);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function buildOrderQuery({
  startDate,
  endDate,
}: {
  startDate?: string | null;
  endDate?: string | null;
}) {
  const filters: string[] = [];

  if (startDate?.trim()) {
    filters.push(`created_at:>=${startDate.trim()}`);
  }

  if (endDate?.trim()) {
    filters.push(`created_at:<=${endDate.trim()}`);
  }

  return filters.join(" ");
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

async function insertSyncRun({
  supabase,
  shop,
  syncType,
  status,
  source,
  startedAt,
  errorMessage,
  details,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  syncType: string;
  status: "success" | "error";
  source: SyncSource;
  startedAt: string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}) {
  await supabase.from("sync_runs").insert({
    shop_domain: shop,
    sync_type: syncType,
    status,
    source,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    error_message: errorMessage ?? null,
    details: details ?? null,
  });
}

async function upsertInBatches({
  supabase,
  table,
  rows,
  onConflict,
}: {
  supabase: SupabaseAdminClient;
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

async function recomputeOrderLineCogsForVariants({
  supabase,
  shop,
  variantRows,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  variantRows: Array<{
    shopify_variant_id: string;
    shopify_product_id?: string | null;
    sku: string | null;
    unit_cost: number | null;
  }>;
}) {
  const costByVariantId = new Map(
    variantRows
      .filter((variant) => variant.unit_cost !== null)
      .map((variant) => [
        variant.shopify_variant_id,
        variant.unit_cost as number,
      ]),
  );
  const variantIds = Array.from(costByVariantId.keys());
  const normalizeSku = (sku: string | null) => sku?.trim() ?? "";
  const isUsableSku = (sku: string | null) => {
    const normalizedSku = normalizeSku(sku);

    return normalizedSku.length > 0 && normalizedSku !== "-";
  };
  const costBySku = new Map(
    variantRows
      .filter(
        (variant) => variant.unit_cost !== null && isUsableSku(variant.sku),
      )
      .map((variant) => [normalizeSku(variant.sku), variant.unit_cost as number]),
  );
  const skus = Array.from(costBySku.keys());
  const productVariantCosts = new Map<string, number[]>();

  for (const variant of variantRows) {
    if (variant.unit_cost === null) {
      continue;
    }

    if (!variant.shopify_product_id) {
      continue;
    }

    const existingCosts =
      productVariantCosts.get(variant.shopify_product_id) ?? [];
    existingCosts.push(variant.unit_cost);
    productVariantCosts.set(variant.shopify_product_id, existingCosts);
  }

  const costBySingleVariantProductId = new Map(
    Array.from(productVariantCosts.entries())
      .filter(([, costs]) => costs.length === 1)
      .map(([productId, costs]) => [productId, costs[0]]),
  );
  const productIds = Array.from(costBySingleVariantProductId.keys());

  if (variantIds.length === 0 && skus.length === 0 && productIds.length === 0) {
    return 0;
  }

  const baseSelect =
    "shopify_line_item_id, shopify_variant_id, sku, quantity, revenue";
  const orderLinesById = new Map<string, OrderLineCostRecomputeRow>();

  if (variantIds.length > 0) {
    const { data: variantMatchedRows, error } = await supabase
      .from("order_lines")
      .select(baseSelect)
      .eq("shop_domain", shop)
      .in("shopify_variant_id", variantIds);

    if (error) {
      throw new Error(error.message);
    }

    for (const orderLine of (variantMatchedRows ??
      []) as OrderLineCostRecomputeRow[]) {
      orderLinesById.set(orderLine.shopify_line_item_id, orderLine);
    }
  }

  if (skus.length > 0) {
    const { data: skuMatchedRows, error } = await supabase
      .from("order_lines")
      .select(baseSelect)
      .eq("shop_domain", shop)
      .in("sku", skus);

    if (error) {
      throw new Error(error.message);
    }

    for (const orderLine of (skuMatchedRows ??
      []) as OrderLineCostRecomputeRow[]) {
      orderLinesById.set(orderLine.shopify_line_item_id, orderLine);
    }
  }

  if (productIds.length > 0) {
    const { error: productIdColumnError } = await supabase
      .from("order_lines")
      .select("shopify_product_id")
      .eq("shop_domain", shop)
      .limit(1);

    if (!productIdColumnError) {
      const { data: productMatchedRows, error } = await supabase
        .from("order_lines")
        .select(`${baseSelect}, shopify_product_id`)
        .eq("shop_domain", shop)
        .in("shopify_product_id", productIds);

      if (error) {
        throw new Error(error.message);
      }

      for (const orderLine of (productMatchedRows ??
        []) as OrderLineCostRecomputeRow[]) {
        orderLinesById.set(orderLine.shopify_line_item_id, orderLine);
      }
    }
  }

  let recomputedCount = 0;

  for (const orderLine of orderLinesById.values()) {
    const sku = isUsableSku(orderLine.sku) ? normalizeSku(orderLine.sku) : null;
    const unitCost =
      (orderLine.shopify_variant_id
        ? costByVariantId.get(orderLine.shopify_variant_id)
        : undefined) ??
      (sku ? costBySku.get(sku) : undefined) ??
      (orderLine.shopify_product_id
        ? costBySingleVariantProductId.get(orderLine.shopify_product_id)
        : undefined);

    if (unitCost === undefined) {
      continue;
    }

    const quantity = Number(orderLine.quantity ?? 0);
    const revenue = Number(orderLine.revenue ?? 0);
    const cogs = unitCost * quantity;

    const { error: updateError } = await supabase
      .from("order_lines")
      .update({
        unit_cost: unitCost,
        cogs,
        gross_profit: revenue - cogs,
        cost_source: "recomputed_from_current_variant_cost",
      })
      .eq("shop_domain", shop)
      .eq("shopify_line_item_id", orderLine.shopify_line_item_id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    recomputedCount += 1;
  }

  return recomputedCount;
}

async function getAllLineItemsForOrder({
  admin,
  order,
}: {
  admin: ShopifyAdminClient;
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

    const data = await response.json();

    if ("errors" in data && data.errors) {
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
    cursor = lineItems.pageInfo.endCursor;
  }

  return allLineItems;
}

export async function syncLocations({
  admin,
  shop,
  supabase,
  source,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
}) {
  const startedAt = new Date().toISOString();

  try {
    const response = await admin.graphql(`#graphql
      query getLocationsForSync {
        locations(first: 50) {
          edges {
            node {
              id
              name
              isActive
              address {
                city
                province
                country
              }
            }
          }
        }
      }
    `);

    const data = await response.json();

    if ("errors" in data && data.errors) {
      throw new Error(JSON.stringify(data.errors));
    }

    const locations: LocationNode[] =
      data.data?.locations?.edges?.map(
        (edge: { node: LocationNode }) => edge.node,
      ) ?? [];

    const rows = locations.map((location) => ({
      shop_domain: shop,
      shopify_location_id: location.id,
      name: location.name,
      is_active: location.isActive,
      city: location.address?.city ?? null,
      province: location.address?.province ?? null,
      country: location.address?.country ?? null,
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await supabase.from("locations").upsert(rows, {
        onConflict: "shop_domain,shopify_location_id",
      });

      if (error) {
        throw new Error(error.message);
      }
    }

    const result = {
      syncedCount: rows.length,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "locations",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    await insertSyncRun({
      supabase,
      shop,
      syncType: "locations",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function syncProducts({
  admin,
  shop,
  supabase,
  source,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
}) {
  const startedAt = new Date().toISOString();

  try {
    const response = await admin.graphql(`#graphql
      query getProductsForSync {
        products(first: 100) {
          edges {
            node {
              id
              title
              vendor
              productType
              status
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    inventoryItem {
                      id
                      unitCost {
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
    `);

    const data = await response.json();

    if ("errors" in data && data.errors) {
      throw new Error(JSON.stringify(data.errors));
    }

    const products: ProductNode[] =
      data.data?.products?.edges?.map(
        (edge: { node: ProductNode }) => edge.node,
      ) ?? [];

    const productRows = products.map((product) => ({
      shop_domain: shop,
      shopify_product_id: product.id,
      title: product.title,
      vendor: product.vendor ?? null,
      product_type: product.productType ?? null,
      status: product.status ?? null,
      updated_at: new Date().toISOString(),
    }));

    const variantRows = products.flatMap((product) =>
      product.variants.edges.map(({ node: variant }) => ({
        shop_domain: shop,
        shopify_variant_id: variant.id,
        shopify_product_id: product.id,
        inventory_item_id: variant.inventoryItem?.id ?? null,
        title: variant.title,
        sku: variant.sku ?? null,
        price: variant.price ? Number(variant.price) : null,
        unit_cost: parseNullableNumericAmount(
          variant.inventoryItem?.unitCost?.amount,
        ),
        updated_at: new Date().toISOString(),
      })),
    );

    if (productRows.length > 0) {
      const { error } = await supabase.from("products").upsert(productRows, {
        onConflict: "shop_domain,shopify_product_id",
      });

      if (error) {
        throw new Error(error.message);
      }
    }

    if (variantRows.length > 0) {
      const { error } = await supabase.from("variants").upsert(variantRows, {
        onConflict: "shop_domain,shopify_variant_id",
      });

      if (error) {
        throw new Error(error.message);
      }
    }

    const result = {
      productsSynced: productRows.length,
      variantsSynced: variantRows.length,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "products",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    await insertSyncRun({
      supabase,
      shop,
      syncType: "products",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function syncProductById({
  admin,
  shop,
  supabase,
  source,
  productId,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  productId: string;
}) {
  const startedAt = new Date().toISOString();

  try {
    const response = await admin.graphql(
      `#graphql
        query getProductForSync($id: ID!) {
          node(id: $id) {
            ... on Product {
              id
              title
              vendor
              productType
              status
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    inventoryItem {
                      id
                      unitCost {
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
          id: normalizeProductId(productId),
        },
      },
    );

    const data = await response.json();

    if ("errors" in data && data.errors) {
      throw new Error(JSON.stringify(data.errors));
    }

    const product = data.data?.node as ProductNode | null | undefined;

    if (!product) {
      throw new Error(`Product not found for ${productId}.`);
    }

    const productRows = [
      {
        shop_domain: shop,
        shopify_product_id: product.id,
        title: product.title,
        vendor: product.vendor ?? null,
        product_type: product.productType ?? null,
        status: product.status ?? null,
        updated_at: new Date().toISOString(),
      },
    ];

    const variantRows = product.variants.edges.map(({ node: variant }) => ({
      shop_domain: shop,
      shopify_variant_id: variant.id,
      shopify_product_id: product.id,
      inventory_item_id: variant.inventoryItem?.id ?? null,
      title: variant.title,
      sku: variant.sku ?? null,
      price: variant.price ? Number(variant.price) : null,
      unit_cost: parseNullableNumericAmount(
        variant.inventoryItem?.unitCost?.amount,
      ),
      updated_at: new Date().toISOString(),
    }));

    const { error: productError } = await supabase
      .from("products")
      .upsert(productRows, {
        onConflict: "shop_domain,shopify_product_id",
      });

    if (productError) {
      throw new Error(productError.message);
    }

    if (variantRows.length > 0) {
      const { error: variantsError } = await supabase
        .from("variants")
        .upsert(variantRows, {
          onConflict: "shop_domain,shopify_variant_id",
        });

      if (variantsError) {
        throw new Error(variantsError.message);
      }
    }

    const orderLinesCogsRecomputed = await recomputeOrderLineCogsForVariants({
      supabase,
      shop,
      variantRows,
    });
    const variantsWithUnitCostSynced = variantRows.filter(
      (variant) => variant.unit_cost !== null,
    ).length;
    const variantsWithMissingUnitCost =
      variantRows.length - variantsWithUnitCostSynced;

    const result = {
      productsSynced: 1,
      variantsSynced: variantRows.length,
      variantsWithUnitCostSynced,
      variantsWithMissingUnitCost,
      orderLinesCogsRecomputed,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "products",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    await insertSyncRun({
      supabase,
      shop,
      syncType: "products",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function markProductDeletedById({
  shop,
  supabase,
  source,
  productId,
}: {
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  productId: string;
}) {
  const startedAt = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("products")
      .update({
        status: "DELETED",
        updated_at: new Date().toISOString(),
      })
      .eq("shop_domain", shop)
      .eq("shopify_product_id", normalizeProductId(productId))
      .select("shopify_product_id");

    if (error) {
      throw new Error(error.message);
    }

    const result = {
      productsDeleted: data && data.length > 0 ? 1 : 0,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "products",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    await insertSyncRun({
      supabase,
      shop,
      syncType: "products",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function syncInventory({
  admin,
  shop,
  supabase,
  source,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
}) {
  const startedAt = new Date().toISOString();

  try {
    const { data: variantRows, error: variantsError } = await supabase
      .from("variants")
      .select("shopify_variant_id, inventory_item_id, sku")
      .eq("shop_domain", shop)
      .not("inventory_item_id", "is", null);

    if (variantsError) {
      throw new Error(variantsError.message);
    }

    const variants = (variantRows ?? []) as VariantDbRow[];

    if (variants.length === 0) {
      throw new Error(
        "No variants with inventory_item_id found. Run products & variants sync first.",
      );
    }

    const variantByInventoryItemId = new Map<string, VariantDbRow>();

    for (const variant of variants) {
      variantByInventoryItemId.set(variant.inventory_item_id, variant);
    }

    const inventoryItemIds = Array.from(
      new Set(variants.map((variant) => variant.inventory_item_id)),
    );

    const chunks = chunkArray(inventoryItemIds, INVENTORY_BATCH_SIZE);

    let totalInventoryLevelsSynced = 0;
    let totalInventoryItemsProcessed = 0;

    for (const chunk of chunks) {
      const response = await admin.graphql(
        `#graphql
          query getInventoryItemsForSync($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on InventoryItem {
                id
                sku
                tracked
                inventoryLevels(first: 20) {
                  edges {
                    node {
                      location {
                        id
                        name
                      }
                      quantities(names: ["available"]) {
                        name
                        quantity
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
            ids: chunk,
          },
        },
      );

      const data = await response.json();

      if ("errors" in data && data.errors) {
        throw new Error(JSON.stringify(data.errors));
      }

      const inventoryItems: InventoryItemNode[] = (
        data.data?.nodes ?? []
      ).filter(Boolean);

      const rows = inventoryItems.flatMap((inventoryItem) => {
        const variant = variantByInventoryItemId.get(inventoryItem.id);

        if (!variant) {
          return [];
        }

        return inventoryItem.inventoryLevels.edges.map(({ node: level }) => ({
          shop_domain: shop,
          shopify_location_id: level.location.id,
          shopify_variant_id: variant.shopify_variant_id,
          inventory_item_id: inventoryItem.id,
          sku: variant.sku ?? inventoryItem.sku ?? null,
          available: getAvailableQuantity(level),
          tracked: inventoryItem.tracked,
          synced_at: new Date().toISOString(),
        }));
      });

      if (rows.length > 0) {
        const { error } = await supabase.from("inventory_levels").upsert(rows, {
          onConflict: "shop_domain,shopify_location_id,inventory_item_id",
        });

        if (error) {
          throw new Error(error.message);
        }
      }

      totalInventoryItemsProcessed += inventoryItems.length;
      totalInventoryLevelsSynced += rows.length;
    }

    const result = {
      inventoryItemsProcessed: totalInventoryItemsProcessed,
      inventoryLevelsSynced: totalInventoryLevelsSynced,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "inventory",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    await insertSyncRun({
      supabase,
      shop,
      syncType: "inventory",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function syncInventoryItems({
  admin,
  shop,
  supabase,
  source,
  inventoryItemIds,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  inventoryItemIds: string[];
}) {
  const startedAt = new Date().toISOString();

  try {
    const normalizedInventoryItemIds = Array.from(
      new Set(
        inventoryItemIds
          .map((inventoryItemId) => inventoryItemId.trim())
          .filter(Boolean)
          .map(normalizeInventoryItemId),
      ),
    );

    const { data: variantRows, error: variantsError } = await supabase
      .from("variants")
      .select("shopify_variant_id, shopify_product_id, inventory_item_id, sku")
      .eq("shop_domain", shop)
      .in("inventory_item_id", normalizedInventoryItemIds);

    if (variantsError) {
      throw new Error(variantsError.message);
    }

    const variants = (variantRows ?? []) as VariantDbRow[];
    const variantByInventoryItemId = new Map<string, VariantDbRow>();

    for (const variant of variants) {
      variantByInventoryItemId.set(variant.inventory_item_id, variant);
    }

    let totalInventoryLevelsSynced = 0;
    let totalInventoryItemsProcessed = 0;
    let totalVariantsUnitCostUpdated = 0;
    let totalOrderLinesCogsRecomputed = 0;

    for (const chunk of chunkArray(
      normalizedInventoryItemIds,
      INVENTORY_BATCH_SIZE,
    )) {
      const response = await admin.graphql(
        `#graphql
          query getInventoryItemsForSync($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on InventoryItem {
                id
                sku
                tracked
                unitCost {
                  amount
                  currencyCode
                }
                inventoryLevels(first: 20) {
                  edges {
                    node {
                      location {
                        id
                        name
                      }
                      quantities(names: ["available"]) {
                        name
                        quantity
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
            ids: chunk,
          },
        },
      );

      const data = await response.json();

      if ("errors" in data && data.errors) {
        throw new Error(JSON.stringify(data.errors));
      }

      const inventoryItems: InventoryItemNode[] = (
        data.data?.nodes ?? []
      ).filter(Boolean);

      const affectedVariantRows: Array<{
        shopify_variant_id: string;
        shopify_product_id?: string | null;
        sku: string | null;
        unit_cost: number | null;
      }> = [];

      for (const inventoryItem of inventoryItems) {
        const variant = variantByInventoryItemId.get(inventoryItem.id);

        if (!variant) {
          continue;
        }

        const unitCost = parseNullableNumericAmount(
          inventoryItem.unitCost?.amount,
        );
        const { data: updatedVariantRows, error: variantUpdateError } =
          await supabase
            .from("variants")
            .update({
              unit_cost: unitCost,
              updated_at: new Date().toISOString(),
            })
            .eq("shop_domain", shop)
            .eq("inventory_item_id", inventoryItem.id)
            .select("shopify_variant_id");

        if (variantUpdateError) {
          throw new Error(variantUpdateError.message);
        }

        totalVariantsUnitCostUpdated += updatedVariantRows?.length ?? 0;
        affectedVariantRows.push({
          shopify_variant_id: variant.shopify_variant_id,
          shopify_product_id: variant.shopify_product_id,
          sku: variant.sku ?? inventoryItem.sku ?? null,
          unit_cost: unitCost,
        });
      }

      const rows = inventoryItems.flatMap((inventoryItem) => {
        const variant = variantByInventoryItemId.get(inventoryItem.id);

        if (!variant) {
          return [];
        }

        return inventoryItem.inventoryLevels.edges.map(({ node: level }) => ({
          shop_domain: shop,
          shopify_location_id: level.location.id,
          shopify_variant_id: variant.shopify_variant_id,
          inventory_item_id: inventoryItem.id,
          sku: variant.sku ?? inventoryItem.sku ?? null,
          available: getAvailableQuantity(level),
          tracked: inventoryItem.tracked,
          synced_at: new Date().toISOString(),
        }));
      });

      if (rows.length > 0) {
        const { error } = await supabase.from("inventory_levels").upsert(rows, {
          onConflict: "shop_domain,shopify_location_id,inventory_item_id",
        });

        if (error) {
          throw new Error(error.message);
        }
      }

      totalInventoryItemsProcessed += inventoryItems.length;
      totalInventoryLevelsSynced += rows.length;
      totalOrderLinesCogsRecomputed +=
        await recomputeOrderLineCogsForVariants({
          supabase,
          shop,
          variantRows: affectedVariantRows,
        });
    }

    const result = {
      inventoryItemsProcessed: totalInventoryItemsProcessed,
      inventoryLevelsSynced: totalInventoryLevelsSynced,
      variantsUnitCostUpdated: totalVariantsUnitCostUpdated,
      orderLinesCogsRecomputed: totalOrderLinesCogsRecomputed,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "inventory",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    await insertSyncRun({
      supabase,
      shop,
      syncType: "inventory",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function syncOrders({
  admin,
  shop,
  supabase,
  source,
  startDate,
  endDate,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const startedAt = new Date().toISOString();

  try {
    const orderQuery = buildOrderQuery({ startDate, endDate });

    const { data: variantCostsData, error: variantCostsError } = await supabase
      .from("variants")
      .select("shopify_variant_id, inventory_item_id, sku, unit_cost")
      .eq("shop_domain", shop);

    if (variantCostsError) {
      throw new Error(variantCostsError.message);
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

      const data = await response.json();

      if ("errors" in data && data.errors) {
        throw new Error(JSON.stringify(data.errors));
      }

      const ordersConnection = data.data?.orders;
      const orders: OrderNode[] =
        ordersConnection?.edges?.map((edge: { node: OrderNode }) => edge.node) ??
        [];

      const orderRows = orders.map((order) => ({
        shop_domain: shop,
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
            shop_domain: shop,
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

      hasNextPage = ordersConnection.pageInfo.hasNextPage;
      cursor = ordersConnection.pageInfo.endCursor;

      if (orders.length === 0) {
        break;
      }
    }

    const result = {
      ordersSynced: totalOrdersSynced,
      orderLinesSynced: totalOrderLinesSynced,
      pagesProcessed,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "orders",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    await insertSyncRun({
      supabase,
      shop,
      syncType: "orders",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}

export async function runFullSync({
  admin,
  shop,
  source = "manual_admin_sync",
  orderLookbackDays = 7,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  source?: SyncSource;
  orderLookbackDays?: number;
}) {
  const supabase = getSupabaseAdminClient();
  const startedAt = new Date().toISOString();
  let currentStep = "initializing";

  try {
    currentStep = "locations";
    const locations = await syncLocations({
      admin,
      shop,
      supabase,
      source,
    });

    currentStep = "products";
    const products = await syncProducts({
      admin,
      shop,
      supabase,
      source,
    });

    currentStep = "inventory";
    const inventory = await syncInventory({
      admin,
      shop,
      supabase,
      source,
    });

    const { startDate, endDate } = getIncrementalOrderDateRange(orderLookbackDays);

    currentStep = "orders";
    const orders = await syncOrders({
      admin,
      shop,
      supabase,
      source,
      startDate,
      endDate,
    });

    return {
      ok: true,
      source,
      shop,
      startedAt,
      finishedAt: new Date().toISOString(),
      locations,
      products,
      inventory,
      orders,
    };
  } catch (error) {
    return {
      ok: false,
      source,
      shop,
      failedStep: currentStep,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : null,
      errorStack: error instanceof Error ? error.stack : null,
    };
  }
}
