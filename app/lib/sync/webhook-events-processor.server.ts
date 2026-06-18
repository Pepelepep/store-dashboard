import { getSupabaseAdminClient } from "../db/supabase.server";
import prisma from "../../db.server";
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
import {
  enqueueOrdersReconciliation48hJob,
  getRunnableOrdersReconciliation48hJobs,
  processManualSyncJobBatch,
} from "./sync-jobs.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

type ProcessWebhookEventsBatchArgs = {
  supabase?: SupabaseAdminClient;
  batchSize?: number;
  maxAttempts?: number;
  maxReconciliationJobs?: number;
  maxReconciliationShops?: number;
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
const DEFAULT_MAX_RECONCILIATION_JOBS = 2;
const DEFAULT_MAX_RECONCILIATION_SHOPS = 25;
const MISSING_INVENTORY_LEVEL_PAYLOAD_ERROR =
  "Missing inventory_item_id/location_id/available in inventory level webhook payload";

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

function getPayloadString(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function toShopifyGid(resource: string, value: unknown) {
  const id = getPayloadString(value);

  if (!id) {
    return null;
  }

  if (id.startsWith("gid://")) {
    return id;
  }

  return `gid://shopify/${resource}/${id}`;
}

function isInventoryLevelTopic(topic: string) {
  return (
    topic === "inventory/levels/update" ||
    topic === "inventory-levels/update" ||
    topic === "inventory_levels/update"
  );
}

function getInventoryItemUpdate(
  event: WebhookEventRow,
): InventoryItemUpdate | null {
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

function getInventoryLevelAvailable(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const available = Number(value);
  return Number.isFinite(available) ? available : null;
}

function getInventoryLevelSyncedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return new Date().toISOString();
  }

  const updatedAt = new Date(value);
  return Number.isNaN(updatedAt.getTime())
    ? new Date().toISOString()
    : updatedAt.toISOString();
}

async function upsertInventoryLevelFromWebhook({
  event,
  supabase,
}: {
  event: WebhookEventRow;
  supabase: SupabaseAdminClient;
}) {
  if (!isRecord(event.payload)) {
    throw new Error(MISSING_INVENTORY_LEVEL_PAYLOAD_ERROR);
  }

  const inventoryItemId = toShopifyGid(
    "InventoryItem",
    event.payload.inventory_item_id,
  );
  const locationId = toShopifyGid("Location", event.payload.location_id);
  const available = getInventoryLevelAvailable(event.payload.available);

  if (!inventoryItemId || !locationId || available === null) {
    throw new Error(MISSING_INVENTORY_LEVEL_PAYLOAD_ERROR);
  }

  const syncedAt = getInventoryLevelSyncedAt(event.payload.updated_at);
  const row = {
    available,
    synced_at: syncedAt,
  };

  const { data: updatedRows, error: updateError } = await supabase
    .from("inventory_levels")
    .update(row)
    .eq("shop_domain", event.shop_domain)
    .eq("shopify_location_id", locationId)
    .eq("inventory_item_id", inventoryItemId)
    .select("id");

  if (updateError) {
    throw new Error(updateError.message);
  }

  if ((updatedRows ?? []).length > 0) {
    return;
  }

  const { error: insertError } = await supabase
    .from("inventory_levels")
    .insert({
      shop_domain: event.shop_domain,
      shopify_location_id: locationId,
      inventory_item_id: inventoryItemId,
      available,
      synced_at: syncedAt,
    });

  if (insertError) {
    throw new Error(insertError.message);
  }
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
    topic === "inventory_items/update"
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

  if (isInventoryLevelTopic(topic)) {
    await upsertInventoryLevelFromWebhook({ event, supabase });
    return;
  }

  throw new Error(`Unsupported webhook topic: ${event.topic}.`);
}

async function getInstalledShopDomains(limit: number) {
  const sessions = await prisma.session.findMany({
    where: {
      isOnline: false,
    },
    select: {
      shop: true,
    },
    distinct: ["shop"],
    orderBy: {
      shop: "asc",
    },
    take: limit,
  });

  return sessions.map((session) => session.shop).filter(Boolean);
}

async function enqueueDueOrdersReconciliationJobs({
  supabase,
  shopLimit,
}: {
  supabase: SupabaseAdminClient;
  shopLimit: number;
}) {
  const shops = await getInstalledShopDomains(shopLimit);
  const summary = {
    shopsChecked: shops.length,
    enqueued: 0,
    skipped: 0,
    failed: 0,
  };

  for (const shop of shops) {
    try {
      const result = await enqueueOrdersReconciliation48hJob({
        supabase,
        shop,
      });

      if (result.enqueued) {
        summary.enqueued += 1;
      } else {
        summary.skipped += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}

async function processOrdersReconciliationJobs({
  supabase,
  jobLimit,
}: {
  supabase: SupabaseAdminClient;
  jobLimit: number;
}) {
  const jobs = await getRunnableOrdersReconciliation48hJobs({
    supabase,
    limit: jobLimit,
  });
  const summary = {
    jobsChecked: jobs.length,
    processed: 0,
    completed: 0,
    failed: 0,
  };

  for (const job of jobs) {
    try {
      const admin = await getOfflineAdminClient(job.shop_domain);
      const result = await processManualSyncJobBatch({
        admin,
        supabase,
        shop: job.shop_domain,
        jobId: job.id,
      });

      if (result.processed) {
        summary.processed += 1;
      }

      if (result.job.status === "success") {
        summary.completed += 1;
      } else if (result.job.status === "error") {
        summary.failed += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}

export async function processWebhookEventsBatch({
  supabase = getSupabaseAdminClient(),
  batchSize = DEFAULT_BATCH_SIZE,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  maxReconciliationJobs = DEFAULT_MAX_RECONCILIATION_JOBS,
  maxReconciliationShops = DEFAULT_MAX_RECONCILIATION_SHOPS,
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

  const reconciliationEnqueue = await enqueueDueOrdersReconciliationJobs({
    supabase,
    shopLimit: maxReconciliationShops,
  });
  const reconciliationProcessing = await processOrdersReconciliationJobs({
    supabase,
    jobLimit: maxReconciliationJobs,
  });

  return {
    ...summary,
    ordersReconciliation: {
      enqueue: reconciliationEnqueue,
      processing: reconciliationProcessing,
    },
  };
}
