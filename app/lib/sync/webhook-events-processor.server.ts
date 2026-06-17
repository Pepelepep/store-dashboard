import { getSupabaseAdminClient } from "../db/supabase.server";
import { getOfflineAdminClient } from "../shopify/offline-admin.server";
import type { WebhookEventRow } from "../webhooks/webhook-events.server";
import {
  extractWebhookResourceGids,
  normalizeWebhookTopic,
} from "../webhooks/webhook-events.server";
import {
  markProductDeletedById,
  syncInventoryItems,
  syncOrderById,
  syncProductById,
} from "./shopify-sync.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

type ProcessWebhookEventsBatchArgs = {
  supabase?: SupabaseAdminClient;
  batchSize?: number;
  maxAttempts?: number;
};

type InventoryItemUpdate = {
  inventoryItemId: string;
  sku?: string | null;
  tracked?: boolean | null;
  unitCost: number | null;
  hasExplicitUnitCost: boolean;
};

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_ATTEMPTS = 5;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function hasPayloadCost(payload: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(payload, "cost");
}

function parsePayloadCost(cost: unknown) {
  if (cost === null || cost === undefined || cost === "") {
    return null;
  }

  const amount = Number(cost);
  return Number.isFinite(amount) ? amount : null;
}

function getInventoryItemUpdate(event: WebhookEventRow): InventoryItemUpdate | null {
  if (!event.resource_gid || !isRecord(event.payload)) {
    return null;
  }

  return {
    inventoryItemId: event.resource_gid,
    sku: typeof event.payload.sku === "string" ? event.payload.sku : null,
    tracked:
      typeof event.payload.tracked === "boolean" ? event.payload.tracked : null,
    unitCost: parsePayloadCost(event.payload.cost),
    hasExplicitUnitCost: hasPayloadCost(event.payload),
  };
}

function getRetryAvailableAt(attemptCount: number) {
  const delayMinutes = Math.min(60, Math.max(1, attemptCount) * 5);
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

async function claimWebhookEvents({
  supabase,
  batchSize,
  maxAttempts,
}: {
  supabase: SupabaseAdminClient;
  batchSize: number;
  maxAttempts: number;
}) {
  const { data, error } = await supabase.rpc("claim_webhook_events", {
    p_batch_size: batchSize,
    p_max_attempts: maxAttempts,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WebhookEventRow[];
}

async function markEventDone({
  supabase,
  event,
}: {
  supabase: SupabaseAdminClient;
  event: WebhookEventRow;
}) {
  const { error } = await supabase
    .from("webhook_events")
    .update({
      status: "done",
      last_error: null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", event.id);

  if (error) {
    throw new Error(error.message);
  }
}

async function markEventError({
  supabase,
  event,
  error,
  maxAttempts,
}: {
  supabase: SupabaseAdminClient;
  event: WebhookEventRow;
  error: unknown;
  maxAttempts: number;
}) {
  const nextAttemptCount = event.attempt_count + 1;
  const retryable = nextAttemptCount < maxAttempts;
  const { error: updateError } = await supabase
    .from("webhook_events")
    .update({
      status: retryable ? "pending" : "error",
      attempt_count: nextAttemptCount,
      last_error: getErrorMessage(error),
      available_at: retryable
        ? getRetryAvailableAt(nextAttemptCount)
        : new Date().toISOString(),
      processed_at: retryable ? null : new Date().toISOString(),
    })
    .eq("id", event.id);

  if (updateError) {
    throw new Error(updateError.message);
  }
}

async function processWebhookEvent({
  event,
  supabase,
}: {
  event: WebhookEventRow;
  supabase: SupabaseAdminClient;
}) {
  const topic = normalizeWebhookTopic(event.topic);
  const resourceGids = extractWebhookResourceGids({
    topic,
    payload: event.payload,
  });
  const resourceGid = event.resource_gid ?? resourceGids.resourceGid;
  const parentResourceGid =
    event.parent_resource_gid ?? resourceGids.parentResourceGid;

  if (topic === "orders/create" || topic === "orders/updated") {
    const orderId = resourceGid ?? parentResourceGid;
    if (!orderId) {
      throw new Error(`Missing order id for ${topic}.`);
    }

    const admin = await getOfflineAdminClient(event.shop_domain);
    await syncOrderById({
      admin,
      shop: event.shop_domain,
      supabase,
      source: "webhook",
      orderId,
    });
    return;
  }

  if (topic === "products/create" || topic === "products/update") {
    if (!resourceGid) {
      throw new Error(`Missing product id for ${topic}.`);
    }

    const admin = await getOfflineAdminClient(event.shop_domain);
    await syncProductById({
      admin,
      shop: event.shop_domain,
      supabase,
      source: "webhook",
      productId: resourceGid,
    });
    return;
  }

  if (topic === "products/delete") {
    if (!resourceGid) {
      throw new Error(`Missing product id for ${topic}.`);
    }

    await markProductDeletedById({
      shop: event.shop_domain,
      supabase,
      source: "webhook",
      productId: resourceGid,
    });
    return;
  }

  if (
    topic === "inventory/items/update" ||
    topic === "inventory-items/update" ||
    topic === "inventory_items/update" ||
    topic === "inventory/levels/update" ||
    topic === "inventory-levels/update" ||
    topic === "inventory_levels/update"
  ) {
    const inventoryItemUpdate = getInventoryItemUpdate(event);
    const inventoryItemId = inventoryItemUpdate?.inventoryItemId ?? resourceGid;

    if (!inventoryItemId) {
      throw new Error(`Missing inventory item id for ${topic}.`);
    }

    const admin = await getOfflineAdminClient(event.shop_domain);
    await syncInventoryItems({
      admin,
      shop: event.shop_domain,
      supabase,
      source: "webhook",
      inventoryItemIds: [inventoryItemId],
      inventoryItemUpdates: inventoryItemUpdate ? [inventoryItemUpdate] : [],
    });
    return;
  }

  throw new Error(`Unsupported webhook topic: ${event.topic}.`);
}

export async function processWebhookEventsBatch({
  supabase = getSupabaseAdminClient(),
  batchSize = DEFAULT_BATCH_SIZE,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}: ProcessWebhookEventsBatchArgs = {}) {
  const claimedEvents = await claimWebhookEvents({
    supabase,
    batchSize,
    maxAttempts,
  });
  const summary = {
    processed: claimedEvents.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const event of claimedEvents) {
    try {
      await processWebhookEvent({ event, supabase });
      await markEventDone({ supabase, event });
      summary.succeeded += 1;
    } catch (error) {
      await markEventError({ supabase, event, error, maxAttempts });
      summary.failed += 1;
    }
  }

  return summary;
}
