import { getSupabaseAdminClient } from "../db/supabase.server";
import { chunkArray, mapWithConcurrency } from "../db/batch-query.server.ts";
import { calculateRemainingLineCogs } from "../financial/cogs";
import { calculateNetSalesAfterCashRefunds } from "../financial/net-sales";
import { upsertPosStaffIdentityAliasesFromOrderLines } from "../staff-identity/staff-identity.server";
import { hasConfiguredScope } from "../shopify/scopes.server";
import { isBillingEnabled } from "../billing.server";

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
  presentmentMoney?: {
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

type DiscountValueNode =
  | {
      __typename?: "MoneyV2";
      amount?: string | null;
      currencyCode?: string | null;
    }
  | {
      __typename?: "PricingPercentageValue";
      percentage?: number | string | null;
    };

type DiscountApplicationNode = {
  __typename?: string | null;
  index?: number | null;
  targetType?: string | null;
  targetSelection?: string | null;
  allocationMethod?: string | null;
  value?: DiscountValueNode | null;
  code?: string | null;
  title?: string | null;
  description?: string | null;
};

type DiscountAllocationNode = {
  allocatedAmountSet?: MoneySet | null;
  discountApplication?: DiscountApplicationNode | null;
};

type CustomAttributeNode = {
  key?: string | null;
  value?: string | null;
};

type OrderLineItemNode = {
  id: string;
  title: string;
  quantity: number;
  sku?: string | null;
  customAttributes?: CustomAttributeNode[] | null;
  variant?: {
    id: string;
    title?: string | null;
    sku?: string | null;
    inventoryItem?: {
      id: string;
      unitCost?: {
        amount: string;
        currencyCode: string;
      } | null;
    } | null;
    product?: {
      id: string;
      title: string;
      vendor?: string | null;
    } | null;
  } | null;
  originalUnitPriceSet?: MoneySet | null;
  originalTotalSet?: MoneySet | null;
  discountedUnitPriceSet?: MoneySet | null;
  discountedTotalSet?: MoneySet | null;
  totalDiscountSet?: MoneySet | null;
  discountAllocations?: DiscountAllocationNode[] | null;
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

type StaffSource = "pos_session" | "unavailable";

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
  transactions?: OrderTransactionNode[] | null;
  refunds?: RefundNode[] | null;
  subtotalPriceSet?: MoneySet | null;
  currentSubtotalPriceSet?: MoneySet | null;
  totalDiscountsSet?: MoneySet | null;
  currentTotalDiscountsSet?: MoneySet | null;
  totalTaxSet?: MoneySet | null;
  currentTotalTaxSet?: MoneySet | null;
  totalShippingPriceSet?: MoneySet | null;
  currentShippingPriceSet?: MoneySet | null;
  discountApplications?: ShopifyConnection<DiscountApplicationNode> | null;
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
  | "manual_internal"
  | "webhook"
  | "cron";

const INVENTORY_BATCH_SIZE = 25;
const SUPABASE_LOOKUP_BATCH_SIZE = 250;
const SUPABASE_LOOKUP_BATCH_CONCURRENCY = 4;
const UNCHUNKED_IN_SAFETY_BATCH_SIZE = 200;
const PRODUCT_SYNC_PAGE_SIZE = 20;
const PRODUCT_VARIANT_SYNC_PAGE_SIZE = 50;
const ORDERS_PAGE_SIZE = 50;
const LINE_ITEMS_PAGE_SIZE = 100;
const UPSERT_BATCH_SIZE = 500;
const MAX_REFUND_TRANSACTION_PAGES = 10;
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
  fullHistory?: boolean;
};

export type OrdersReconciliation48hBatchProgress = {
  cursor?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
};

export type FinancialBackfill30dBatchProgress = {
  cursor?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
};

export type SyncBatchResult = {
  done: boolean;
  progress: Record<string, unknown>;
  counts: Record<string, number | boolean | string | null>;
};

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

function getArrayItems<T>(value?: T[] | null) {
  return Array.isArray(value) ? value : [];
}

function hasNextPage<T>(connection?: ShopifyConnection<T> | null) {
  return Boolean(connection?.pageInfo?.hasNextPage);
}

function getEndCursor<T>(connection?: ShopifyConnection<T> | null) {
  return connection?.pageInfo?.endCursor ?? null;
}

function getFinancialQueryDiscountApplicationFields() {
  return `
    __typename
    index
    targetType
    targetSelection
    allocationMethod
    value {
      __typename
      ... on MoneyV2 {
        amount
        currencyCode
      }
      ... on PricingPercentageValue {
        percentage
      }
    }
    ... on DiscountCodeApplication {
      code
    }
    ... on AutomaticDiscountApplication {
      title
    }
    ... on ManualDiscountApplication {
      title
      description
    }
    ... on ScriptDiscountApplication {
      title
    }
  `;
}

const POS_ATTRIBUTION_PROPERTY_KEYS = {
  compactAttributedStaffId: "_shopops_attributed_staff_id",
  compactSessionStaffId: "_shopops_session_staff_id",
  staffMemberId: "_shopops_staff_member_id",
  userId: "_shopops_user_id",
  locationId: "_shopops_location_id",
  deviceId: "_shopops_device_id",
  deviceName: "_shopops_device_name",
  staffLabel: "_shopops_staff_label",
  attributedUserId: "_shopops_attributed_user_id",
  attributedStaffMemberId: "_shopops_attributed_staff_member_id",
  effectiveStaffId: "_shopops_effective_staff_id",
  attributionSource: "_shopops_attribution_source",
} as const;
const POS_ATTRIBUTION_SOURCES = new Set([
  "attributed_user_id",
  "attributed_staff_member_id",
  "pos_session_staff_member",
  "pos_session_user",
  "pos_session",
]);

function getFinancialQueryLineItemFields() {
  return `
    id
    title
    quantity
    sku
    customAttributes {
      key
      value
    }
    variant {
      id
      title
      sku
      inventoryItem {
        id
        unitCost {
          amount
          currencyCode
        }
      }
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
    originalTotalSet {
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
    discountAllocations {
      allocatedAmountSet {
        shopMoney {
          amount
          currencyCode
        }
        presentmentMoney {
          amount
          currencyCode
        }
      }
      discountApplication {
        ${getFinancialQueryDiscountApplicationFields()}
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

function getFinancialQueryTransactionFields() {
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

function getUnavailableStaffAttribution(): StaffAttribution {
  return {
    staffMemberId: null,
    staffMemberName: null,
    staffMemberEmail: null,
    staffSource: "unavailable",
  };
}

function getCustomAttributeValue(
  attributes: CustomAttributeNode[] | null | undefined,
  key: string,
) {
  const value = attributes?.find((attribute) => attribute.key === key)?.value;
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function getPosLineItemAttribution(lineItem: OrderLineItemNode) {
  const compactAttributedStaffId = getCustomAttributeValue(
    lineItem.customAttributes,
    POS_ATTRIBUTION_PROPERTY_KEYS.compactAttributedStaffId,
  );
  const compactSessionStaffId = getCustomAttributeValue(
    lineItem.customAttributes,
    POS_ATTRIBUTION_PROPERTY_KEYS.compactSessionStaffId,
  );
  const source = getCustomAttributeValue(
    lineItem.customAttributes,
    POS_ATTRIBUTION_PROPERTY_KEYS.attributionSource,
  );
  const legacyStaffMemberId = getCustomAttributeValue(
    lineItem.customAttributes,
    POS_ATTRIBUTION_PROPERTY_KEYS.staffMemberId,
  );
  const legacyEffectiveStaffId = getCustomAttributeValue(
    lineItem.customAttributes,
    POS_ATTRIBUTION_PROPERTY_KEYS.effectiveStaffId,
  );
  const staffMemberId = compactSessionStaffId ?? legacyStaffMemberId;
  // A session id (whoever is logged into the POS register) is not who made
  // the sale. It must never resolve to a person the way an explicit "Sold
  // by" attribution does — the same register can ring up sales made by
  // different real staff. The pre-rewrite extension had the same bug under
  // the single `_shopops_effective_staff_id` key, so a legacy row is only
  // trusted when its own recorded source was genuinely explicit.
  const legacyEffectiveIsTrustworthy =
    source === "attributed_user_id" || source === "attributed_staff_member_id";
  const effectiveStaffId =
    compactAttributedStaffId ??
    (legacyEffectiveIsTrustworthy ? legacyEffectiveStaffId : null);
  const attributionSource = compactAttributedStaffId
    ? "attributed_user_id"
    : legacyEffectiveIsTrustworthy
      ? source
      : compactSessionStaffId
        ? "pos_session_staff_member"
        : source && POS_ATTRIBUTION_SOURCES.has(source)
          ? source
          : null;

  return {
    shopops_staff_member_id: staffMemberId,
    shopops_user_id: getCustomAttributeValue(
      lineItem.customAttributes,
      POS_ATTRIBUTION_PROPERTY_KEYS.userId,
    ),
    shopops_pos_location_id: getCustomAttributeValue(
      lineItem.customAttributes,
      POS_ATTRIBUTION_PROPERTY_KEYS.locationId,
    ),
    shopops_pos_device_id: getCustomAttributeValue(
      lineItem.customAttributes,
      POS_ATTRIBUTION_PROPERTY_KEYS.deviceId,
    ),
    shopops_pos_device_name: getCustomAttributeValue(
      lineItem.customAttributes,
      POS_ATTRIBUTION_PROPERTY_KEYS.deviceName,
    ),
    shopops_staff_label: getCustomAttributeValue(
      lineItem.customAttributes,
      POS_ATTRIBUTION_PROPERTY_KEYS.staffLabel,
    ),
    shopops_attributed_user_id:
      compactAttributedStaffId ??
      getCustomAttributeValue(
        lineItem.customAttributes,
        POS_ATTRIBUTION_PROPERTY_KEYS.attributedUserId,
      ),
    shopops_attributed_staff_member_id: getCustomAttributeValue(
      lineItem.customAttributes,
      POS_ATTRIBUTION_PROPERTY_KEYS.attributedStaffMemberId,
    ),
    shopops_effective_staff_id: effectiveStaffId,
    shopops_attribution_source: attributionSource,
    legacyStaffAttribution:
      effectiveStaffId && attributionSource
        ? {
            staffMemberId: normalizeStaffId(effectiveStaffId),
            staffMemberName: null,
            staffMemberEmail: null,
            staffSource: "pos_session" as StaffSource,
          }
        : getUnavailableStaffAttribution(),
  };
}

function getPosBulkLineItemAttribution(lineItem: Record<string, unknown>) {
  return getPosLineItemAttribution({
    id: typeof lineItem.id === "string" ? lineItem.id : "",
    title: typeof lineItem.title === "string" ? lineItem.title : "",
    quantity: Number(lineItem.quantity ?? 0),
    customAttributes: Array.isArray(lineItem.customAttributes)
      ? (lineItem.customAttributes as CustomAttributeNode[])
      : null,
  });
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

function getCostInfo({
  variantCost,
  revenue,
  quantity,
  returnedQuantity = 0,
}: {
  variantCost?: VariantCostRow;
  revenue: number;
  quantity: number;
  returnedQuantity?: number;
}) {
  const unitCost = variantCost?.unit_cost ?? null;
  if (unitCost !== null) {
    const cogs = calculateRemainingLineCogs({
      quantity,
      returned_quantity: returnedQuantity,
      unit_cost: unitCost,
    });

    return {
      unitCost,
      cogs: cogs ?? 0,
      grossProfit: revenue - (cogs ?? 0),
      costSource: "SHOPIFY_UNIT_COST",
    };
  }

  return {
    unitCost: null,
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

function getDiscountValueSummary(value?: DiscountValueNode | null) {
  if (!value) return null;

  if (value.__typename === "MoneyV2") {
    return {
      type: value.__typename,
      amount: getNumericAmount(value.amount),
      currencyCode: value.currencyCode ?? null,
    };
  }

  if (value.__typename === "PricingPercentageValue") {
    return {
      type: value.__typename,
      percentage: getNumericAmount(String(value.percentage ?? 0)),
    };
  }

  return {
    type: value.__typename ?? "unknown",
  };
}

function getDiscountApplicationSummary(
  application?: DiscountApplicationNode | null,
) {
  if (!application) return null;
  const type = application.__typename ?? "unknown";
  const discountCode = application.code ?? null;
  const title = application.title ?? null;
  const label = title ?? discountCode ?? type;

  return {
    type,
    index: application.index ?? null,
    targetType: application.targetType ?? null,
    targetSelection: application.targetSelection ?? null,
    allocationMethod: application.allocationMethod ?? null,
    value: getDiscountValueSummary(application.value),
    code: discountCode,
    discountCode,
    discountLabel: label,
    title,
    description: application.description ?? null,
  };
}

function getOrderDiscountApplications(order: OrderNode) {
  return getConnectionNodes(order.discountApplications)
    .map(getDiscountApplicationSummary)
    .filter((application) => application !== null);
}

function getOrderDiscountCodes(order: OrderNode) {
  return getOrderDiscountApplications(order)
    .filter((application) => application.code)
    .map((application) => ({
      code: application.code,
      title: application.title ?? application.discountLabel,
      label: application.discountLabel,
      type: application.type,
    }));
}

function getLineDiscountAllocations(lineItem: OrderLineItemNode) {
  return getArrayItems(lineItem.discountAllocations).map((allocation) => ({
    amount: getShopMoneyAmount(allocation.allocatedAmountSet),
    currencyCode: getShopMoneyCurrency(allocation.allocatedAmountSet),
    presentmentAmount: getNumericAmount(
      allocation.allocatedAmountSet?.presentmentMoney?.amount,
    ),
    presentmentCurrencyCode:
      allocation.allocatedAmountSet?.presentmentMoney?.currencyCode ?? null,
    discountApplication: getDiscountApplicationSummary(
      allocation.discountApplication,
    ),
  }));
}

function getLineDiscountAllocationTotal(lineItem: OrderLineItemNode) {
  return getArrayItems(lineItem.discountAllocations).reduce(
    (sum, allocation) =>
      sum + getShopMoneyAmount(allocation.allocatedAmountSet),
    0,
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
    getShopMoneyAmount(lineItem.originalTotalSet) ||
    getShopMoneyAmount(lineItem.originalUnitPriceSet) *
      Number(lineItem.quantity ?? 0);
  const discountedTotal = getShopMoneyAmount(lineItem.discountedTotalSet);
  const allocationDiscounts = getLineDiscountAllocationTotal(lineItem);
  const explicitDiscounts = getShopMoneyAmount(lineItem.totalDiscountSet);
  const discounts =
    allocationDiscounts ||
    explicitDiscounts ||
    Math.max(0, grossSales - discountedTotal);
  const refundSummary = refundLineItemsByLineItemId.get(lineItem.id) ?? {
    returnedQuantity: 0,
    returns: 0,
    refundedAmount: 0,
  };
  const returns = refundSummary.returns;
  const netSalesBeforeReturns =
    discountedTotal || Math.max(0, grossSales - discounts);
  const netSales = netSalesBeforeReturns - returns;

  return {
    grossSales,
    discounts,
    returns,
    netSales,
    refundedAmount: refundSummary.refundedAmount || returns,
    taxes: getLineTaxTotal(lineItem),
    returnedQuantity: refundSummary.returnedQuantity,
    discountAllocations: getLineDiscountAllocations(lineItem),
  };
}

function getOrderFinancials({
  order,
  allLineItems,
  refunds,
  transactions,
  orderTransactionsReturned,
  orderRefundsReturned,
  financialDataComplete,
  financialIncompleteReason,
  truncatedFields,
}: {
  order: OrderNode;
  allLineItems: OrderLineItemNode[];
  refunds: RefundNode[];
  transactions: OrderTransactionNode[];
  orderTransactionsReturned: number;
  orderRefundsReturned: number;
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
    lineGrossSales ||
    getShopMoneyAmount(order.currentSubtotalPriceSet) ||
    getShopMoneyAmount(order.subtotalPriceSet) ||
    0;
  const totalDiscountAmount = getShopMoneyAmount(order.totalDiscountsSet);
  const currentTotalDiscountAmount = getShopMoneyAmount(
    order.currentTotalDiscountsSet,
  );
  const discounts =
    currentTotalDiscountAmount || totalDiscountAmount || lineDiscounts;
  const totalShipping = getShopMoneyAmount(order.totalShippingPriceSet);
  const currentShipping = getShopMoneyAmount(order.currentShippingPriceSet);
  const shippingDiscounts =
    totalShipping > currentShipping ? totalShipping - currentShipping : 0;
  const discountApplications = getOrderDiscountApplications(order);
  const discountCodes = getOrderDiscountCodes(order);
  const discountReconciliationDelta =
    lineDiscounts + shippingDiscounts - discounts;
  const refundTotal = getOrderRefundTotal({ order, transactions });
  const netSales = calculateNetSalesAfterCashRefunds({
    lineNetSales: grossSales - discounts - returns,
    merchandiseReturns: returns,
    totalRefunds: refundTotal,
  });
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
      totalDiscountAmount,
      currentTotalDiscountAmount,
      lineDiscountAmount: lineDiscounts,
      shippingDiscountAmount: shippingDiscounts,
      discountApplications,
      discountCodes,
      discountReconciliationDelta,
      returns,
      netSales,
      refunds: refundTotal,
      taxes,
      shipping,
      totalSales: netSales + taxes + shipping,
      transactionsTotal: getTransactionsTotal(transactions),
      financialDataComplete,
      financialIncompleteReason,
      financialPayload: {
        truncated: !financialDataComplete,
        truncatedFields,
        orderTransactionsLimit: 50,
        orderRefundsLimit: 50,
        orderTransactionsReturned,
        orderRefundsReturned,
        discountReconciliation: {
          orderDiscountTotal: discounts,
          totalDiscountAmount,
          currentTotalDiscountAmount,
          lineDiscountAmount: lineDiscounts,
          shippingDiscountAmount: shippingDiscounts,
          delta: discountReconciliationDelta,
          warning:
            Math.abs(discountReconciliationDelta) > 0.02
              ? "Line discount allocations plus shipping discounts do not match the order discount total."
              : null,
        },
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
        discountApplications,
        discountCodes,
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
  const uniqueValues = Array.from(new Set(values)).filter(Boolean);

  const batchResults = await mapWithConcurrency(
    chunkArray(uniqueValues, SUPABASE_LOOKUP_BATCH_SIZE),
    SUPABASE_LOOKUP_BATCH_CONCURRENCY,
    async (batch) => {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq("shop_domain", shop)
        .in(column, batch);

      if (error) {
        throw new Error(error.message);
      }

      return (data ?? []) as Row[];
    },
  );

  return batchResults.flat();
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

async function recomputeOrderLineCogsForOrderLinesSql({
  supabase,
  shop,
  lineItemIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  lineItemIds: string[];
}) {
  const uniqueLineItemIds = Array.from(new Set(lineItemIds)).filter(Boolean);

  if (uniqueLineItemIds.length === 0) {
    return 0;
  }

  let recomputedCount = 0;

  for (const batch of chunkArray(
    uniqueLineItemIds,
    SUPABASE_LOOKUP_BATCH_SIZE,
  )) {
    const { data, error } = await supabase.rpc(
      "recompute_order_line_cogs_for_order_lines",
      {
        p_shop_domain: shop,
        p_shopify_line_item_ids: batch,
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
}: {
  admin: ShopifyAdminClient;
  order: OrderNode;
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
                    ${getFinancialQueryLineItemFields()}
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
    const locations: LocationNode[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    while (hasNextPage) {
      const response = await admin.graphql(
        `#graphql
      query getLocationsForSync($cursor: String) {
        locations(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
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
    `,
        { variables: { cursor } },
      );

      const data = await response.json();

      if ("errors" in data && data.errors) {
        throw new Error(JSON.stringify(data.errors));
      }

      locations.push(
        ...(data.data?.locations?.edges?.map(
          (edge: { node: LocationNode }) => edge.node,
        ) ?? []),
      );
      hasNextPage = Boolean(data.data?.locations?.pageInfo?.hasNextPage);
      cursor = data.data?.locations?.pageInfo?.endCursor ?? null;
      if (hasNextPage && !cursor)
        throw new Error("Location pagination returned no cursor.");
    }

    const billingEnabled = isBillingEnabled();
    const rows = locations.map((location) => ({
      shop_domain: shop,
      shopify_location_id: location.id,
      name: location.name,
      is_active: location.isActive,
      shopify_is_active: location.isActive,
      ...(!billingEnabled
        ? { reporting_enabled: location.isActive }
        : {}),
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

      const { error: disableReportingError } = await supabase
        .from("locations")
        .update({ reporting_enabled: false })
        .eq("shop_domain", shop)
        .eq("shopify_is_active", false)
        .eq("reporting_enabled", true);
      if (disableReportingError) {
        throw new Error(disableReportingError.message);
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

  if (!hasConfiguredScope("read_users")) {
    const result = {
      ok: true,
      syncedCount,
      skipped: true,
      reason:
        "read_users is not configured; staff directory sync is optional and reserved for custom/Plus implementations.",
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
  }

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
  variantIds,
  skus,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  variantIds: string[];
  skus: string[];
}) {
  const [variantsById, variantsBySku] = await Promise.all([
    selectRowsInBatches<VariantCostRow>({
      supabase,
      table: "variants",
      select: "shopify_variant_id, inventory_item_id, sku, unit_cost",
      shop,
      column: "shopify_variant_id",
      values: variantIds,
    }),
    selectRowsInBatches<VariantCostRow>({
      supabase,
      table: "variants",
      select: "shopify_variant_id, inventory_item_id, sku, unit_cost",
      shop,
      column: "sku",
      values: skus,
    }),
  ]);
  const variantCosts = Array.from(
    new Map(
      [...variantsById, ...variantsBySku].map((row) => [
        row.shopify_variant_id,
        row,
      ]),
    ).values(),
  );
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
  const orderTransactions = getArrayItems(order.transactions);
  const refunds = getArrayItems(order.refunds);
  const transactions = [...orderTransactions];

  try {
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
        if (refundTransactionPages >= MAX_REFUND_TRANSACTION_PAGES) {
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
    orderTransactionsReturned: orderTransactions.length,
    orderRefundsReturned: refunds.length,
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
  replaceExistingLines = false,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  orders: OrderNode[];
  replaceExistingLines?: boolean;
}) {
  const orderLineItemsByOrderId = new Map<string, OrderLineItemNode[]>();
  const allLineItemIds: string[] = [];

  for (const order of orders) {
    const allLineItems = await getAllLineItemsForOrder({
      admin,
      order,
    });

    orderLineItemsByOrderId.set(order.id, allLineItems);
    allLineItemIds.push(...allLineItems.map((lineItem) => lineItem.id));
  }

  const orderInventorySnapshots = Array.from(
    new Map(
      Array.from(orderLineItemsByOrderId.values())
        .flat()
        .flatMap((lineItem) => {
          const inventoryItem = lineItem.variant?.inventoryItem;

          if (!inventoryItem?.id) return [];

          const unitCost = parseNullableNumericAmount(
            inventoryItem.unitCost?.amount,
          );

          return [
            [
              inventoryItem.id,
              {
                inventoryItemId: inventoryItem.id,
                sku: lineItem.sku ?? lineItem.variant?.sku ?? null,
                unitCost,
                hasUnitCostValue: unitCost !== null,
                costSource: "ORDER_SYNC_UNIT_COST",
              } satisfies InventoryItemSnapshotInput,
            ] as const,
          ];
        }),
    ).values(),
  );

  if (orderInventorySnapshots.length > 0) {
    await upsertInventoryItemSnapshots({
      supabase,
      shop,
      snapshots: orderInventorySnapshots,
    });
    await updateVariantCostsFromInventoryItemsSql({
      supabase,
      shop,
      inventoryItemIds: orderInventorySnapshots.map(
        (snapshot) => snapshot.inventoryItemId,
      ),
    });
  }

  const { costByVariantId, costBySku } = await getVariantCostMaps({
    supabase,
    shop,
    variantIds: Array.from(orderLineItemsByOrderId.values())
      .flat()
      .map((lineItem) => lineItem.variant?.id ?? ""),
    skus: Array.from(orderLineItemsByOrderId.values())
      .flat()
      .map((lineItem) => lineItem.sku ?? lineItem.variant?.sku ?? ""),
  });

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
    const orderStaff = getUnavailableStaffAttribution();
    const allLineItems = orderLineItemsByOrderId.get(order.id) ?? [];
    const {
      transactions,
      refunds,
      orderTransactionsReturned,
      orderRefundsReturned,
      financialDataComplete,
      financialIncompleteReason,
      truncatedFields,
    } = await getCompleteFinancialDetails({ admin, order });
    const { lineFinancialsByLineItemId, orderFinancials } = getOrderFinancials({
      order,
      allLineItems,
      refunds,
      transactions,
      orderTransactionsReturned,
      orderRefundsReturned,
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
      total_discount_amount: orderFinancials.totalDiscountAmount,
      current_total_discount_amount: orderFinancials.currentTotalDiscountAmount,
      line_discount_amount: orderFinancials.lineDiscountAmount,
      shipping_discount_amount: orderFinancials.shippingDiscountAmount,
      discount_applications: orderFinancials.discountApplications,
      discount_codes: orderFinancials.discountCodes,
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
      const variantCost = variantId
        ? (costByVariantId.get(variantId) ??
          (sku ? costBySku.get(sku) : undefined) ??
          (lineItem.variant?.inventoryItem
            ? {
                shopify_variant_id: variantId,
                inventory_item_id: lineItem.variant.inventoryItem.id,
                sku,
                unit_cost: parseNullableNumericAmount(
                  lineItem.variant.inventoryItem.unitCost?.amount,
                ),
              }
            : undefined))
        : undefined;
      const lineFinancials = lineFinancialsByLineItemId.get(lineItem.id);
      const costInfo = getCostInfo({
        variantCost,
        revenue: lineFinancials?.netSales ?? revenue,
        quantity: lineItem.quantity,
        returnedQuantity: lineFinancials?.returnedQuantity,
      });
      const posAttribution = getPosLineItemAttribution(lineItem);
      const staffAttribution = posAttribution.legacyStaffAttribution
        .staffMemberId
        ? posAttribution.legacyStaffAttribution
        : orderStaff;
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
        discount_amount: lineFinancials?.discounts ?? null,
        discount_allocations: lineFinancials?.discountAllocations ?? null,
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
        shopops_staff_member_id: posAttribution.shopops_staff_member_id,
        shopops_user_id: posAttribution.shopops_user_id,
        shopops_pos_location_id: posAttribution.shopops_pos_location_id,
        shopops_pos_device_id: posAttribution.shopops_pos_device_id,
        shopops_pos_device_name: posAttribution.shopops_pos_device_name,
        shopops_staff_label: posAttribution.shopops_staff_label,
        shopops_attributed_user_id: posAttribution.shopops_attributed_user_id,
        shopops_attributed_staff_member_id:
          posAttribution.shopops_attributed_staff_member_id,
        shopops_effective_staff_id: posAttribution.shopops_effective_staff_id,
        shopops_attribution_source: posAttribution.shopops_attribution_source,
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

  if (replaceExistingLines && orders.length > 0) {
    const incomingLineIds = new Set(
      orderLineRows.map((line) => line.shopify_line_item_id),
    );
    // Chunked defensively even though today's caller only ever passes one
    // ORDERS_PAGE_SIZE page of orders (well under the safety batch size) —
    // this keeps the .in() bounded if that page size is ever raised later.
    const existingLinesBatches = await mapWithConcurrency(
      chunkArray(
        orders.map((order) => order.id),
        UNCHUNKED_IN_SAFETY_BATCH_SIZE,
      ),
      SUPABASE_LOOKUP_BATCH_CONCURRENCY,
      async (orderIdBatch) => {
        const { data, error } = await supabase
          .from("order_lines")
          .select("shopify_line_item_id")
          .eq("shop_domain", shop)
          .in("shopify_order_id", orderIdBatch);
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    );
    const staleLineIds = existingLinesBatches
      .flat()
      .map((line) => line.shopify_line_item_id as string)
      .filter((lineId) => !incomingLineIds.has(lineId));
    if (staleLineIds.length > 0) {
      await mapWithConcurrency(
        chunkArray(staleLineIds, UNCHUNKED_IN_SAFETY_BATCH_SIZE),
        SUPABASE_LOOKUP_BATCH_CONCURRENCY,
        async (lineIdBatch) => {
          const { error: deleteError } = await supabase
            .from("order_lines")
            .delete()
            .eq("shop_domain", shop)
            .in("shopify_line_item_id", lineIdBatch);
          if (deleteError) throw new Error(deleteError.message);
        },
      );
    }
  }

  const orderLinesCogsRecomputed =
    await recomputeOrderLineCogsForOrderLinesSql({
      supabase,
      shop,
      lineItemIds: orderLineRows.map(
        (line) => line.shopify_line_item_id as string,
      ),
    });

  await upsertPosStaffIdentityAliasesFromOrderLines({
    supabase,
    shop,
    orderLines: orderLineRows,
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
    orderLinesCogsRecomputed,
    transactionsSynced: Array.from(transactionRowsByOrderId.values()).reduce(
      (sum, transactions) => sum + transactions.length,
      0,
    ),
  };
}

async function syncOrdersPage({
  admin,
  shop,
  supabase,
  cursor,
  orderQuery,
  sortKey = "CREATED_AT",
  replaceExistingLines = false,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  cursor?: string | null;
  orderQuery: string;
  sortKey?: "CREATED_AT" | "UPDATED_AT";
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
              transactions(first: 50) {
                ${getFinancialQueryTransactionFields()}
              }
              refunds {
                ${getFinancialQueryRefundFields()}
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
              discountApplications(first: 20) {
                edges {
                  node {
                    ${getFinancialQueryDiscountApplicationFields()}
                  }
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
                    ${getFinancialQueryLineItemFields()}
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
    replaceExistingLines,
  });

  return {
    ordersSynced: counts.ordersSynced,
    orderLinesSynced: counts.orderLinesSynced,
    transactionsSynced: counts.transactionsSynced,
    orderLinesCogsRecomputed: counts.orderLinesCogsRecomputed,
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
  const dateRange = progress?.fullHistory
    ? { startDate: null, endDate: null }
    : progress?.startDate || progress?.endDate
      ? {
          startDate: progress.startDate ?? null,
          endDate: progress.endDate ?? null,
        }
      : getIncrementalOrderDateRange();
  const orderQuery = buildOrderQuery(dateRange);
  const cursor = progress?.cursor ?? null;
  const pageResult = await syncOrdersPage({
    admin,
    shop,
    supabase,
    cursor,
    orderQuery,
  });

  const isDone = !pageResult.hasNextPage || pageResult.ordersSynced === 0;

  return {
    done: isDone,
    progress: {
      cursor: pageResult.hasNextPage ? pageResult.cursor : null,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      fullHistory: progress?.fullHistory ?? false,
    },
    counts: {
      ordersSynced: pageResult.ordersSynced,
      orderLinesSynced: pageResult.orderLinesSynced,
      transactionsSynced: pageResult.transactionsSynced,
      pagesProcessed: pageResult.ordersSynced > 0 ? 1 : 0,
      orderLinesCogsRecomputed: pageResult.orderLinesCogsRecomputed,
    },
  };
}

function getFinancialBackfill30dWindow() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
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
  const pageResult = await syncOrdersPage({
    admin,
    shop,
    supabase,
    cursor,
    orderQuery,
    sortKey: "UPDATED_AT",
    replaceExistingLines: true,
  });

  const isDone = !pageResult.hasNextPage || pageResult.ordersSynced === 0;

  return {
    done: isDone,
    progress: {
      cursor: pageResult.hasNextPage ? pageResult.cursor : null,
      windowStart,
      windowEnd,
    },
    counts: {
      ordersSynced: pageResult.ordersSynced,
      orderLinesSynced: pageResult.orderLinesSynced,
      transactionsSynced: pageResult.transactionsSynced,
      pagesProcessed: pageResult.ordersSynced > 0 ? 1 : 0,
      orderLinesCogsRecomputed: 0,
      windowStart,
      windowEnd,
    },
  };
}

export async function syncFinancialBackfill30dBatch({
  admin,
  shop,
  supabase,
  progress,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  supabase: SupabaseAdminClient;
  progress?: FinancialBackfill30dBatchProgress | null;
}): Promise<SyncBatchResult> {
  const fallbackWindow = getFinancialBackfill30dWindow();
  const windowStart = progress?.windowStart ?? fallbackWindow.windowStart;
  const windowEnd = progress?.windowEnd ?? fallbackWindow.windowEnd;
  const orderQuery = buildOrderQuery({
    startDate: windowStart,
    endDate: windowEnd,
    dateField: "created_at",
  });
  const cursor = progress?.cursor ?? null;
  const pageResult = await syncOrdersPage({
    admin,
    shop,
    supabase,
    cursor,
    orderQuery,
    sortKey: "CREATED_AT",
  });

  const isDone = !pageResult.hasNextPage || pageResult.ordersSynced === 0;

  return {
    done: isDone,
    progress: {
      cursor: pageResult.hasNextPage ? pageResult.cursor : null,
      windowStart,
      windowEnd,
    },
    counts: {
      ordersSynced: pageResult.ordersSynced,
      orderLinesSynced: pageResult.orderLinesSynced,
      transactionsSynced: pageResult.transactionsSynced,
      pagesProcessed: pageResult.ordersSynced > 0 ? 1 : 0,
      orderLinesCogsRecomputed: 0,
      windowStart,
      windowEnd,
    },
  };
}

async function fetchOrderByIdForSync({
  admin,
  orderId,
}: {
  admin: ShopifyAdminClient;
  orderId: string;
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
            transactions(first: 50) {
              ${getFinancialQueryTransactionFields()}
            }
            refunds {
              ${getFinancialQueryRefundFields()}
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
            discountApplications(first: 20) {
              edges {
                node {
                  ${getFinancialQueryDiscountApplicationFields()}
                }
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
                  ${getFinancialQueryLineItemFields()}
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
    const order = await fetchOrderByIdForSync({
      admin,
      orderId,
    });

    if (!order) {
      const result = {
        ordersSynced: 0,
        orderLinesSynced: 0,
        orderId,
        orderFound: false,
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
      replaceExistingLines: true,
    });
    const result = {
      ...counts,
      orderId,
      orderFound: true,
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
    async function runOrdersSync() {
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
                          customAttributes {
                            key
                            value
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
          const orderStaff = getUnavailableStaffAttribution();

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
          const orderStaff = getUnavailableStaffAttribution();
          const allLineItems = await getAllLineItemsForOrder({
            admin,
            order,
          });

          for (const lineItem of allLineItems) {
            const variantId = lineItem.variant?.id ?? null;
            const sku = lineItem.sku ?? lineItem.variant?.sku ?? null;

            const unitPrice = getNumericAmount(
              lineItem.discountedUnitPriceSet?.shopMoney?.amount,
            );

            const revenue = unitPrice * lineItem.quantity;

            const variantCost = variantId
              ? (costByVariantId.get(variantId) ??
                (sku ? costBySku.get(sku) : undefined))
              : undefined;

            const costInfo = getCostInfo({
              variantCost,
              revenue,
              quantity: lineItem.quantity,
            });

            const posAttribution = getPosLineItemAttribution(lineItem);
            const staffAttribution = posAttribution.legacyStaffAttribution
              .staffMemberId
              ? posAttribution.legacyStaffAttribution
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
              shopops_staff_member_id: posAttribution.shopops_staff_member_id,
              shopops_user_id: posAttribution.shopops_user_id,
              shopops_pos_location_id: posAttribution.shopops_pos_location_id,
              shopops_pos_device_id: posAttribution.shopops_pos_device_id,
              shopops_pos_device_name: posAttribution.shopops_pos_device_name,
              shopops_staff_label: posAttribution.shopops_staff_label,
              shopops_attributed_user_id:
                posAttribution.shopops_attributed_user_id,
              shopops_attributed_staff_member_id:
                posAttribution.shopops_attributed_staff_member_id,
              shopops_effective_staff_id:
                posAttribution.shopops_effective_staff_id,
              shopops_attribution_source:
                posAttribution.shopops_attribution_source,
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

        await upsertPosStaffIdentityAliasesFromOrderLines({
          supabase,
          shop,
          orderLines: orderLineRows,
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

    const syncResult = await runOrdersSync();

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
                    customAttributes {
                      key
                      value
                    }
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
      const posAttribution = getPosBulkLineItemAttribution(lineItem);
      const staffAttribution = posAttribution.legacyStaffAttribution;
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
          staff_member_id: staffAttribution.staffMemberId,
          staff_member_name: staffAttribution.staffMemberName,
          staff_member_email: staffAttribution.staffMemberEmail,
          staff_source: staffAttribution.staffSource,
          shopops_staff_member_id: posAttribution.shopops_staff_member_id,
          shopops_user_id: posAttribution.shopops_user_id,
          shopops_pos_location_id: posAttribution.shopops_pos_location_id,
          shopops_pos_device_id: posAttribution.shopops_pos_device_id,
          shopops_pos_device_name: posAttribution.shopops_pos_device_name,
          shopops_staff_label: posAttribution.shopops_staff_label,
          shopops_attributed_user_id: posAttribution.shopops_attributed_user_id,
          shopops_attributed_staff_member_id:
            posAttribution.shopops_attributed_staff_member_id,
          shopops_effective_staff_id: posAttribution.shopops_effective_staff_id,
          shopops_attribution_source: posAttribution.shopops_attribution_source,
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
    await upsertPosStaffIdentityAliasesFromOrderLines({
      supabase,
      shop,
      orderLines: orderLineRows,
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
