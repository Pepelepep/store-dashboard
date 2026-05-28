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

type ShopifyGraphqlErrorDetails = {
  queryName: string;
  message: string;
  errorName?: string | null;
  httpStatus?: number | null;
  statusText?: string | null;
  responseBody?: unknown;
  graphqlErrors?: unknown;
  variables?: Record<string, unknown>;
};

class ShopifyGraphqlRequestError extends Error {
  details: ShopifyGraphqlErrorDetails;

  constructor(details: ShopifyGraphqlErrorDetails) {
    super(details.message);
    this.name = "ShopifyGraphqlRequestError";
    this.details = details;
  }
}

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
    pageInfo?: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
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

type InventoryItemCostWebhookUpdate = {
  inventoryItemId: string;
  sku?: string | null;
  tracked?: boolean | null;
  unitCost: number | null;
  hasExplicitUnitCost: boolean;
};

type InventoryItemSnapshotInput = {
  inventoryItemId: string;
  sku?: string | null;
  tracked?: boolean | null;
  unitCost: number | null;
  hasUnitCostValue: boolean;
  costSource: string;
};

type InventoryItemSnapshotRow = {
  inventory_item_id: string;
  sku: string | null;
  tracked: boolean | null;
  unit_cost: number | null;
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
  staffMember?: StaffMemberAttributionNode | null;
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

type StaffMemberNode = {
  id: string;
  name?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  active?: boolean | null;
  isShopOwner?: boolean | null;
};

type StaffMemberAttributionNode = {
  id: string;
  name?: string | null;
  email?: string | null;
};

type OrderTransactionNode = {
  id: string;
  kind?: string | null;
  status?: string | null;
  user?: StaffMemberAttributionNode | null;
};

type StaffSource =
  | "line_item_staff"
  | "order_staff"
  | "transaction_user"
  | "unavailable";

type StaffAttribution = {
  staffMemberId: string | null;
  staffMemberName: string | null;
  staffMemberEmail: string | null;
  staffSource: StaffSource;
};

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus?: string | null;
  staffMember?: StaffMemberAttributionNode | null;
  transactions?: OrderTransactionNode[] | null;
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

export type SyncSource =
  | "manual_admin_sync"
  | "scheduled_daily_sync"
  | "webhook";

const INVENTORY_BATCH_SIZE = 25;
const PRODUCT_SYNC_PAGE_SIZE = 20;
const PRODUCT_VARIANT_SYNC_PAGE_SIZE = 50;
const ORDERS_PAGE_SIZE = 50;
const LINE_ITEMS_PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 500;

export type ProductsSyncBatchProgress = {
  cursor?: string | null;
};

export type InventorySyncBatchProgress = {
  offset?: number;
};

export type OrdersSyncBatchProgress = {
  cursor?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  staffAttributionAvailable?: boolean;
};

export type SyncBatchResult = {
  done: boolean;
  progress: Record<string, unknown>;
  counts: Record<string, number | boolean | string | null>;
};

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

function getGraphqlErrorMessage(data: unknown) {
  if (
    typeof data === "object" &&
    data !== null &&
    "errors" in data &&
    (data as { errors?: unknown }).errors
  ) {
    return JSON.stringify((data as { errors: unknown }).errors);
  }

  return null;
}

function getObjectValue(object: unknown, key: string) {
  if (typeof object !== "object" || object === null || !(key in object)) {
    return undefined;
  }

  return (object as Record<string, unknown>)[key];
}

function getGraphqlRequestErrorDetails(error: unknown) {
  if (error instanceof ShopifyGraphqlRequestError) {
    return error.details;
  }

  return null;
}

function getHttpStatusFromResponse(response: unknown) {
  const status =
    getObjectValue(response, "status") ?? getObjectValue(response, "code");
  return typeof status === "number" ? status : null;
}

function getStatusTextFromResponse(response: unknown) {
  const statusText =
    getObjectValue(response, "statusText") ??
    getObjectValue(response, "status");
  return typeof statusText === "string" ? statusText : null;
}

function buildGraphqlErrorDetails({
  error,
  queryName,
  variables,
}: {
  error: unknown;
  queryName: string;
  variables?: Record<string, unknown>;
}): ShopifyGraphqlErrorDetails {
  const errorBody = getObjectValue(error, "body");
  const errorResponse = getObjectValue(error, "response");
  const graphqlErrors =
    getObjectValue(getObjectValue(errorBody, "errors"), "graphQLErrors") ??
    getObjectValue(errorBody, "errors");

  return {
    queryName,
    message: error instanceof Error ? error.message : String(error),
    errorName: error instanceof Error ? error.name : null,
    httpStatus: getHttpStatusFromResponse(errorResponse),
    statusText: getStatusTextFromResponse(errorResponse),
    responseBody: errorBody ?? null,
    graphqlErrors: graphqlErrors ?? null,
    variables,
  };
}

async function readJsonResponse({
  response,
  queryName,
  variables,
}: {
  response: Response;
  queryName: string;
  variables?: Record<string, unknown>;
}) {
  const responseText = await response.text();
  let responseBody: unknown = null;

  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }
  }

  const graphqlErrorMessage = getGraphqlErrorMessage(responseBody);

  if (!response.ok || graphqlErrorMessage) {
    throw new ShopifyGraphqlRequestError({
      queryName,
      message:
        graphqlErrorMessage ??
        `Shopify GraphQL HTTP ${response.status} ${response.statusText}`,
      errorName: "ShopifyGraphqlHttpError",
      httpStatus: response.status,
      statusText: response.statusText,
      responseBody,
      graphqlErrors:
        typeof responseBody === "object" && responseBody !== null
          ? (getObjectValue(responseBody, "errors") ?? null)
          : null,
      variables,
    });
  }

  return responseBody as Record<string, unknown>;
}

async function executeShopifyGraphql({
  admin,
  query,
  queryName,
  variables,
}: {
  admin: ShopifyAdminClient;
  query: string;
  queryName: string;
  variables?: Record<string, unknown>;
}) {
  try {
    const response = await admin.graphql(query, { variables });

    return await readJsonResponse({
      response,
      queryName,
      variables,
    });
  } catch (error) {
    if (error instanceof ShopifyGraphqlRequestError) {
      throw error;
    }

    throw new ShopifyGraphqlRequestError(
      buildGraphqlErrorDetails({ error, queryName, variables }),
    );
  }
}

function normalizeStaffId(staffId?: string | null) {
  return staffId?.split("/").pop() ?? null;
}

function getStaffAttribution(
  staffMember?: StaffMemberAttributionNode | null,
  source: StaffSource = "unavailable",
): StaffAttribution {
  if (!staffMember?.id) {
    return {
      staffMemberId: null,
      staffMemberName: null,
      staffMemberEmail: null,
      staffSource: "unavailable",
    };
  }

  return {
    staffMemberId: normalizeStaffId(staffMember.id),
    staffMemberName: staffMember.name ?? null,
    staffMemberEmail: staffMember.email ?? null,
    staffSource: source,
  };
}

function getTransactionStaffAttribution(
  transactions?: OrderTransactionNode[] | null,
): StaffAttribution {
  const transactionUser = transactions?.find(
    (transaction) => transaction.user?.id,
  )?.user;

  return getStaffAttribution(transactionUser, "transaction_user");
}

function getOrderStaffAttribution(order: OrderNode): StaffAttribution {
  const orderStaff = getStaffAttribution(order.staffMember, "order_staff");

  if (orderStaff.staffMemberId) {
    return orderStaff;
  }

  return getTransactionStaffAttribution(order.transactions);
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

async function upsertInventoryItemSnapshots({
  supabase,
  shop,
  snapshots,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  snapshots: InventoryItemSnapshotInput[];
}) {
  const normalizedSnapshots = snapshots
    .map((snapshot) => ({
      ...snapshot,
      inventoryItemId: normalizeInventoryItemId(snapshot.inventoryItemId),
    }))
    .filter((snapshot) => snapshot.inventoryItemId);

  if (normalizedSnapshots.length === 0) {
    return new Map<string, InventoryItemSnapshotRow>();
  }

  const inventoryItemIds = Array.from(
    new Set(normalizedSnapshots.map((snapshot) => snapshot.inventoryItemId)),
  );
  const { data: existingRows, error: existingError } = await supabase
    .from("inventory_items")
    .select("inventory_item_id, sku, tracked, unit_cost")
    .eq("shop_domain", shop)
    .in("inventory_item_id", inventoryItemIds);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingById = new Map(
    ((existingRows ?? []) as InventoryItemSnapshotRow[]).map((row) => [
      row.inventory_item_id,
      row,
    ]),
  );
  const snapshotById = new Map<string, InventoryItemSnapshotInput>();

  for (const snapshot of normalizedSnapshots) {
    snapshotById.set(snapshot.inventoryItemId, snapshot);
  }

  const rows = Array.from(snapshotById.values()).map((snapshot) => {
    const existing = existingById.get(snapshot.inventoryItemId);
    const unitCost = snapshot.hasUnitCostValue
      ? snapshot.unitCost
      : (existing?.unit_cost ?? null);

    return {
      shop_domain: shop,
      inventory_item_id: snapshot.inventoryItemId,
      sku: snapshot.sku ?? existing?.sku ?? null,
      tracked: snapshot.tracked ?? existing?.tracked ?? null,
      unit_cost: unitCost,
      cost_source: snapshot.hasUnitCostValue
        ? snapshot.costSource
        : existing
          ? "PRESERVED_EXISTING_COST"
          : "MISSING_COST",
      synced_at: new Date().toISOString(),
    };
  });

  await upsertInBatches({
    supabase,
    table: "inventory_items",
    rows,
    onConflict: "shop_domain,inventory_item_id",
  });

  return new Map(
    rows.map((row) => [
      row.inventory_item_id,
      {
        inventory_item_id: row.inventory_item_id,
        sku: row.sku,
        tracked: row.tracked,
        unit_cost: row.unit_cost,
      },
    ]),
  );
}

async function getExistingVariantCosts({
  supabase,
  shop,
  variantIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  variantIds: string[];
}) {
  const uniqueVariantIds = Array.from(new Set(variantIds)).filter(Boolean);

  if (uniqueVariantIds.length === 0) {
    return new Map<string, number | null>();
  }

  const { data, error } = await supabase
    .from("variants")
    .select("shopify_variant_id, unit_cost")
    .eq("shop_domain", shop)
    .in("shopify_variant_id", uniqueVariantIds);

  if (error) {
    throw new Error(error.message);
  }

  return new Map(
    (
      (data ?? []) as Array<{
        shopify_variant_id: string;
        unit_cost: number | null;
      }>
    ).map((row) => [row.shopify_variant_id, row.unit_cost]),
  );
}

async function updateVariantsFromInventoryItemSnapshots({
  supabase,
  shop,
  inventoryItemIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  inventoryItemIds: string[];
}) {
  const normalizedInventoryItemIds = Array.from(
    new Set(inventoryItemIds.map(normalizeInventoryItemId)),
  );

  if (normalizedInventoryItemIds.length === 0) {
    return {
      variantsUpdated: 0,
      affectedVariantRows: [] as Array<{
        shopify_variant_id: string;
        shopify_product_id?: string | null;
        sku: string | null;
        unit_cost: number | null;
      }>,
    };
  }

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("inventory_items")
    .select("inventory_item_id, sku, unit_cost")
    .eq("shop_domain", shop)
    .in("inventory_item_id", normalizedInventoryItemIds);

  if (snapshotsError) {
    throw new Error(snapshotsError.message);
  }

  const snapshotByInventoryItemId = new Map(
    ((snapshots ?? []) as InventoryItemSnapshotRow[]).map((snapshot) => [
      snapshot.inventory_item_id,
      snapshot,
    ]),
  );

  const { data: variantsData, error: variantsError } = await supabase
    .from("variants")
    .select("shopify_variant_id, shopify_product_id, inventory_item_id, sku")
    .eq("shop_domain", shop)
    .in("inventory_item_id", normalizedInventoryItemIds);

  if (variantsError) {
    throw new Error(variantsError.message);
  }

  const variants = (variantsData ?? []) as VariantDbRow[];
  const affectedVariantRows: Array<{
    shopify_variant_id: string;
    shopify_product_id?: string | null;
    sku: string | null;
    unit_cost: number | null;
  }> = [];
  let variantsUpdated = 0;

  for (const variant of variants) {
    const snapshot = snapshotByInventoryItemId.get(variant.inventory_item_id);

    if (!snapshot) {
      continue;
    }

    const { error: variantUpdateError } = await supabase
      .from("variants")
      .update({
        unit_cost: snapshot.unit_cost,
        sku: variant.sku ?? snapshot.sku ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("shop_domain", shop)
      .eq("shopify_variant_id", variant.shopify_variant_id);

    if (variantUpdateError) {
      throw new Error(variantUpdateError.message);
    }

    variantsUpdated += 1;
    affectedVariantRows.push({
      shopify_variant_id: variant.shopify_variant_id,
      shopify_product_id: variant.shopify_product_id,
      sku: variant.sku ?? snapshot.sku ?? null,
      unit_cost: snapshot.unit_cost,
    });
  }

  return {
    variantsUpdated,
    affectedVariantRows,
  };
}

async function getRemainingProductVariantsForSync({
  admin,
  productId,
  cursor,
}: {
  admin: ShopifyAdminClient;
  productId: string;
  cursor?: string | null;
}) {
  const variants: ProductNode["variants"]["edges"] = [];
  let nextCursor = cursor ?? null;
  let hasNextPage = Boolean(nextCursor);

  while (hasNextPage && nextCursor) {
    const data = await executeShopifyGraphql({
      admin,
      query: `#graphql
        query getProductVariantsForSync($productId: ID!, $first: Int!, $cursor: String) {
          node(id: $productId) {
            ... on Product {
              variants(first: $first, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
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
      queryName: "getProductVariantsForSync",
      variables: {
        productId,
        first: PRODUCT_VARIANT_SYNC_PAGE_SIZE,
        cursor: nextCursor,
      },
    });
    const connection = (data.data as { node?: ProductNode | null } | undefined)
      ?.node?.variants;

    if (!connection) {
      break;
    }

    variants.push(...connection.edges);
    hasNextPage = Boolean(connection.pageInfo?.hasNextPage);
    nextCursor = connection.pageInfo?.endCursor ?? null;
  }

  return variants;
}

async function getProductsForSync(admin: ShopifyAdminClient) {
  const products: ProductNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await executeShopifyGraphql({
      admin,
      query: `#graphql
        query getProductsForSync($first: Int!, $cursor: String, $variantFirst: Int!) {
          products(first: $first, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                vendor
                productType
                status
                variants(first: $variantFirst) {
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
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
      `,
      queryName: "getProductsForSync",
      variables: {
        first: PRODUCT_SYNC_PAGE_SIZE,
        cursor,
        variantFirst: PRODUCT_VARIANT_SYNC_PAGE_SIZE,
      },
    });
    const connection = (
      data.data as
        | {
            products?: {
              pageInfo?: {
                hasNextPage: boolean;
                endCursor?: string | null;
              };
              edges?: Array<{ node: ProductNode }>;
            };
          }
        | undefined
    )?.products;
    const pageProducts = connection?.edges?.map((edge) => edge.node) ?? [];

    for (const product of pageProducts) {
      const remainingVariants = await getRemainingProductVariantsForSync({
        admin,
        productId: product.id,
        cursor: product.variants.pageInfo?.endCursor ?? null,
      });

      products.push({
        ...product,
        variants: {
          ...product.variants,
          edges: [...product.variants.edges, ...remainingVariants],
          pageInfo: {
            hasNextPage: false,
            endCursor:
              remainingVariants.at(-1)?.node.id ??
              product.variants.pageInfo?.endCursor ??
              null,
          },
        },
      });
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = connection?.pageInfo?.endCursor ?? null;

    if (pageProducts.length === 0) {
      break;
    }
  }

  return products;
}

async function syncProductNodes({
  supabase,
  shop,
  products,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  products: ProductNode[];
}) {
  const productRows = products.map((product) => ({
    shop_domain: shop,
    shopify_product_id: product.id,
    title: product.title,
    vendor: product.vendor ?? null,
    product_type: product.productType ?? null,
    status: product.status ?? null,
    updated_at: new Date().toISOString(),
  }));

  const rawVariantRows = products.flatMap((product) =>
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
  const existingVariantCosts = await getExistingVariantCosts({
    supabase,
    shop,
    variantIds: rawVariantRows.map((variant) => variant.shopify_variant_id),
  });
  const variantRows = rawVariantRows.map((variant) => ({
    ...variant,
    unit_cost:
      variant.unit_cost ??
      existingVariantCosts.get(variant.shopify_variant_id) ??
      null,
  }));

  await upsertInBatches({
    supabase,
    table: "products",
    rows: productRows,
    onConflict: "shop_domain,shopify_product_id",
  });

  await upsertInBatches({
    supabase,
    table: "variants",
    rows: variantRows,
    onConflict: "shop_domain,shopify_variant_id",
  });

  await upsertInventoryItemSnapshots({
    supabase,
    shop,
    snapshots: variantRows
      .filter((variant) => variant.inventory_item_id)
      .map((variant) => ({
        inventoryItemId: variant.inventory_item_id as string,
        sku: variant.sku,
        unitCost: variant.unit_cost,
        hasUnitCostValue: variant.unit_cost !== null,
        costSource: "PRODUCT_SYNC_UNIT_COST",
      })),
  });

  const orderLinesCogsRecomputed = await recomputeOrderLineCogsForVariants({
    supabase,
    shop,
    variantRows,
  });
  const variantsWithUnitCostSynced = variantRows.filter(
    (variant) => variant.unit_cost !== null,
  ).length;

  return {
    productsSynced: productRows.length,
    variantsSynced: variantRows.length,
    variantsWithUnitCostSynced,
    variantsWithMissingUnitCost: variantRows.length - variantsWithUnitCostSynced,
    orderLinesCogsRecomputed,
  };
}

export async function syncProductsBatch({
  admin,
  shop,
  supabase,
  progress,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  progress?: ProductsSyncBatchProgress | null;
}): Promise<SyncBatchResult> {
  const cursor = progress?.cursor ?? null;
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getProductsForSyncBatch($first: Int!, $cursor: String, $variantFirst: Int!) {
        products(first: $first, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              vendor
              productType
              status
              variants(first: $variantFirst) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
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
    `,
    queryName: "getProductsForSyncBatch",
    variables: {
      first: PRODUCT_SYNC_PAGE_SIZE,
      cursor,
      variantFirst: PRODUCT_VARIANT_SYNC_PAGE_SIZE,
    },
  });
  const connection = (
    data.data as
      | {
          products?: {
            pageInfo?: {
              hasNextPage: boolean;
              endCursor?: string | null;
            };
            edges?: Array<{ node: ProductNode }>;
          };
        }
      | undefined
  )?.products;
  const pageProducts = connection?.edges?.map((edge) => edge.node) ?? [];
  const products: ProductNode[] = [];

  for (const product of pageProducts) {
    const remainingVariants = await getRemainingProductVariantsForSync({
      admin,
      productId: product.id,
      cursor: product.variants.pageInfo?.endCursor ?? null,
    });

    products.push({
      ...product,
      variants: {
        ...product.variants,
        edges: [...product.variants.edges, ...remainingVariants],
        pageInfo: {
          hasNextPage: false,
          endCursor:
            remainingVariants.at(-1)?.node.id ??
            product.variants.pageInfo?.endCursor ??
            null,
        },
      },
    });
  }

  const counts = await syncProductNodes({ supabase, shop, products });
  const hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);

  return {
    done: !hasNextPage || pageProducts.length === 0,
    progress: {
      cursor: hasNextPage ? (connection?.pageInfo?.endCursor ?? null) : null,
    },
    counts,
  };
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
    variantRows.map((variant) => [
      variant.shopify_variant_id,
      variant.unit_cost,
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
      .filter((variant) => isUsableSku(variant.sku))
      .map((variant) => [normalizeSku(variant.sku), variant.unit_cost]),
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
    const cogs = unitCost === null ? null : unitCost * quantity;

    const { error: updateError } = await supabase
      .from("order_lines")
      .update({
        unit_cost: unitCost,
        cogs,
        gross_profit: cogs === null ? null : revenue - cogs,
        cost_source:
          unitCost === null
            ? "MISSING_COST"
            : "recomputed_from_current_variant_cost",
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
  includeStaffAttribution = false,
}: {
  admin: ShopifyAdminClient;
  order: OrderNode;
  includeStaffAttribution?: boolean;
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
                    ${
                      includeStaffAttribution
                        ? `
                    staffMember {
                      id
                      name
                      email
                    }
                    `
                        : ""
                    }
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
    const graphqlErrorMessage = getGraphqlErrorMessage(data);

    if (graphqlErrorMessage) {
      throw new Error(graphqlErrorMessage);
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
    const products = await getProductsForSync(admin);

    const productRows = products.map((product) => ({
      shop_domain: shop,
      shopify_product_id: product.id,
      title: product.title,
      vendor: product.vendor ?? null,
      product_type: product.productType ?? null,
      status: product.status ?? null,
      updated_at: new Date().toISOString(),
    }));

    const rawVariantRows = products.flatMap((product) =>
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
    const existingVariantCosts = await getExistingVariantCosts({
      supabase,
      shop,
      variantIds: rawVariantRows.map((variant) => variant.shopify_variant_id),
    });
    const variantRows = rawVariantRows.map((variant) => ({
      ...variant,
      unit_cost:
        variant.unit_cost ??
        existingVariantCosts.get(variant.shopify_variant_id) ??
        null,
    }));

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

    await upsertInventoryItemSnapshots({
      supabase,
      shop,
      snapshots: variantRows
        .filter((variant) => variant.inventory_item_id)
        .map((variant) => ({
          inventoryItemId: variant.inventory_item_id as string,
          sku: variant.sku,
          unitCost: variant.unit_cost,
          hasUnitCostValue: variant.unit_cost !== null,
          costSource: "PRODUCT_SYNC_UNIT_COST",
        })),
    });

    const orderLinesCogsRecomputed = await recomputeOrderLineCogsForVariants({
      supabase,
      shop,
      variantRows,
    });
    const variantsWithUnitCostSynced = variantRows.filter(
      (variant) => variant.unit_cost !== null,
    ).length;

    const result = {
      productsSynced: productRows.length,
      variantsSynced: variantRows.length,
      variantsWithUnitCostSynced,
      variantsWithMissingUnitCost:
        variantRows.length - variantsWithUnitCostSynced,
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
    const graphqlDetails = getGraphqlRequestErrorDetails(error);

    await insertSyncRun({
      supabase,
      shop,
      syncType: "products",
      status: "error",
      source,
      startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
      details: graphqlDetails
        ? {
            failedStep: "shopify_graphql_products_sync",
            ...graphqlDetails,
          }
        : undefined,
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

    const rawVariantRows = product.variants.edges.map(({ node: variant }) => ({
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
    const existingVariantCosts = await getExistingVariantCosts({
      supabase,
      shop,
      variantIds: rawVariantRows.map((variant) => variant.shopify_variant_id),
    });
    const variantRows = rawVariantRows.map((variant) => ({
      ...variant,
      unit_cost:
        variant.unit_cost ??
        existingVariantCosts.get(variant.shopify_variant_id) ??
        null,
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

    await upsertInventoryItemSnapshots({
      supabase,
      shop,
      snapshots: variantRows
        .filter((variant) => variant.inventory_item_id)
        .map((variant) => ({
          inventoryItemId: variant.inventory_item_id as string,
          sku: variant.sku,
          unitCost: variant.unit_cost,
          hasUnitCostValue: variant.unit_cost !== null,
          costSource: "PRODUCT_SYNC_UNIT_COST",
        })),
    });

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
      .select("shopify_variant_id, shopify_product_id, inventory_item_id, sku")
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
    let totalVariantsUnitCostUpdated = 0;
    let totalOrderLinesCogsRecomputed = 0;

    for (const chunk of chunks) {
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

      await upsertInventoryItemSnapshots({
        supabase,
        shop,
        snapshots: inventoryItems.map((inventoryItem) => {
          const unitCost = parseNullableNumericAmount(
            inventoryItem.unitCost?.amount,
          );

          return {
            inventoryItemId: inventoryItem.id,
            sku: inventoryItem.sku ?? null,
            tracked: inventoryItem.tracked,
            unitCost,
            hasUnitCostValue: unitCost !== null,
            costSource: "INVENTORY_SYNC_UNIT_COST",
          };
        }),
      });

      const variantUpdateResult =
        await updateVariantsFromInventoryItemSnapshots({
          supabase,
          shop,
          inventoryItemIds: inventoryItems.map(
            (inventoryItem) => inventoryItem.id,
          ),
        });

      totalVariantsUnitCostUpdated += variantUpdateResult.variantsUpdated;
      totalOrderLinesCogsRecomputed += await recomputeOrderLineCogsForVariants({
        supabase,
        shop,
        variantRows: variantUpdateResult.affectedVariantRows,
      });

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

export async function syncInventoryBatch({
  admin,
  shop,
  supabase,
  progress,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  progress?: InventorySyncBatchProgress | null;
}): Promise<SyncBatchResult> {
  const offset = Math.max(0, Number(progress?.offset ?? 0));
  const { data: variantRows, error: variantsError } = await supabase
    .from("variants")
    .select("shopify_variant_id, shopify_product_id, inventory_item_id, sku")
    .eq("shop_domain", shop)
    .not("inventory_item_id", "is", null)
    .order("inventory_item_id", { ascending: true })
    .range(offset, offset + INVENTORY_BATCH_SIZE - 1);

  if (variantsError) {
    throw new Error(variantsError.message);
  }

  const variants = (variantRows ?? []) as VariantDbRow[];

  if (variants.length === 0) {
    return {
      done: true,
      progress: { offset },
      counts: {
        inventoryItemsProcessed: 0,
        inventoryLevelsSynced: 0,
        variantsUnitCostUpdated: 0,
        orderLinesCogsRecomputed: 0,
      },
    };
  }

  const variantByInventoryItemId = new Map<string, VariantDbRow>();

  for (const variant of variants) {
    variantByInventoryItemId.set(variant.inventory_item_id, variant);
  }

  const inventoryItemIds = Array.from(
    new Set(variants.map((variant) => variant.inventory_item_id)),
  );
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getInventoryItemsForSyncBatch($ids: [ID!]!) {
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
    queryName: "getInventoryItemsForSyncBatch",
    variables: {
      ids: inventoryItemIds,
    },
  });
  const inventoryItems: InventoryItemNode[] = (
    (data.data as { nodes?: unknown[] } | undefined)?.nodes ?? []
  ).filter(Boolean) as InventoryItemNode[];

  await upsertInventoryItemSnapshots({
    supabase,
    shop,
    snapshots: inventoryItems.map((inventoryItem) => {
      const unitCost = parseNullableNumericAmount(inventoryItem.unitCost?.amount);

      return {
        inventoryItemId: inventoryItem.id,
        sku: inventoryItem.sku ?? null,
        tracked: inventoryItem.tracked,
        unitCost,
        hasUnitCostValue: unitCost !== null,
        costSource: "INVENTORY_SYNC_UNIT_COST",
      };
    }),
  });

  const variantUpdateResult = await updateVariantsFromInventoryItemSnapshots({
    supabase,
    shop,
    inventoryItemIds: inventoryItems.map((inventoryItem) => inventoryItem.id),
  });
  const orderLinesCogsRecomputed = await recomputeOrderLineCogsForVariants({
    supabase,
    shop,
    variantRows: variantUpdateResult.affectedVariantRows,
  });
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

  await upsertInBatches({
    supabase,
    table: "inventory_levels",
    rows,
    onConflict: "shop_domain,shopify_location_id,inventory_item_id",
  });

  return {
    done: variants.length < INVENTORY_BATCH_SIZE,
    progress: {
      offset: offset + variants.length,
    },
    counts: {
      inventoryItemsProcessed: inventoryItems.length,
      inventoryLevelsSynced: rows.length,
      variantsUnitCostUpdated: variantUpdateResult.variantsUpdated,
      orderLinesCogsRecomputed,
    },
  };
}

export async function syncInventoryItems({
  admin,
  shop,
  supabase,
  source,
  inventoryItemIds,
  inventoryItemUpdates,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  inventoryItemIds: string[];
  inventoryItemUpdates?: InventoryItemCostWebhookUpdate[];
}) {
  const startedAt = new Date().toISOString();

  try {
    const normalizedInventoryItemUpdates = (inventoryItemUpdates ?? []).map(
      (update) => ({
        ...update,
        inventoryItemId: normalizeInventoryItemId(update.inventoryItemId),
      }),
    );
    const normalizedInventoryItemIds = Array.from(
      new Set(
        [
          ...inventoryItemIds
            .map((inventoryItemId) => inventoryItemId.trim())
            .filter(Boolean),
          ...normalizedInventoryItemUpdates.map(
            (update) => update.inventoryItemId,
          ),
        ].map(normalizeInventoryItemId),
      ),
    );
    const webhookUpdateByInventoryItemId = new Map(
      normalizedInventoryItemUpdates.map((update) => [
        update.inventoryItemId,
        update,
      ]),
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
      const fetchedInventoryItemIds = new Set(
        inventoryItems.map((inventoryItem) => inventoryItem.id),
      );
      const snapshots: InventoryItemSnapshotInput[] = inventoryItems.map(
        (inventoryItem) => {
          const webhookUpdate = webhookUpdateByInventoryItemId.get(
            inventoryItem.id,
          );
          const graphUnitCost = parseNullableNumericAmount(
            inventoryItem.unitCost?.amount,
          );
          const hasGraphUnitCost = graphUnitCost !== null;
          const hasUnitCostValue =
            webhookUpdate?.hasExplicitUnitCost === true || hasGraphUnitCost;

          return {
            inventoryItemId: inventoryItem.id,
            sku: webhookUpdate?.sku ?? inventoryItem.sku ?? null,
            tracked: webhookUpdate?.tracked ?? inventoryItem.tracked,
            unitCost:
              webhookUpdate?.hasExplicitUnitCost === true
                ? webhookUpdate.unitCost
                : graphUnitCost,
            hasUnitCostValue,
            costSource:
              webhookUpdate?.hasExplicitUnitCost === true
                ? "WEBHOOK_PAYLOAD_COST"
                : "INVENTORY_ITEM_SYNC_UNIT_COST",
          };
        },
      );

      for (const webhookUpdate of normalizedInventoryItemUpdates) {
        if (fetchedInventoryItemIds.has(webhookUpdate.inventoryItemId)) {
          continue;
        }

        snapshots.push({
          inventoryItemId: webhookUpdate.inventoryItemId,
          sku: webhookUpdate.sku ?? null,
          tracked: webhookUpdate.tracked ?? null,
          unitCost: webhookUpdate.unitCost,
          hasUnitCostValue: webhookUpdate.hasExplicitUnitCost,
          costSource: "WEBHOOK_PAYLOAD_COST",
        });
      }

      await upsertInventoryItemSnapshots({
        supabase,
        shop,
        snapshots,
      });

      const variantUpdateResult =
        await updateVariantsFromInventoryItemSnapshots({
          supabase,
          shop,
          inventoryItemIds: snapshots.map(
            (snapshot) => snapshot.inventoryItemId,
          ),
        });

      totalVariantsUnitCostUpdated += variantUpdateResult.variantsUpdated;

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
      totalOrderLinesCogsRecomputed += await recomputeOrderLineCogsForVariants({
        supabase,
        shop,
        variantRows: variantUpdateResult.affectedVariantRows,
      });
    }

    const matchedInventoryItemIds = new Set(
      variants.map((variant) => variant.inventory_item_id),
    );
    const result = {
      inventoryItemsProcessed: totalInventoryItemsProcessed,
      inventoryLevelsSynced: totalInventoryLevelsSynced,
      variantsUnitCostUpdated: totalVariantsUnitCostUpdated,
      orderLinesCogsRecomputed: totalOrderLinesCogsRecomputed,
      requestedInventoryItemIds: normalizedInventoryItemIds,
      webhookPayloadCostExplicit: normalizedInventoryItemUpdates.some(
        (update) => update.hasExplicitUnitCost,
      ),
      inventoryItemsWithoutVariantMatch: normalizedInventoryItemIds.filter(
        (inventoryItemId) => !matchedInventoryItemIds.has(inventoryItemId),
      ).length,
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

export async function syncStaffMembers({
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
  let cursor: string | null = null;
  let hasNextPage = true;
  let syncedCount = 0;

  try {
    while (hasNextPage) {
      const response = await admin.graphql(
        `#graphql
          query StaffMembers($first: Int!, $after: String) {
            staffMembers(first: $first, after: $after) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  id
                  name
                  email
                  firstName
                  lastName
                  active
                  isShopOwner
                }
              }
            }
          }
        `,
        {
          variables: {
            first: 100,
            after: cursor,
          },
        },
      );

      const data = await response.json();
      const graphqlErrorMessage = getGraphqlErrorMessage(data);

      if (graphqlErrorMessage) {
        throw new Error(graphqlErrorMessage);
      }

      const connection = data.data?.staffMembers;
      const staffMembers: StaffMemberNode[] =
        connection?.edges?.map(
          (edge: { node: StaffMemberNode }) => edge.node,
        ) ?? [];
      const now = new Date().toISOString();
      const rows = staffMembers.map((staffMember) => ({
        shop_domain: shop,
        shopify_staff_id: normalizeStaffId(staffMember.id) ?? staffMember.id,
        email: staffMember.email ?? null,
        name: staffMember.name ?? null,
        first_name: staffMember.firstName ?? null,
        last_name: staffMember.lastName ?? null,
        is_active: staffMember.active ?? null,
        is_owner: staffMember.isShopOwner ?? null,
        updated_at: now,
      }));

      await upsertInBatches({
        supabase,
        table: "staff_members",
        rows,
        onConflict: "shop_domain,shopify_staff_id",
      });

      syncedCount += rows.length;
      hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
      cursor = connection?.pageInfo?.endCursor ?? null;

      if (rows.length === 0) {
        break;
      }
    }

    const result = {
      ok: true,
      syncedCount,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "staff_members",
      status: "success",
      source,
      startedAt,
      details: result,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const result = {
      ok: false,
      syncedCount,
      error: errorMessage,
    };

    await insertSyncRun({
      supabase,
      shop,
      syncType: "staff_members",
      status: "error",
      source,
      startedAt,
      errorMessage,
      details: result,
    });

    return result;
  }
}

async function getVariantCostMaps({
  supabase,
  shop,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
}) {
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

  return {
    costByVariantId,
    costBySku,
  };
}

async function syncOrdersPage({
  admin,
  shop,
  supabase,
  cursor,
  orderQuery,
  includeStaffAttribution,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  cursor?: string | null;
  orderQuery: string;
  includeStaffAttribution: boolean;
}) {
  const { costByVariantId, costBySku } = await getVariantCostMaps({
    supabase,
    shop,
  });
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getOrdersForSyncBatch($cursor: String, $query: String) {
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
              ${
                includeStaffAttribution
                  ? `
              staffMember {
                id
                name
                email
              }
              transactions(first: 10) {
                id
                kind
                status
                user {
                  id
                  name
                  email
                }
              }
              `
                  : ""
              }
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
                    ${
                      includeStaffAttribution
                        ? `
                    staffMember {
                      id
                      name
                      email
                    }
                    `
                        : ""
                    }
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
    queryName: "getOrdersForSyncBatch",
    variables: {
      cursor: cursor ?? null,
      query: orderQuery || null,
    },
  });
  const ordersConnection = (
    data.data as
      | {
          orders?: {
            pageInfo?: {
              hasNextPage: boolean;
              endCursor?: string | null;
            };
            edges?: Array<{ node: OrderNode }>;
          };
        }
      | undefined
  )?.orders;
  const orders: OrderNode[] =
    ordersConnection?.edges?.map((edge) => edge.node) ?? [];
  const orderRows = orders.map((order) => {
    const orderStaff = includeStaffAttribution
      ? getOrderStaffAttribution(order)
      : getStaffAttribution(null);

    return {
      shop_domain: shop,
      shopify_order_id: order.id,
      order_name: order.name,
      created_at_shopify: order.createdAt,
      financial_status: order.displayFinancialStatus ?? null,
      retail_location_id: order.retailLocation?.id ?? null,
      retail_location_name: order.retailLocation?.name ?? null,
      total_price: getNumericAmount(order.totalPriceSet?.shopMoney?.amount),
      staff_member_id: orderStaff.staffMemberId,
      staff_member_name: orderStaff.staffMemberName,
      staff_member_email: orderStaff.staffMemberEmail,
      staff_source: orderStaff.staffSource,
      updated_at: new Date().toISOString(),
    };
  });
  const orderLineRows: Record<string, unknown>[] = [];

  for (const order of orders) {
    const orderStaff = includeStaffAttribution
      ? getOrderStaffAttribution(order)
      : getStaffAttribution(null);
    const allLineItems = await getAllLineItemsForOrder({
      admin,
      order,
      includeStaffAttribution,
    });

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
      const lineStaff = includeStaffAttribution
        ? getStaffAttribution(lineItem.staffMember, "line_item_staff")
        : getStaffAttribution(null);
      const staffAttribution = lineStaff.staffMemberId ? lineStaff : orderStaff;

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
        staff_member_id: staffAttribution.staffMemberId,
        staff_member_name: staffAttribution.staffMemberName,
        staff_member_email: staffAttribution.staffMemberEmail,
        staff_source: staffAttribution.staffSource,
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

  return {
    ordersSynced: orderRows.length,
    orderLinesSynced: orderLineRows.length,
    hasNextPage: Boolean(ordersConnection?.pageInfo?.hasNextPage),
    cursor: ordersConnection?.pageInfo?.endCursor ?? null,
  };
}

export async function syncOrdersBatch({
  admin,
  shop,
  supabase,
  progress,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  progress?: OrdersSyncBatchProgress | null;
}): Promise<SyncBatchResult> {
  const dateRange =
    progress?.startDate || progress?.endDate
      ? {
          startDate: progress.startDate ?? null,
          endDate: progress.endDate ?? null,
        }
      : getIncrementalOrderDateRange();
  const orderQuery = buildOrderQuery(dateRange);
  const cursor = progress?.cursor ?? null;
  let staffAttributionAvailable =
    progress?.staffAttributionAvailable !== false;
  let staffAttributionError: string | null = null;
  let pageResult: Awaited<ReturnType<typeof syncOrdersPage>>;

  try {
    pageResult = await syncOrdersPage({
      admin,
      shop,
      supabase,
      cursor,
      orderQuery,
      includeStaffAttribution: staffAttributionAvailable,
    });
  } catch (error) {
    if (!staffAttributionAvailable) {
      throw error;
    }

    staffAttributionAvailable = false;
    staffAttributionError = error instanceof Error ? error.message : String(error);
    pageResult = await syncOrdersPage({
      admin,
      shop,
      supabase,
      cursor,
      orderQuery,
      includeStaffAttribution: false,
    });
  }

  return {
    done: !pageResult.hasNextPage || pageResult.ordersSynced === 0,
    progress: {
      cursor: pageResult.hasNextPage ? pageResult.cursor : null,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      staffAttributionAvailable,
    },
    counts: {
      ordersSynced: pageResult.ordersSynced,
      orderLinesSynced: pageResult.orderLinesSynced,
      pagesProcessed: pageResult.ordersSynced > 0 ? 1 : 0,
      staffAttributionAvailable,
      staffAttributionError,
    },
  };
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

    async function runOrdersSync(includeStaffAttribution: boolean) {
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
                    ${
                      includeStaffAttribution
                        ? `
                    staffMember {
                      id
                      name
                      email
                    }
                    transactions(first: 10) {
                      id
                      kind
                      status
                      user {
                        id
                        name
                        email
                      }
                    }
                    `
                        : ""
                    }
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
                          ${
                            includeStaffAttribution
                              ? `
                          staffMember {
                            id
                            name
                            email
                          }
                          `
                              : ""
                          }
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
        const graphqlErrorMessage = getGraphqlErrorMessage(data);

        if (graphqlErrorMessage) {
          throw new Error(graphqlErrorMessage);
        }

        const ordersConnection = data.data?.orders;
        const orders: OrderNode[] =
          ordersConnection?.edges?.map(
            (edge: { node: OrderNode }) => edge.node,
          ) ?? [];

        const orderRows = orders.map((order) => {
          const orderStaff = includeStaffAttribution
            ? getOrderStaffAttribution(order)
            : getStaffAttribution(null);

          return {
            shop_domain: shop,
            shopify_order_id: order.id,
            order_name: order.name,
            created_at_shopify: order.createdAt,
            financial_status: order.displayFinancialStatus ?? null,
            retail_location_id: order.retailLocation?.id ?? null,
            retail_location_name: order.retailLocation?.name ?? null,
            total_price: getNumericAmount(
              order.totalPriceSet?.shopMoney?.amount,
            ),
            staff_member_id: orderStaff.staffMemberId,
            staff_member_name: orderStaff.staffMemberName,
            staff_member_email: orderStaff.staffMemberEmail,
            staff_source: orderStaff.staffSource,
            updated_at: new Date().toISOString(),
          };
        });

        const orderLineRows: Record<string, unknown>[] = [];

        for (const order of orders) {
          const orderStaff = includeStaffAttribution
            ? getOrderStaffAttribution(order)
            : getStaffAttribution(null);
          const allLineItems = await getAllLineItemsForOrder({
            admin,
            order,
            includeStaffAttribution,
          });

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

            const lineStaff = includeStaffAttribution
              ? getStaffAttribution(lineItem.staffMember, "line_item_staff")
              : getStaffAttribution(null);
            const staffAttribution = lineStaff.staffMemberId
              ? lineStaff
              : orderStaff;

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
              staff_member_id: staffAttribution.staffMemberId,
              staff_member_name: staffAttribution.staffMemberName,
              staff_member_email: staffAttribution.staffMemberEmail,
              staff_source: staffAttribution.staffSource,
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

        hasNextPage = Boolean(ordersConnection?.pageInfo?.hasNextPage);
        cursor = ordersConnection?.pageInfo?.endCursor ?? null;

        if (orders.length === 0) {
          break;
        }
      }

      return {
        ordersSynced: totalOrdersSynced,
        orderLinesSynced: totalOrderLinesSynced,
        pagesProcessed,
      };
    }

    let staffAttributionAvailable = true;
    let staffAttributionError: string | null = null;
    let syncResult: {
      ordersSynced: number;
      orderLinesSynced: number;
      pagesProcessed: number;
    };

    try {
      syncResult = await runOrdersSync(true);
    } catch (error) {
      staffAttributionAvailable = false;
      staffAttributionError =
        error instanceof Error ? error.message : String(error);
      syncResult = await runOrdersSync(false);
    }

    const result = {
      ...syncResult,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      staffAttributionAvailable,
      staffAttributionError,
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

    const { startDate, endDate } =
      getIncrementalOrderDateRange(orderLookbackDays);

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
