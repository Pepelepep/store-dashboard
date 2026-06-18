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

type SyncLogger = (message: string) => void;

type SyncTimingDetails = {
  shopifyFetchMs?: number;
  bulkPollMs?: number;
  bulkDownloadMs?: number;
  dbUpsertMs?: number;
  cogsRecomputeMs?: number;
  totalMs: number;
};

type ShopifyBulkOperation = {
  id: string;
  status: string;
  errorCode?: string | null;
  url?: string | null;
  partialDataUrl?: string | null;
  objectCount?: string | null;
  fileSize?: string | null;
};

type ShopifyBulkOperationResult = {
  id: string;
  url: string;
  objectCount: number;
  fileSize: number | null;
  pollDurationMs: number;
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

type MoneySet = {
  shopMoney?: {
    amount?: string | null;
    currencyCode?: string | null;
  } | null;
};

type ShopifyConnection<T> = {
  pageInfo?: {
    hasNextPage: boolean;
    endCursor?: string | null;
  } | null;
  edges?: Array<{ node: T }>;
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
  originalUnitPriceSet?: MoneySet | null;
  discountedUnitPriceSet?: MoneySet | null;
  discountedTotalSet?: MoneySet | null;
  totalDiscountSet?: MoneySet | null;
  taxLines?: Array<{
    priceSet?: MoneySet | null;
  }> | null;
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
  gateway?: string | null;
  processedAt?: string | null;
  amountSet?: MoneySet | null;
  parentTransaction?: {
    id: string;
  } | null;
  user?: StaffMemberAttributionNode | null;
};

type RefundLineItemNode = {
  quantity: number;
  subtotalSet?: MoneySet | null;
  lineItem?: {
    id: string;
  } | null;
};

type RefundNode = {
  id: string;
  createdAt?: string | null;
  totalRefundedSet?: MoneySet | null;
  refundLineItems?: ShopifyConnection<RefundLineItemNode> | null;
  transactions?: ShopifyConnection<OrderTransactionNode> | null;
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
  updatedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  currencyCode?: string | null;
  displayFinancialStatus?: string | null;
  staffMember?: StaffMemberAttributionNode | null;
  transactions?: ShopifyConnection<OrderTransactionNode> | null;
  refunds?: ShopifyConnection<RefundNode> | null;
  subtotalPriceSet?: MoneySet | null;
  currentSubtotalPriceSet?: MoneySet | null;
  totalDiscountsSet?: MoneySet | null;
  currentTotalDiscountsSet?: MoneySet | null;
  totalTaxSet?: MoneySet | null;
  currentTotalTaxSet?: MoneySet | null;
  totalShippingPriceSet?: MoneySet | null;
  currentShippingPriceSet?: MoneySet | null;
  totalPriceSet?: MoneySet | null;
  currentTotalPriceSet?: MoneySet | null;
  totalRefundedSet?: MoneySet | null;
  retailLocation?: {
    id: string;
    name: string;
  } | null;
  lineItems: ShopifyConnection<OrderLineItemNode>;
};

type ExistingOrderLineCostAtSaleRow = {
  shopify_line_item_id: string;
  cost_at_sale: number | null;
  cost_at_sale_source: string | null;
  cost_at_sale_captured_at: string | null;
};

export type SyncSource =
  | "manual_admin_sync"
  | "local_manual_refresh"
  | "webhook"
  | "cron";

const INVENTORY_BATCH_SIZE = 25;
const SUPABASE_LOOKUP_BATCH_SIZE = 250;
const PRODUCT_SYNC_PAGE_SIZE = 20;
const PRODUCT_VARIANT_SYNC_PAGE_SIZE = 50;
const ORDERS_PAGE_SIZE = 50;
const LINE_ITEMS_PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 500;
const MAX_TRANSACTION_PAGES = 10;
const MAX_REFUND_PAGES = 10;
const MAX_REFUND_LINE_ITEM_PAGES = 20;

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

export type OrdersReconciliation48hBatchProgress = {
  cursor?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
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

function getShopMoneyAmount(moneySet?: MoneySet | null) {
  return getNumericAmount(moneySet?.shopMoney?.amount);
}

function getShopMoneyCurrency(moneySet?: MoneySet | null) {
  return moneySet?.shopMoney?.currencyCode ?? null;
}

function getConnectionNodes<T>(connection?: ShopifyConnection<T> | null) {
  return connection?.edges?.map((edge) => edge.node) ?? [];
}

function hasNextPage<T>(connection?: ShopifyConnection<T> | null) {
  return Boolean(connection?.pageInfo?.hasNextPage);
}

function getEndCursor<T>(connection?: ShopifyConnection<T> | null) {
  return connection?.pageInfo?.endCursor ?? null;
}

function getFinancialQueryLineItemFields(includeStaffAttribution: boolean) {
  return `
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
    originalUnitPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    discountedUnitPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    discountedTotalSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    totalDiscountSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    taxLines {
      priceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
  `;
}

function getFinancialQueryTransactionFields(includeUser = false) {
  return `
    id
    kind
    status
    gateway
    processedAt
    amountSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    parentTransaction {
      id
    }
    ${
      includeUser
        ? `
    user {
      id
      name
      email
    }
    `
        : ""
    }
  `;
}

function getFinancialQueryRefundFields() {
  return `
    id
    createdAt
    totalRefundedSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    refundLineItems(first: 100) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          quantity
          subtotalSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          lineItem {
            id
          }
        }
      }
    }
    transactions(first: 50) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          ${getFinancialQueryTransactionFields()}
        }
      }
    }
  `;
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
  transactions?: ShopifyConnection<OrderTransactionNode> | null,
): StaffAttribution {
  const transactionUser = getConnectionNodes(transactions).find(
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
  dateField = "created_at",
}: {
  startDate?: string | null;
  endDate?: string | null;
  dateField?: "created_at" | "updated_at";
}) {
  const filters: string[] = [];

  if (startDate?.trim()) {
    filters.push(`${dateField}:>=${startDate.trim()}`);
  }

  if (endDate?.trim()) {
    filters.push(`${dateField}:<=${endDate.trim()}`);
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

function getLineTaxTotal(lineItem: OrderLineItemNode) {
  return (lineItem.taxLines ?? []).reduce(
    (sum, taxLine) => sum + getShopMoneyAmount(taxLine.priceSet),
    0,
  );
}

function getRefundLineItemSummaries(refunds: RefundNode[]) {
  const byLineItemId = new Map<
    string,
    {
      returnedQuantity: number;
      returns: number;
      refundedAmount: number;
    }
  >();

  for (const refund of refunds) {
    for (const refundLineItem of getConnectionNodes(refund.refundLineItems)) {
      const lineItemId = refundLineItem.lineItem?.id;

      if (!lineItemId) continue;

      const existing = byLineItemId.get(lineItemId) ?? {
        returnedQuantity: 0,
        returns: 0,
        refundedAmount: 0,
      };
      const subtotal = getShopMoneyAmount(refundLineItem.subtotalSet);

      existing.returnedQuantity += Number(refundLineItem.quantity ?? 0);
      existing.returns += subtotal;
      existing.refundedAmount += subtotal;
      byLineItemId.set(lineItemId, existing);
    }
  }

  return byLineItemId;
}

function isSuccessfulTransaction(transaction: OrderTransactionNode) {
  return transaction.status?.toUpperCase() === "SUCCESS";
}

function getTransactionsTotal(transactions: OrderTransactionNode[]) {
  return transactions.reduce((sum, transaction) => {
    if (!isSuccessfulTransaction(transaction)) return sum;

    const kind = transaction.kind?.toUpperCase();
    const amount = getShopMoneyAmount(transaction.amountSet);

    if (kind === "SALE" || kind === "CAPTURE") {
      return sum + amount;
    }

    if (kind === "REFUND") {
      return sum - amount;
    }

    return sum;
  }, 0);
}

function getOrderRefundTotal({
  order,
  transactions,
}: {
  order: OrderNode;
  transactions: OrderTransactionNode[];
}) {
  const transactionRefunds = transactions
    .filter(
      (transaction) =>
        isSuccessfulTransaction(transaction) &&
        transaction.kind?.toUpperCase() === "REFUND",
    )
    .reduce(
      (sum, transaction) => sum + getShopMoneyAmount(transaction.amountSet),
      0,
    );

  return transactionRefunds || getShopMoneyAmount(order.totalRefundedSet);
}

function getOrderCurrency(order: OrderNode) {
  return (
    order.currencyCode ??
    getShopMoneyCurrency(order.currentTotalPriceSet) ??
    getShopMoneyCurrency(order.totalPriceSet) ??
    getShopMoneyCurrency(order.currentSubtotalPriceSet) ??
    getShopMoneyCurrency(order.subtotalPriceSet)
  );
}

function getLineFinancials({
  lineItem,
  refundLineItemsByLineItemId,
}: {
  lineItem: OrderLineItemNode;
  refundLineItemsByLineItemId: Map<
    string,
    {
      returnedQuantity: number;
      returns: number;
      refundedAmount: number;
    }
  >;
}) {
  const grossSales =
    getShopMoneyAmount(lineItem.originalUnitPriceSet) *
    Number(lineItem.quantity ?? 0);
  const discountedTotal = getShopMoneyAmount(lineItem.discountedTotalSet);
  const explicitDiscounts = getShopMoneyAmount(lineItem.totalDiscountSet);
  const discounts =
    explicitDiscounts || Math.max(0, grossSales - discountedTotal);
  const refundSummary = refundLineItemsByLineItemId.get(lineItem.id) ?? {
    returnedQuantity: 0,
    returns: 0,
    refundedAmount: 0,
  };
  const returns = refundSummary.returns;
  const netSales = grossSales - discounts - returns;

  return {
    grossSales,
    discounts,
    returns,
    netSales,
    refundedAmount: refundSummary.refundedAmount || returns,
    taxes: getLineTaxTotal(lineItem),
    returnedQuantity: refundSummary.returnedQuantity,
  };
}

function getOrderFinancials({
  order,
  allLineItems,
  refunds,
  transactions,
  financialDataComplete,
  financialIncompleteReason,
  truncatedFields,
}: {
  order: OrderNode;
  allLineItems: OrderLineItemNode[];
  refunds: RefundNode[];
  transactions: OrderTransactionNode[];
  financialDataComplete: boolean;
  financialIncompleteReason: string | null;
  truncatedFields: string[];
}) {
  const refundLineItemsByLineItemId = getRefundLineItemSummaries(refunds);
  const lineFinancials = allLineItems.map((lineItem) =>
    getLineFinancials({ lineItem, refundLineItemsByLineItemId }),
  );
  const lineGrossSales = lineFinancials.reduce(
    (sum, financials) => sum + financials.grossSales,
    0,
  );
  const lineDiscounts = lineFinancials.reduce(
    (sum, financials) => sum + financials.discounts,
    0,
  );
  const returns = lineFinancials.reduce(
    (sum, financials) => sum + financials.returns,
    0,
  );
  const grossSales =
    getShopMoneyAmount(order.subtotalPriceSet) || lineGrossSales;
  const discounts =
    getShopMoneyAmount(order.totalDiscountsSet) || lineDiscounts;
  const netSales = grossSales - discounts - returns;
  const taxes = getShopMoneyAmount(order.currentTotalTaxSet);
  const shipping = getShopMoneyAmount(order.currentShippingPriceSet);

  return {
    lineFinancialsByLineItemId: new Map(
      allLineItems.map((lineItem, index) => [
        lineItem.id,
        lineFinancials[index],
      ]),
    ),
    orderFinancials: {
      currencyCode: getOrderCurrency(order),
      grossSales,
      discounts,
      returns,
      netSales,
      refunds: getOrderRefundTotal({ order, transactions }),
      taxes,
      shipping,
      totalSales: netSales + taxes + shipping,
      transactionsTotal: getTransactionsTotal(transactions),
      financialDataComplete,
      financialIncompleteReason,
      financialPayload: {
        truncated: !financialDataComplete,
        truncatedFields,
        sourceTotals: {
          subtotalPriceSet: order.subtotalPriceSet ?? null,
          currentSubtotalPriceSet: order.currentSubtotalPriceSet ?? null,
          totalDiscountsSet: order.totalDiscountsSet ?? null,
          currentTotalDiscountsSet: order.currentTotalDiscountsSet ?? null,
          totalTaxSet: order.totalTaxSet ?? null,
          currentTotalTaxSet: order.currentTotalTaxSet ?? null,
          totalShippingPriceSet: order.totalShippingPriceSet ?? null,
          currentShippingPriceSet: order.currentShippingPriceSet ?? null,
          totalPriceSet: order.totalPriceSet ?? null,
          currentTotalPriceSet: order.currentTotalPriceSet ?? null,
          totalRefundedSet: order.totalRefundedSet ?? null,
        },
        refunds,
        transactions,
      },
    },
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

function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
}

function logSync(log: SyncLogger | undefined, message: string) {
  log?.(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonResponse(response: Response) {
  const data = await response.json();
  const graphqlErrorMessage = getGraphqlErrorMessage(data);

  if (graphqlErrorMessage) {
    throw new Error(graphqlErrorMessage);
  }

  return data;
}

async function startBulkOperation({
  admin,
  query,
}: {
  admin: ShopifyAdminClient;
  query: string;
}) {
  const response = await admin.graphql(
    `#graphql
      mutation runBulkOperation($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        query,
      },
    },
  );
  const data = await parseJsonResponse(response);
  const payload = data.data?.bulkOperationRunQuery;
  const userErrors = payload?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(JSON.stringify(userErrors));
  }

  const operation = payload?.bulkOperation as
    | Pick<ShopifyBulkOperation, "id" | "status">
    | null
    | undefined;

  if (!operation?.id) {
    throw new Error("Shopify did not return a bulk operation id.");
  }

  return operation.id;
}

async function getCurrentBulkOperation(admin: ShopifyAdminClient) {
  const response = await admin.graphql(`#graphql
    query currentBulkOperation {
      currentBulkOperation {
        id
        status
        errorCode
        url
        partialDataUrl
        objectCount
        fileSize
      }
    }
  `);
  const data = await parseJsonResponse(response);

  return data.data?.currentBulkOperation as ShopifyBulkOperation | null;
}

async function runBulkOperation({
  admin,
  query,
  log,
}: {
  admin: ShopifyAdminClient;
  query: string;
  log?: SyncLogger;
}): Promise<ShopifyBulkOperationResult> {
  const startedAt = Date.now();
  const operationId = await startBulkOperation({ admin, query });

  logSync(log, `bulk operation started: ${operationId}`);

  for (;;) {
    await sleep(3000);

    const operation = await getCurrentBulkOperation(admin);

    if (!operation || operation.id !== operationId) {
      logSync(log, "waiting for Shopify current bulk operation to update");
      continue;
    }

    logSync(
      log,
      `bulk operation status: ${operation.status}, objects: ${operation.objectCount ?? "0"}`,
    );

    if (operation.status === "COMPLETED") {
      if (!operation.url) {
        throw new Error(
          `Bulk operation ${operationId} completed without a URL.`,
        );
      }

      return {
        id: operationId,
        url: operation.url,
        objectCount: Number(operation.objectCount ?? 0),
        fileSize: operation.fileSize ? Number(operation.fileSize) : null,
        pollDurationMs: getDurationMs(startedAt),
      };
    }

    if (
      ["FAILED", "CANCELED", "EXPIRED"].includes(operation.status.toUpperCase())
    ) {
      throw new Error(
        `Bulk operation ${operationId} ended with ${operation.status}: ${
          operation.errorCode ?? "unknown_error"
        }`,
      );
    }
  }
}

async function streamJsonlFromUrl({
  url,
  onRow,
}: {
  url: string;
  onRow: (row: Record<string, unknown>) => void;
}) {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download bulk result: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed) {
        onRow(JSON.parse(trimmed) as Record<string, unknown>);
      }
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    onRow(JSON.parse(buffer.trim()) as Record<string, unknown>);
  }
}

async function selectRowsInBatches<Row>({
  supabase,
  table,
  select,
  shop,
  column,
  values,
}: {
  supabase: SupabaseAdminClient;
  table: string;
  select: string;
  shop: string;
  column: string;
  values: string[];
}) {
  const rows: Row[] = [];
  const uniqueValues = Array.from(new Set(values)).filter(Boolean);

  for (const batch of chunkArray(uniqueValues, SUPABASE_LOOKUP_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq("shop_domain", shop)
      .in(column, batch);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data ?? []) as Row[]));
  }

  return rows;
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

  const existingRows = await selectRowsInBatches<InventoryItemSnapshotRow>({
    supabase,
    table: "inventory_items",
    select: "inventory_item_id, sku, tracked, unit_cost",
    shop,
    column: "inventory_item_id",
    values: normalizedSnapshots.map((snapshot) => snapshot.inventoryItemId),
  });

  const existingById = new Map(
    existingRows.map((row) => [row.inventory_item_id, row]),
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

  const data = await selectRowsInBatches<{
    shopify_variant_id: string;
    unit_cost: number | null;
  }>({
    supabase,
    table: "variants",
    select: "shopify_variant_id, unit_cost",
    shop,
    column: "shopify_variant_id",
    values: uniqueVariantIds,
  });

  return new Map(data.map((row) => [row.shopify_variant_id, row.unit_cost]));
}

async function recomputeOrderLineCogsForShop({
  supabase,
  shop,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
}) {
  const { data, error } = await supabase.rpc(
    "recompute_order_line_cogs_for_shop",
    {
      p_shop_domain: shop,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return typeof data === "number" ? data : Number(data ?? 0);
}

async function recomputeOrderLineCogsForVariantsSql({
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
    return 0;
  }

  let recomputedCount = 0;

  for (const batch of chunkArray(
    uniqueVariantIds,
    SUPABASE_LOOKUP_BATCH_SIZE,
  )) {
    const { data, error } = await supabase.rpc(
      "recompute_order_line_cogs_for_variants",
      {
        p_shop_domain: shop,
        p_variant_ids: batch,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    recomputedCount += typeof data === "number" ? data : Number(data ?? 0);
  }

  return recomputedCount;
}

async function recomputeOrderLineCogsForInventoryItemsSql({
  supabase,
  shop,
  inventoryItemIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  inventoryItemIds: string[];
}) {
  const uniqueInventoryItemIds = Array.from(
    new Set(inventoryItemIds.map(normalizeInventoryItemId)),
  ).filter(Boolean);

  if (uniqueInventoryItemIds.length === 0) {
    return 0;
  }

  let recomputedCount = 0;

  for (const batch of chunkArray(
    uniqueInventoryItemIds,
    SUPABASE_LOOKUP_BATCH_SIZE,
  )) {
    const { data, error } = await supabase.rpc(
      "recompute_order_line_cogs_for_inventory_items",
      {
        p_shop_domain: shop,
        p_inventory_item_ids: batch,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    recomputedCount += typeof data === "number" ? data : Number(data ?? 0);
  }

  return recomputedCount;
}

async function updateVariantCostsFromInventoryItemsForShop({
  supabase,
  shop,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
}) {
  const { data, error } = await supabase.rpc(
    "update_variant_costs_from_inventory_items_for_shop",
    {
      p_shop_domain: shop,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return typeof data === "number" ? data : Number(data ?? 0);
}

async function updateVariantCostsFromInventoryItemsSql({
  supabase,
  shop,
  inventoryItemIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  inventoryItemIds: string[];
}) {
  const uniqueInventoryItemIds = Array.from(
    new Set(inventoryItemIds.map(normalizeInventoryItemId)),
  ).filter(Boolean);

  if (uniqueInventoryItemIds.length === 0) {
    return 0;
  }

  let updatedCount = 0;

  for (const batch of chunkArray(
    uniqueInventoryItemIds,
    SUPABASE_LOOKUP_BATCH_SIZE,
  )) {
    const { data, error } = await supabase.rpc(
      "update_variant_costs_from_inventory_items",
      {
        p_shop_domain: shop,
        p_inventory_item_ids: batch,
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    updatedCount += typeof data === "number" ? data : Number(data ?? 0);
  }

  return updatedCount;
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

  const variantsWithUnitCostSynced = variantRows.filter(
    (variant) => variant.unit_cost !== null,
  ).length;

  return {
    productsSynced: productRows.length,
    variantsSynced: variantRows.length,
    variantsWithUnitCostSynced,
    variantsWithMissingUnitCost:
      variantRows.length - variantsWithUnitCostSynced,
    orderLinesCogsRecomputed: 0,
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

  const hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
  const isDone = !hasNextPage || pageProducts.length === 0;
  const counts = {
    ...(await syncProductNodes({ supabase, shop, products })),
    orderLinesCogsRecomputed: isDone
      ? await recomputeOrderLineCogsForShop({ supabase, shop })
      : 0,
  };

  return {
    done: isDone,
    progress: {
      cursor: hasNextPage ? (connection?.pageInfo?.endCursor ?? null) : null,
    },
    counts,
  };
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
  const allLineItems = [
    ...(order.lineItems.edges?.map((edge) => edge.node) ?? []),
  ];

  let cursor = getEndCursor(order.lineItems);
  let lineItemsHasNextPage = hasNextPage(order.lineItems);

  while (lineItemsHasNextPage && cursor) {
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
                    ${getFinancialQueryLineItemFields(includeStaffAttribution)}
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

    lineItemsHasNextPage = Boolean(lineItems.pageInfo?.hasNextPage);
    cursor = lineItems.pageInfo?.endCursor ?? null;
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

    const orderLinesCogsRecomputed = await recomputeOrderLineCogsForShop({
      supabase,
      shop,
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

export async function syncProductsBulk({
  admin,
  shop,
  supabase,
  source,
  log,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  log?: SyncLogger;
}) {
  const startedAt = new Date().toISOString();
  const totalStartedAt = Date.now();
  let bulkOperationId: string | null = null;

  try {
    const bulkOperation = await runBulkOperation({
      admin,
      log,
      query: `{
        products {
          edges {
            node {
              id
              title
              vendor
              productType
              status
              variants {
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
      }`,
    });
    bulkOperationId = bulkOperation.id;

    const productsById = new Map<string, ProductNode>();
    const variantEdgesByProductId = new Map<
      string,
      ProductNode["variants"]["edges"]
    >();
    const downloadStartedAt = Date.now();

    logSync(log, `downloading products bulk result: ${bulkOperation.id}`);
    await streamJsonlFromUrl({
      url: bulkOperation.url,
      onRow: (row) => {
        const id = typeof row.id === "string" ? row.id : null;
        const parentId =
          typeof row.__parentId === "string" ? row.__parentId : null;

        if (!id) {
          return;
        }

        if (!parentId) {
          productsById.set(id, {
            id,
            title: typeof row.title === "string" ? row.title : "",
            vendor: typeof row.vendor === "string" ? row.vendor : null,
            productType:
              typeof row.productType === "string" ? row.productType : null,
            status: typeof row.status === "string" ? row.status : null,
            variants: {
              edges: [],
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
            },
          });
          return;
        }

        const inventoryItem = row.inventoryItem as
          | {
              id?: string;
              unitCost?: { amount?: string; currencyCode?: string } | null;
            }
          | null
          | undefined;
        const edges = variantEdgesByProductId.get(parentId) ?? [];

        edges.push({
          node: {
            id,
            title: typeof row.title === "string" ? row.title : "",
            sku: typeof row.sku === "string" ? row.sku : null,
            price:
              typeof row.price === "string" || typeof row.price === "number"
                ? String(row.price)
                : null,
            inventoryItem: inventoryItem?.id
              ? {
                  id: inventoryItem.id,
                  unitCost: inventoryItem.unitCost?.amount
                    ? {
                        amount: inventoryItem.unitCost.amount,
                        currencyCode:
                          inventoryItem.unitCost.currencyCode ?? "CAD",
                      }
                    : null,
                }
              : null,
          },
        });
        variantEdgesByProductId.set(parentId, edges);
      },
    });

    for (const [productId, edges] of variantEdgesByProductId.entries()) {
      const product = productsById.get(productId);

      if (product) {
        product.variants.edges = edges;
      }
    }

    const dbStartedAt = Date.now();
    const counts = await syncProductNodes({
      supabase,
      shop,
      products: Array.from(productsById.values()),
    });
    const dbUpsertMs = getDurationMs(dbStartedAt);

    const cogsStartedAt = Date.now();
    const orderLinesCogsRecomputed = await recomputeOrderLineCogsForShop({
      supabase,
      shop,
    });
    const cogsRecomputeMs = getDurationMs(cogsStartedAt);

    const timings: SyncTimingDetails = {
      bulkPollMs: bulkOperation.pollDurationMs,
      bulkDownloadMs: getDurationMs(downloadStartedAt),
      dbUpsertMs,
      cogsRecomputeMs,
      totalMs: getDurationMs(totalStartedAt),
    };
    const result = {
      ...counts,
      orderLinesCogsRecomputed,
      bulkOperationId: bulkOperation.id,
      bulkObjectCount: bulkOperation.objectCount,
      bulkFileSize: bulkOperation.fileSize,
      duration: timings,
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
      details: {
        bulkOperationId,
        duration: {
          totalMs: getDurationMs(totalStartedAt),
        },
      },
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
  const totalStartedAt = Date.now();

  try {
    const shopifyStartedAt = Date.now();
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
    const shopifyFetchMs = getDurationMs(shopifyStartedAt);
    const dbStartedAt = Date.now();

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
    const dbUpsertMs = getDurationMs(dbStartedAt);

    const cogsStartedAt = Date.now();
    const orderLinesCogsRecomputed = await recomputeOrderLineCogsForVariantsSql(
      {
        supabase,
        shop,
        variantIds: variantRows.map((variant) => variant.shopify_variant_id),
      },
    );
    const cogsRecomputeMs = getDurationMs(cogsStartedAt);
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
      duration: {
        shopifyFetchMs,
        dbUpsertMs,
        cogsRecomputeMs,
        totalMs: getDurationMs(totalStartedAt),
      },
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
      details: {
        duration: {
          totalMs: getDurationMs(totalStartedAt),
        },
      },
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

    totalVariantsUnitCostUpdated =
      await updateVariantCostsFromInventoryItemsForShop({
        supabase,
        shop,
      });
    totalOrderLinesCogsRecomputed = await recomputeOrderLineCogsForShop({
      supabase,
      shop,
    });

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

  const variantsUnitCostUpdated = await updateVariantCostsFromInventoryItemsSql(
    {
      supabase,
      shop,
      inventoryItemIds: inventoryItems.map((inventoryItem) => inventoryItem.id),
    },
  );
  const isDone = variants.length < INVENTORY_BATCH_SIZE;
  const orderLinesCogsRecomputed = isDone
    ? await recomputeOrderLineCogsForShop({ supabase, shop })
    : 0;
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
    done: isDone,
    progress: {
      offset: offset + variants.length,
    },
    counts: {
      inventoryItemsProcessed: inventoryItems.length,
      inventoryLevelsSynced: rows.length,
      variantsUnitCostUpdated,
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
  const totalStartedAt = Date.now();
  let shopifyFetchMs = 0;
  let dbUpsertMs = 0;
  let cogsRecomputeMs = 0;

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

    const variants = await selectRowsInBatches<VariantDbRow>({
      supabase,
      table: "variants",
      select: "shopify_variant_id, shopify_product_id, inventory_item_id, sku",
      shop,
      column: "inventory_item_id",
      values: normalizedInventoryItemIds,
    });
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
      const shopifyStartedAt = Date.now();
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
      shopifyFetchMs += getDurationMs(shopifyStartedAt);
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

      const dbStartedAt = Date.now();
      await upsertInventoryItemSnapshots({
        supabase,
        shop,
        snapshots,
      });

      totalVariantsUnitCostUpdated +=
        await updateVariantCostsFromInventoryItemsSql({
          supabase,
          shop,
          inventoryItemIds: snapshots.map(
            (snapshot) => snapshot.inventoryItemId,
          ),
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
      dbUpsertMs += getDurationMs(dbStartedAt);

      totalInventoryItemsProcessed += inventoryItems.length;
      totalInventoryLevelsSynced += rows.length;
      const cogsStartedAt = Date.now();
      totalOrderLinesCogsRecomputed +=
        await recomputeOrderLineCogsForInventoryItemsSql({
          supabase,
          shop,
          inventoryItemIds: snapshots.map(
            (snapshot) => snapshot.inventoryItemId,
          ),
        });
      cogsRecomputeMs += getDurationMs(cogsStartedAt);
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
      duration: {
        shopifyFetchMs,
        dbUpsertMs,
        cogsRecomputeMs,
        totalMs: getDurationMs(totalStartedAt),
      },
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
      details: {
        duration: {
          shopifyFetchMs,
          dbUpsertMs,
          cogsRecomputeMs,
          totalMs: getDurationMs(totalStartedAt),
        },
      },
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

async function getExistingOrderLineCostAtSaleMap({
  supabase,
  shop,
  lineItemIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  lineItemIds: string[];
}) {
  const uniqueLineItemIds = Array.from(new Set(lineItemIds)).filter(Boolean);
  const existingCosts = new Map<string, ExistingOrderLineCostAtSaleRow>();

  for (const batch of chunkArray(
    uniqueLineItemIds,
    SUPABASE_LOOKUP_BATCH_SIZE,
  )) {
    const { data, error } = await supabase
      .from("order_lines")
      .select(
        "shopify_line_item_id, cost_at_sale, cost_at_sale_source, cost_at_sale_captured_at",
      )
      .eq("shop_domain", shop)
      .in("shopify_line_item_id", batch);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as ExistingOrderLineCostAtSaleRow[]) {
      existingCosts.set(row.shopify_line_item_id, row);
    }
  }

  return existingCosts;
}

async function upsertOrderTransactions({
  supabase,
  shop,
  orderId,
  transactions,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  orderId: string;
  transactions: OrderTransactionNode[];
}) {
  if (transactions.length === 0) return;

  await upsertInBatches({
    supabase,
    table: "order_transactions",
    rows: transactions.map((transaction) => ({
      shop_domain: shop,
      shopify_order_id: orderId,
      shopify_transaction_id: transaction.id,
      kind: transaction.kind ?? null,
      status: transaction.status ?? null,
      gateway: transaction.gateway ?? null,
      processed_at: transaction.processedAt ?? null,
      amount: getShopMoneyAmount(transaction.amountSet),
      currency_code: getShopMoneyCurrency(transaction.amountSet),
      parent_transaction_id: transaction.parentTransaction?.id ?? null,
      updated_at: new Date().toISOString(),
    })),
    onConflict: "shop_domain,shopify_transaction_id",
  });
}

async function fetchMoreOrderTransactions({
  admin,
  orderId,
  cursor,
}: {
  admin: ShopifyAdminClient;
  orderId: string;
  cursor: string | null;
}) {
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getMoreOrderTransactions($orderId: ID!, $cursor: String) {
        node(id: $orderId) {
          ... on Order {
            transactions(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  ${getFinancialQueryTransactionFields()}
                }
              }
            }
          }
        }
      }
    `,
    queryName: "getMoreOrderTransactions",
    variables: {
      orderId,
      cursor,
    },
  });

  return ((
    data.data as {
      node?: { transactions?: ShopifyConnection<OrderTransactionNode> };
    }
  )?.node?.transactions ??
    null) as ShopifyConnection<OrderTransactionNode> | null;
}

async function fetchMoreRefunds({
  admin,
  orderId,
  cursor,
}: {
  admin: ShopifyAdminClient;
  orderId: string;
  cursor: string | null;
}) {
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getMoreOrderRefunds($orderId: ID!, $cursor: String) {
        node(id: $orderId) {
          ... on Order {
            refunds(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  ${getFinancialQueryRefundFields()}
                }
              }
            }
          }
        }
      }
    `,
    queryName: "getMoreOrderRefunds",
    variables: {
      orderId,
      cursor,
    },
  });

  return ((data.data as { node?: { refunds?: ShopifyConnection<RefundNode> } })
    ?.node?.refunds ?? null) as ShopifyConnection<RefundNode> | null;
}

async function fetchMoreRefundLineItems({
  admin,
  refundId,
  cursor,
}: {
  admin: ShopifyAdminClient;
  refundId: string;
  cursor: string | null;
}) {
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getMoreRefundLineItems($refundId: ID!, $cursor: String) {
        node(id: $refundId) {
          ... on Refund {
            refundLineItems(first: 100, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  quantity
                  subtotalSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  lineItem {
                    id
                  }
                }
              }
            }
          }
        }
      }
    `,
    queryName: "getMoreRefundLineItems",
    variables: {
      refundId,
      cursor,
    },
  });

  return ((
    data.data as {
      node?: { refundLineItems?: ShopifyConnection<RefundLineItemNode> };
    }
  )?.node?.refundLineItems ??
    null) as ShopifyConnection<RefundLineItemNode> | null;
}

async function fetchMoreRefundTransactions({
  admin,
  refundId,
  cursor,
}: {
  admin: ShopifyAdminClient;
  refundId: string;
  cursor: string | null;
}) {
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getMoreRefundTransactions($refundId: ID!, $cursor: String) {
        node(id: $refundId) {
          ... on Refund {
            transactions(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  ${getFinancialQueryTransactionFields()}
                }
              }
            }
          }
        }
      }
    `,
    queryName: "getMoreRefundTransactions",
    variables: {
      refundId,
      cursor,
    },
  });

  return ((
    data.data as {
      node?: { transactions?: ShopifyConnection<OrderTransactionNode> };
    }
  )?.node?.transactions ??
    null) as ShopifyConnection<OrderTransactionNode> | null;
}

async function getCompleteFinancialDetails({
  admin,
  order,
}: {
  admin: ShopifyAdminClient;
  order: OrderNode;
}) {
  const truncatedFields: string[] = [];
  let financialDataComplete = true;
  let financialIncompleteReason: string | null = null;
  const transactions = [...getConnectionNodes(order.transactions)];
  const refunds = [...getConnectionNodes(order.refunds)];

  try {
    let transactionConnection = order.transactions ?? null;
    let transactionCursor = getEndCursor(transactionConnection);
    let transactionPages = 1;

    while (hasNextPage(transactionConnection) && transactionCursor) {
      if (transactionPages >= MAX_TRANSACTION_PAGES) {
        truncatedFields.push("transactions");
        break;
      }

      transactionConnection = await fetchMoreOrderTransactions({
        admin,
        orderId: order.id,
        cursor: transactionCursor,
      });
      transactions.push(...getConnectionNodes(transactionConnection));
      transactionCursor = getEndCursor(transactionConnection);
      transactionPages += 1;
    }

    let refundConnection = order.refunds ?? null;
    let refundCursor = getEndCursor(refundConnection);
    let refundPages = 1;

    while (hasNextPage(refundConnection) && refundCursor) {
      if (refundPages >= MAX_REFUND_PAGES) {
        truncatedFields.push("refunds");
        break;
      }

      refundConnection = await fetchMoreRefunds({
        admin,
        orderId: order.id,
        cursor: refundCursor,
      });
      refunds.push(...getConnectionNodes(refundConnection));
      refundCursor = getEndCursor(refundConnection);
      refundPages += 1;
    }

    for (const refund of refunds) {
      let refundLineConnection = refund.refundLineItems ?? null;
      let refundLineCursor = getEndCursor(refundLineConnection);
      let refundLinePages = 1;

      while (hasNextPage(refundLineConnection) && refundLineCursor) {
        if (refundLinePages >= MAX_REFUND_LINE_ITEM_PAGES) {
          truncatedFields.push(`refundLineItems:${refund.id}`);
          break;
        }

        refundLineConnection = await fetchMoreRefundLineItems({
          admin,
          refundId: refund.id,
          cursor: refundLineCursor,
        });
        refund.refundLineItems = {
          pageInfo: refundLineConnection?.pageInfo ?? null,
          edges: [
            ...(refund.refundLineItems?.edges ?? []),
            ...(refundLineConnection?.edges ?? []),
          ],
        };
        refundLineCursor = getEndCursor(refundLineConnection);
        refundLinePages += 1;
      }

      let refundTransactionConnection = refund.transactions ?? null;
      let refundTransactionCursor = getEndCursor(refundTransactionConnection);
      let refundTransactionPages = 1;

      while (
        hasNextPage(refundTransactionConnection) &&
        refundTransactionCursor
      ) {
        if (refundTransactionPages >= MAX_TRANSACTION_PAGES) {
          truncatedFields.push(`refundTransactions:${refund.id}`);
          break;
        }

        refundTransactionConnection = await fetchMoreRefundTransactions({
          admin,
          refundId: refund.id,
          cursor: refundTransactionCursor,
        });
        refund.transactions = {
          pageInfo: refundTransactionConnection?.pageInfo ?? null,
          edges: [
            ...(refund.transactions?.edges ?? []),
            ...(refundTransactionConnection?.edges ?? []),
          ],
        };
        refundTransactionCursor = getEndCursor(refundTransactionConnection);
        refundTransactionPages += 1;
      }

      transactions.push(...getConnectionNodes(refund.transactions));
    }
  } catch (error) {
    financialDataComplete = false;
    financialIncompleteReason =
      error instanceof Error ? error.message : String(error);
    truncatedFields.push("financial_pagination");
  }

  if (truncatedFields.length > 0) {
    financialDataComplete = false;
    financialIncompleteReason ??= `Financial data truncated: ${truncatedFields.join(", ")}`;
  }

  return {
    transactions: Array.from(
      new Map(
        transactions.map((transaction) => [transaction.id, transaction]),
      ).values(),
    ),
    refunds,
    financialDataComplete,
    financialIncompleteReason,
    truncatedFields,
  };
}

async function upsertOrderNodes({
  admin,
  shop,
  supabase,
  orders,
  includeStaffAttribution,
  replaceExistingLines = false,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  orders: OrderNode[];
  includeStaffAttribution: boolean;
  replaceExistingLines?: boolean;
}) {
  const { costByVariantId, costBySku } = await getVariantCostMaps({
    supabase,
    shop,
  });
  const orderLineItemsByOrderId = new Map<string, OrderLineItemNode[]>();
  const allLineItemIds: string[] = [];

  for (const order of orders) {
    const allLineItems = await getAllLineItemsForOrder({
      admin,
      order,
      includeStaffAttribution,
    });

    orderLineItemsByOrderId.set(order.id, allLineItems);
    allLineItemIds.push(...allLineItems.map((lineItem) => lineItem.id));
  }

  const existingCostAtSaleByLineItemId =
    await getExistingOrderLineCostAtSaleMap({
      supabase,
      shop,
      lineItemIds: allLineItemIds,
    });
  const orderRows: Record<string, unknown>[] = [];
  const orderLineRows: Record<string, unknown>[] = [];
  const transactionRowsByOrderId = new Map<string, OrderTransactionNode[]>();

  for (const order of orders) {
    const orderStaff = includeStaffAttribution
      ? getOrderStaffAttribution(order)
      : getStaffAttribution(null);
    const allLineItems = orderLineItemsByOrderId.get(order.id) ?? [];
    const {
      transactions,
      refunds,
      financialDataComplete,
      financialIncompleteReason,
      truncatedFields,
    } = await getCompleteFinancialDetails({ admin, order });
    const { lineFinancialsByLineItemId, orderFinancials } = getOrderFinancials({
      order,
      allLineItems,
      refunds,
      transactions,
      financialDataComplete,
      financialIncompleteReason,
      truncatedFields,
    });

    transactionRowsByOrderId.set(order.id, transactions);

    orderRows.push({
      shop_domain: shop,
      shopify_order_id: order.id,
      order_name: order.name,
      created_at_shopify: order.createdAt,
      shopify_updated_at: order.updatedAt ?? null,
      cancelled_at: order.cancelledAt ?? null,
      cancel_reason: order.cancelReason ?? null,
      financial_status: order.displayFinancialStatus ?? null,
      retail_location_id: order.retailLocation?.id ?? null,
      retail_location_name: order.retailLocation?.name ?? null,
      total_price: getNumericAmount(order.totalPriceSet?.shopMoney?.amount),
      currency_code: orderFinancials.currencyCode,
      gross_sales: orderFinancials.grossSales,
      discounts: orderFinancials.discounts,
      returns: orderFinancials.returns,
      net_sales: orderFinancials.netSales,
      refunds: orderFinancials.refunds,
      taxes: orderFinancials.taxes,
      shipping: orderFinancials.shipping,
      total_sales: orderFinancials.totalSales,
      transactions_total: orderFinancials.transactionsTotal,
      financial_data_complete: orderFinancials.financialDataComplete,
      financial_incomplete_reason: orderFinancials.financialIncompleteReason,
      financial_payload: orderFinancials.financialPayload,
      staff_member_id: orderStaff.staffMemberId,
      staff_member_name: orderStaff.staffMemberName,
      staff_member_email: orderStaff.staffMemberEmail,
      staff_source: orderStaff.staffSource,
      updated_at: new Date().toISOString(),
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
      const lineFinancials = lineFinancialsByLineItemId.get(lineItem.id);
      const existingCostAtSale = existingCostAtSaleByLineItemId.get(
        lineItem.id,
      );
      const shouldCaptureCostAtSale = existingCostAtSale?.cost_at_sale == null;
      const costAtSaleCapturedAt =
        shouldCaptureCostAtSale && costInfo.unitCost !== null
          ? new Date().toISOString()
          : (existingCostAtSale?.cost_at_sale_captured_at ?? null);

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
        gross_sales: lineFinancials?.grossSales ?? null,
        discounts: lineFinancials?.discounts ?? null,
        returns: lineFinancials?.returns ?? null,
        net_sales: lineFinancials?.netSales ?? null,
        refunded_amount: lineFinancials?.refundedAmount ?? null,
        taxes: lineFinancials?.taxes ?? null,
        returned_quantity: lineFinancials?.returnedQuantity ?? null,
        cost_at_sale: shouldCaptureCostAtSale
          ? costInfo.unitCost
          : existingCostAtSale.cost_at_sale,
        cost_at_sale_source: shouldCaptureCostAtSale
          ? costInfo.costSource
          : existingCostAtSale.cost_at_sale_source,
        cost_at_sale_captured_at: costAtSaleCapturedAt,
        staff_member_id: staffAttribution.staffMemberId,
        staff_member_name: staffAttribution.staffMemberName,
        staff_member_email: staffAttribution.staffMemberEmail,
        staff_source: staffAttribution.staffSource,
      });
    }
  }

  if (replaceExistingLines && orders.length > 0) {
    const { error } = await supabase
      .from("order_lines")
      .delete()
      .eq("shop_domain", shop)
      .in(
        "shopify_order_id",
        orders.map((order) => order.id),
      );

    if (error) {
      throw new Error(error.message);
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

  for (const [orderId, transactions] of transactionRowsByOrderId.entries()) {
    await upsertOrderTransactions({
      supabase,
      shop,
      orderId,
      transactions,
    });
  }

  return {
    ordersSynced: orderRows.length,
    orderLinesSynced: orderLineRows.length,
  };
}

async function syncOrdersPage({
  admin,
  shop,
  supabase,
  cursor,
  orderQuery,
  sortKey = "CREATED_AT",
  includeStaffAttribution,
  replaceExistingLines = false,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  cursor?: string | null;
  orderQuery: string;
  sortKey?: "CREATED_AT" | "UPDATED_AT";
  includeStaffAttribution: boolean;
  replaceExistingLines?: boolean;
}) {
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getOrdersForSyncBatch($cursor: String, $query: String) {
        orders(
          first: ${ORDERS_PAGE_SIZE},
          after: $cursor,
          sortKey: ${sortKey},
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
              updatedAt
              cancelledAt
              cancelReason
              currencyCode
              displayFinancialStatus
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
              transactions(first: 50) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    ${getFinancialQueryTransactionFields(includeStaffAttribution)}
                  }
                }
              }
              refunds(first: 50) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    ${getFinancialQueryRefundFields()}
                  }
                }
              }
              subtotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentSubtotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalDiscountsSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentTotalDiscountsSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentTotalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalRefundedSet {
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
                    ${getFinancialQueryLineItemFields(includeStaffAttribution)}
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
  const counts = await upsertOrderNodes({
    admin,
    shop,
    supabase,
    orders,
    includeStaffAttribution,
    replaceExistingLines,
  });

  return {
    ordersSynced: counts.ordersSynced,
    orderLinesSynced: counts.orderLinesSynced,
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
  let staffAttributionAvailable = progress?.staffAttributionAvailable !== false;
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
    staffAttributionError =
      error instanceof Error ? error.message : String(error);
    pageResult = await syncOrdersPage({
      admin,
      shop,
      supabase,
      cursor,
      orderQuery,
      includeStaffAttribution: false,
    });
  }

  const isDone = !pageResult.hasNextPage || pageResult.ordersSynced === 0;
  const orderLinesCogsRecomputed = isDone
    ? await recomputeOrderLineCogsForShop({ supabase, shop })
    : 0;

  return {
    done: isDone,
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
      orderLinesCogsRecomputed,
      staffAttributionAvailable,
      staffAttributionError,
    },
  };
}

function getOrdersReconciliation48hWindow() {
  const end = new Date();
  const start = new Date(end.getTime() - 48 * 60 * 60 * 1000);

  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

export async function syncOrdersReconciliation48hBatch({
  admin,
  shop,
  supabase,
  progress,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  progress?: OrdersReconciliation48hBatchProgress | null;
}): Promise<SyncBatchResult> {
  const fallbackWindow = getOrdersReconciliation48hWindow();
  const windowStart = progress?.windowStart ?? fallbackWindow.windowStart;
  const windowEnd = progress?.windowEnd ?? fallbackWindow.windowEnd;
  const orderQuery = buildOrderQuery({
    startDate: windowStart,
    endDate: windowEnd,
    dateField: "updated_at",
  });
  const cursor = progress?.cursor ?? null;
  let staffAttributionAvailable = progress?.staffAttributionAvailable !== false;
  let staffAttributionError: string | null = null;
  let pageResult: Awaited<ReturnType<typeof syncOrdersPage>>;

  try {
    pageResult = await syncOrdersPage({
      admin,
      shop,
      supabase,
      cursor,
      orderQuery,
      sortKey: "UPDATED_AT",
      includeStaffAttribution: staffAttributionAvailable,
      replaceExistingLines: true,
    });
  } catch (error) {
    if (!staffAttributionAvailable) {
      throw error;
    }

    staffAttributionAvailable = false;
    staffAttributionError =
      error instanceof Error ? error.message : String(error);
    pageResult = await syncOrdersPage({
      admin,
      shop,
      supabase,
      cursor,
      orderQuery,
      sortKey: "UPDATED_AT",
      includeStaffAttribution: false,
      replaceExistingLines: true,
    });
  }

  const isDone = !pageResult.hasNextPage || pageResult.ordersSynced === 0;

  return {
    done: isDone,
    progress: {
      cursor: pageResult.hasNextPage ? pageResult.cursor : null,
      windowStart,
      windowEnd,
      staffAttributionAvailable,
    },
    counts: {
      ordersSynced: pageResult.ordersSynced,
      orderLinesSynced: pageResult.orderLinesSynced,
      pagesProcessed: pageResult.ordersSynced > 0 ? 1 : 0,
      orderLinesCogsRecomputed: 0,
      staffAttributionAvailable,
      staffAttributionError,
      windowStart,
      windowEnd,
    },
  };
}

async function fetchOrderByIdForSync({
  admin,
  orderId,
  includeStaffAttribution,
}: {
  admin: ShopifyAdminClient;
  orderId: string;
  includeStaffAttribution: boolean;
}) {
  const data = await executeShopifyGraphql({
    admin,
    query: `#graphql
      query getOrderByIdForSync($orderId: ID!) {
        node(id: $orderId) {
          ... on Order {
            id
            name
            createdAt
            updatedAt
            cancelledAt
            cancelReason
            currencyCode
            displayFinancialStatus
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
            transactions(first: 50) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  ${getFinancialQueryTransactionFields(includeStaffAttribution)}
                }
              }
            }
            refunds(first: 50) {
              pageInfo {
                hasNextPage
                endCursor
              }
              edges {
                node {
                  ${getFinancialQueryRefundFields()}
                }
              }
            }
            subtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            currentSubtotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalDiscountsSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            currentTotalDiscountsSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalTaxSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            currentTotalTaxSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalShippingPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            currentShippingPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            totalRefundedSet {
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
                  ${getFinancialQueryLineItemFields(includeStaffAttribution)}
                }
              }
            }
          }
        }
      }
    `,
    queryName: "getOrderByIdForSync",
    variables: {
      orderId,
    },
  });

  return ((data.data as { node?: OrderNode | null } | undefined)?.node ??
    null) as OrderNode | null;
}

export async function syncOrderById({
  admin,
  shop,
  supabase,
  source,
  orderId,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  orderId: string;
}) {
  const startedAt = new Date().toISOString();

  try {
    let staffAttributionAvailable = true;
    let staffAttributionError: string | null = null;
    let order: OrderNode | null = null;

    try {
      order = await fetchOrderByIdForSync({
        admin,
        orderId,
        includeStaffAttribution: true,
      });
    } catch (error) {
      staffAttributionAvailable = false;
      staffAttributionError =
        error instanceof Error ? error.message : String(error);
      order = await fetchOrderByIdForSync({
        admin,
        orderId,
        includeStaffAttribution: false,
      });
    }

    if (!order) {
      const result = {
        ordersSynced: 0,
        orderLinesSynced: 0,
        orderId,
        orderFound: false,
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
    }

    const counts = await upsertOrderNodes({
      admin,
      shop,
      supabase,
      orders: [order],
      includeStaffAttribution: staffAttributionAvailable,
      replaceExistingLines: true,
    });
    const result = {
      ...counts,
      orderId,
      orderFound: true,
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
      details: {
        orderId,
      },
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

    // eslint-disable-next-line no-inner-declarations
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

    const cogsStartedAt = Date.now();
    const orderLinesCogsRecomputed = await recomputeOrderLineCogsForShop({
      supabase,
      shop,
    });
    const result = {
      ...syncResult,
      orderLinesCogsRecomputed,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      staffAttributionAvailable,
      staffAttributionError,
      duration: {
        cogsRecomputeMs: getDurationMs(cogsStartedAt),
      },
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

export async function syncOrdersBulk({
  admin,
  shop,
  supabase,
  source,
  startDate,
  endDate,
  log,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  source: SyncSource;
  startDate?: string | null;
  endDate?: string | null;
  log?: SyncLogger;
}) {
  const startedAt = new Date().toISOString();
  const totalStartedAt = Date.now();
  let bulkOperationId: string | null = null;

  try {
    const orderQuery = buildOrderQuery({ startDate, endDate });
    const ordersArgs = orderQuery
      ? `(query: ${JSON.stringify(orderQuery)})`
      : "";
    const bulkOperation = await runBulkOperation({
      admin,
      log,
      query: `{
        orders${ordersArgs} {
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
              lineItems {
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
                      inventoryItem {
                        id
                      }
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
      }`,
    });
    bulkOperationId = bulkOperation.id;

    type BulkOrderParent = {
      id: string;
      name: string;
      createdAt: string;
      displayFinancialStatus?: string | null;
      totalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
      retailLocation?: { id?: string | null; name?: string | null } | null;
    };
    type BulkLineItem = Record<string, unknown> & {
      id: string;
      __parentId: string;
    };

    const ordersById = new Map<string, BulkOrderParent>();
    const lineItems: BulkLineItem[] = [];
    const downloadStartedAt = Date.now();

    logSync(log, `downloading orders bulk result: ${bulkOperation.id}`);
    await streamJsonlFromUrl({
      url: bulkOperation.url,
      onRow: (row) => {
        const id = typeof row.id === "string" ? row.id : null;
        const parentId =
          typeof row.__parentId === "string" ? row.__parentId : null;

        if (!id) {
          return;
        }

        if (parentId) {
          lineItems.push({ ...row, id, __parentId: parentId });
          return;
        }

        ordersById.set(id, {
          id,
          name: typeof row.name === "string" ? row.name : id,
          createdAt:
            typeof row.createdAt === "string"
              ? row.createdAt
              : new Date().toISOString(),
          displayFinancialStatus:
            typeof row.displayFinancialStatus === "string"
              ? row.displayFinancialStatus
              : null,
          totalPriceSet: row.totalPriceSet as BulkOrderParent["totalPriceSet"],
          retailLocation:
            row.retailLocation as BulkOrderParent["retailLocation"],
        });
      },
    });

    const now = new Date().toISOString();
    const orderRows = Array.from(ordersById.values()).map((order) => ({
      shop_domain: shop,
      shopify_order_id: order.id,
      order_name: order.name,
      created_at_shopify: order.createdAt,
      financial_status: order.displayFinancialStatus ?? null,
      retail_location_id: order.retailLocation?.id ?? null,
      retail_location_name: order.retailLocation?.name ?? null,
      total_price: getNumericAmount(order.totalPriceSet?.shopMoney?.amount),
      staff_member_id: null,
      staff_member_name: null,
      staff_member_email: null,
      staff_source: "unavailable",
      updated_at: now,
    }));
    const orderLineRows = lineItems.flatMap((lineItem) => {
      const order = ordersById.get(lineItem.__parentId);

      if (!order) {
        return [];
      }

      const variant = lineItem.variant as
        | {
            id?: string | null;
            title?: string | null;
            sku?: string | null;
            inventoryItem?: { id?: string | null } | null;
            product?: {
              id?: string | null;
              title?: string | null;
              vendor?: string | null;
            } | null;
          }
        | null
        | undefined;
      const quantity = Number(lineItem.quantity ?? 0);
      const unitPrice = getNumericAmount(
        (
          lineItem.discountedUnitPriceSet as
            | { shopMoney?: { amount?: string | null } | null }
            | undefined
        )?.shopMoney?.amount,
      );
      const revenue = unitPrice * quantity;

      return [
        {
          shop_domain: shop,
          shopify_order_id: order.id,
          shopify_line_item_id: lineItem.id,
          order_name: order.name,
          created_at_shopify: order.createdAt,
          retail_location_id: order.retailLocation?.id ?? null,
          retail_location_name: order.retailLocation?.name ?? null,
          shopify_variant_id: variant?.id ?? null,
          inventory_item_id: variant?.inventoryItem?.id ?? null,
          product_title:
            variant?.product?.title ??
            (typeof lineItem.title === "string" ? lineItem.title : null),
          variant_title: variant?.title ?? null,
          sku:
            (typeof lineItem.sku === "string" ? lineItem.sku : null) ??
            variant?.sku ??
            null,
          vendor: variant?.product?.vendor ?? null,
          quantity,
          unit_price: unitPrice,
          revenue,
          unit_cost: null,
          cogs: null,
          gross_profit: null,
          cost_source: null,
          staff_member_id: null,
          staff_member_name: null,
          staff_member_email: null,
          staff_source: "unavailable",
        },
      ];
    });
    const dbStartedAt = Date.now();

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

    const dbUpsertMs = getDurationMs(dbStartedAt);
    const cogsStartedAt = Date.now();
    const orderLinesCogsRecomputed = await recomputeOrderLineCogsForShop({
      supabase,
      shop,
    });
    const cogsRecomputeMs = getDurationMs(cogsStartedAt);
    const duration: SyncTimingDetails = {
      bulkPollMs: bulkOperation.pollDurationMs,
      bulkDownloadMs: getDurationMs(downloadStartedAt),
      dbUpsertMs,
      cogsRecomputeMs,
      totalMs: getDurationMs(totalStartedAt),
    };
    const result = {
      ordersSynced: orderRows.length,
      orderLinesSynced: orderLineRows.length,
      orderLinesCogsRecomputed,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
      bulkOperationId: bulkOperation.id,
      bulkObjectCount: bulkOperation.objectCount,
      bulkFileSize: bulkOperation.fileSize,
      duration,
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
      details: {
        bulkOperationId,
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        duration: {
          totalMs: getDurationMs(totalStartedAt),
        },
      },
    });

    throw error;
  }
}
