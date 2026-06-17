import { getSupabaseAdminClient } from "../db/supabase.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

export type WebhookEventStatus = "pending" | "processing" | "done" | "error";

export type WebhookEventRow = {
  id: string;
  shop_domain: string;
  topic: string;
  shopify_webhook_id: string | null;
  resource_gid: string | null;
  parent_resource_gid: string | null;
  payload: Record<string, unknown>;
  status: WebhookEventStatus;
  attempt_count: number;
  last_error: string | null;
  received_at: string;
  available_at: string;
  processing_started_at: string | null;
  processed_at: string | null;
};

type EnqueueWebhookEventArgs = {
  supabase: SupabaseAdminClient;
  request: Request;
  shop: string;
  topic: string;
  payload: unknown;
};

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function normalizeWebhookTopic(topic: string) {
  return topic.trim().toLowerCase().replace(/_/g, "/");
}

export function getShopifyWebhookId(request: Request) {
  return (
    request.headers.get("x-shopify-webhook-id") ||
    request.headers.get("x-shopify-event-id") ||
    null
  );
}

function toShopifyGid(resource: string, id: unknown) {
  const value = getString(id);
  if (!value) return null;
  if (value.startsWith("gid://")) return value;
  return `gid://shopify/${resource}/${value}`;
}

function getOrderGid(payload: Record<string, unknown>) {
  return (
    getString(payload.admin_graphql_api_id) ||
    toShopifyGid("Order", payload.order_id) ||
    toShopifyGid("Order", payload.id)
  );
}

function getProductGid(payload: Record<string, unknown>) {
  return getString(payload.admin_graphql_api_id) || toShopifyGid("Product", payload.id);
}

function getInventoryItemGid(payload: Record<string, unknown>) {
  return (
    getString(payload.admin_graphql_api_id) ||
    toShopifyGid("InventoryItem", payload.inventory_item_id) ||
    toShopifyGid("InventoryItem", payload.id)
  );
}

export function extractWebhookResourceGids({
  topic,
  payload,
}: {
  topic: string;
  payload: unknown;
}) {
  const normalizedTopic = normalizeWebhookTopic(topic);
  const payloadRecord = asRecord(payload);

  if (normalizedTopic.startsWith("orders/")) {
    const orderGid = getOrderGid(payloadRecord);
    return {
      resourceGid: orderGid,
      parentResourceGid: null,
    };
  }

  if (normalizedTopic.startsWith("products/")) {
    return {
      resourceGid: getProductGid(payloadRecord),
      parentResourceGid: null,
    };
  }

  if (
    normalizedTopic.startsWith("inventory/items/") ||
    normalizedTopic.startsWith("inventory_items/") ||
    normalizedTopic.startsWith("inventory-items/") ||
    normalizedTopic.startsWith("inventory/levels/") ||
    normalizedTopic.startsWith("inventory_levels/") ||
    normalizedTopic.startsWith("inventory-levels/")
  ) {
    return {
      resourceGid: getInventoryItemGid(payloadRecord),
      parentResourceGid: null,
    };
  }

  if (normalizedTopic.startsWith("refunds/")) {
    const refundGid =
      getString(payloadRecord.admin_graphql_api_id) ||
      toShopifyGid("Refund", payloadRecord.id);

    return {
      resourceGid: refundGid,
      parentResourceGid: getOrderGid(payloadRecord),
    };
  }

  if (normalizedTopic.startsWith("order_transactions/")) {
    const transactionGid =
      getString(payloadRecord.admin_graphql_api_id) ||
      toShopifyGid("OrderTransaction", payloadRecord.id);

    return {
      resourceGid: transactionGid,
      parentResourceGid: getOrderGid(payloadRecord),
    };
  }

  return {
    resourceGid: null,
    parentResourceGid: null,
  };
}

export async function enqueueWebhookEvent({
  supabase,
  request,
  shop,
  topic,
  payload,
}: EnqueueWebhookEventArgs) {
  const shopifyWebhookId = getShopifyWebhookId(request);
  const normalizedTopic = normalizeWebhookTopic(topic);
  const { resourceGid, parentResourceGid } = extractWebhookResourceGids({
    topic: normalizedTopic,
    payload,
  });
  const row = {
    shop_domain: shop,
    topic: normalizedTopic,
    shopify_webhook_id: shopifyWebhookId,
    resource_gid: resourceGid,
    parent_resource_gid: parentResourceGid,
    payload: asRecord(payload),
  };

  if (shopifyWebhookId) {
    const { data, error } = await supabase
      .from("webhook_events")
      .insert(row)
      .select("id")
      .maybeSingle();

    if (!error) {
      return {
        inserted: Boolean(data?.id),
        skipped: false,
        eventId: data?.id ?? null,
      };
    }

    if (error.code === "23505") {
      return {
        inserted: false,
        skipped: true,
        eventId: null,
      };
    }

    throw new Error(error.message);
  }

  const { data, error } = await supabase
    .from("webhook_events")
    .insert(row)
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    inserted: true,
    skipped: false,
    eventId: data.id as string,
  };
}

export async function enqueueAuthenticatedWebhook({
  request,
  payload,
  shop,
  topic,
}: {
  request: Request;
  payload: unknown;
  shop: string;
  topic: string;
}) {
  const supabase = getSupabaseAdminClient();
  return enqueueWebhookEvent({
    supabase,
    request,
    shop,
    topic,
    payload,
  });
}
