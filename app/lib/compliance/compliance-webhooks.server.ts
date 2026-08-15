import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkArray, mapWithConcurrency } from "../db/batch-query.server.ts";

const REDACT_BATCH_CONCURRENCY = 4;
const SHOP_REDACTION_TABLE_BATCH_SIZE = 2_000;
const SHOP_REDACTION_BATCHES_PER_TICK = 5;

export const SHOP_REDACTION_TABLES = [
  "webhook_events",
  "sync_jobs",
  "sync_runs",
  "order_transactions",
  "fixed_expenses",
  "user_location_access",
  "dashboard_memberships",
  "staff_identity_aliases",
  "staff_people",
  "order_lines",
  "orders",
  "inventory_levels",
  "inventory_items",
  "variants",
  "products",
  "locations",
  "staff_members",
  "sync_automation_state",
  "pos_attribution_setup",
  "shops",
] as const;

type SessionStore = {
  session: {
    deleteMany: (args: {
      where: {
        shop: string;
      };
    }) => Promise<{ count: number }>;
  };
};

type ComplianceStatus = "received" | "completed" | "failed";

type ComplianceEventDetails = Record<string, unknown>;

type ShopRedactionJobRow = {
  id: string;
  shop_domain: string;
  shopify_webhook_id: string | null;
  status: "pending" | "processing" | "completed" | "error";
  attempt_count: number;
  current_table_index: number;
  counts: Record<string, number>;
};

type CustomerCompliancePayload = {
  customer?: {
    id?: string | number | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  orders_requested?: Array<string | number> | null;
  orders_to_redact?: Array<string | number> | null;
  data_request?: {
    id?: string | number | null;
  } | null;
};

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getOrderIdCandidates(
  orderIds: Array<string | number> | null | undefined,
) {
  const candidates = new Set<string>();

  for (const rawOrderId of orderIds ?? []) {
    const orderId = String(rawOrderId).trim();
    if (!orderId) continue;

    candidates.add(orderId);
    candidates.add(`gid://shopify/Order/${orderId}`);
  }

  return Array.from(candidates);
}

export async function recordComplianceWebhookEvent({
  supabase,
  shop,
  topic,
  status,
  details = {},
}: {
  supabase: SupabaseClient;
  shop: string;
  topic: string;
  status: ComplianceStatus;
  details?: ComplianceEventDetails;
}) {
  const { error } = await supabase.from("compliance_webhook_events").insert({
    shop_domain: shop,
    topic,
    status,
    details,
  });

  if (error) {
    console.error(
      `Failed to record compliance webhook event for ${topic}.`,
      error,
    );
  }
}

export function getSafeCustomerRequestDetails(
  payload: CustomerCompliancePayload,
) {
  return {
    dataRequestId: payload.data_request?.id
      ? String(payload.data_request.id)
      : null,
    customerIdPresent: Boolean(payload.customer?.id),
    customerEmailPresent: Boolean(payload.customer?.email),
    customerPhonePresent: Boolean(payload.customer?.phone),
    ordersRequestedCount: payload.orders_requested?.length ?? 0,
  };
}

export async function redactCustomerOrderDisplayFields({
  supabase,
  shop,
  payload,
}: {
  supabase: SupabaseClient;
  shop: string;
  payload: CustomerCompliancePayload;
}) {
  const orderIdCandidates = getOrderIdCandidates(payload.orders_to_redact);

  if (orderIdCandidates.length === 0) {
    return {
      matchedByOrderIds: false,
      orderIdCandidateCount: 0,
      ordersUpdated: 0,
      orderLinesUpdated: 0,
    };
  }

  // .in() here is unavoidable (this redacts a specific customer's orders, not
  // a shop-wide date range), but batches no longer run one after another:
  // each batch's two updates run concurrently, and batches themselves run
  // with bounded concurrency, so one slow/failed batch doesn't stall every
  // batch after it. Any error still aborts the whole redaction (no silent
  // partial success) — same failure semantics as before.
  const batchResults = await mapWithConcurrency(
    chunkArray(orderIdCandidates, 100),
    REDACT_BATCH_CONCURRENCY,
    async (batch) => {
      const [ordersResult, orderLinesResult] = await Promise.all([
        supabase
          .from("orders")
          .update({ order_name: "Redacted order" })
          .eq("shop_domain", shop)
          .in("shopify_order_id", batch)
          .select("id"),
        supabase
          .from("order_lines")
          .update({ order_name: "Redacted order" })
          .eq("shop_domain", shop)
          .in("shopify_order_id", batch)
          .select("id"),
      ]);

      if (ordersResult.error) throw ordersResult.error;
      if (orderLinesResult.error) throw orderLinesResult.error;

      return {
        ordersUpdated: ordersResult.data?.length ?? 0,
        orderLinesUpdated: orderLinesResult.data?.length ?? 0,
      };
    },
  );

  let ordersUpdated = 0;
  let orderLinesUpdated = 0;
  for (const result of batchResults) {
    ordersUpdated += result.ordersUpdated;
    orderLinesUpdated += result.orderLinesUpdated;
  }

  return {
    matchedByOrderIds: true,
    orderIdCandidateCount: orderIdCandidates.length,
    ordersUpdated,
    orderLinesUpdated,
  };
}

async function getShopScopedRowCount({
  supabase,
  table,
  shop,
}: {
  supabase: SupabaseClient;
  table: string;
  shop: string;
}) {
  const { count, error } = await supabase
    .from(table)
    .select("shop_domain", { count: "exact", head: true })
    .eq("shop_domain", shop);

  if (error) throw error;

  return count ?? 0;
}

export async function deleteShopScopedSupabaseData({
  supabase,
  shop,
  sessionStore,
}: {
  supabase: SupabaseClient;
  shop: string;
  sessionStore: SessionStore;
}) {
  const deletedCounts: Record<string, number> = {};

  for (const table of SHOP_REDACTION_TABLES) {
    const rowCount = await getShopScopedRowCount({ supabase, table, shop });
    deletedCounts[table] = rowCount;

    const { error } = await supabase
      .from(table)
      .delete()
      .eq("shop_domain", shop);
    if (error) throw error;
  }

  await sessionStore.session.deleteMany({ where: { shop } });

  return deletedCounts;
}

function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}

export async function enqueueShopRedactionJob({
  supabase,
  shop,
  webhookId,
}: {
  supabase: SupabaseClient;
  shop: string;
  webhookId: string | null;
}) {
  const { data, error } = await supabase
    .from("shop_redaction_jobs")
    .insert({
      shop_domain: shop,
      shopify_webhook_id: webhookId,
      status: "pending",
      available_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error && !isUniqueViolation(error)) throw error;

  return {
    enqueued: Boolean(data?.id),
    duplicate: isUniqueViolation(error),
  };
}

function getShopRedactionRetryAt(attemptCount: number) {
  const minutes = Math.min(360, Math.max(1, attemptCount) * 10);
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function processShopRedactionJob({
  supabase,
  sessionStore,
  job,
  tableBatchSize,
  maxTableBatches,
}: {
  supabase: SupabaseClient;
  sessionStore: SessionStore;
  job: ShopRedactionJobRow;
  tableBatchSize: number;
  maxTableBatches: number;
}) {
  let currentTableIndex = Math.max(0, job.current_table_index);
  const counts = { ...(job.counts ?? {}) };
  let batchesProcessed = 0;

  try {
    // Session deletion is idempotent and happens before each continuation so a
    // redacted shop cannot regain application access while its larger tables
    // are being drained over multiple maintenance ticks.
    await sessionStore.session.deleteMany({
      where: { shop: job.shop_domain },
    });

    while (
      currentTableIndex < SHOP_REDACTION_TABLES.length &&
      batchesProcessed < maxTableBatches
    ) {
      const table = SHOP_REDACTION_TABLES[currentTableIndex];
      const { data, error } = await supabase.rpc("purge_shop_table_batch", {
        p_shop_domain: job.shop_domain,
        p_table_name: table,
        p_batch_size: tableBatchSize,
      });
      if (error) throw error;

      const deleted = Number(data ?? 0);
      counts[table] = Number(counts[table] ?? 0) + deleted;
      batchesProcessed += 1;

      if (deleted < tableBatchSize) currentTableIndex += 1;
    }

    const completed = currentTableIndex >= SHOP_REDACTION_TABLES.length;
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("shop_redaction_jobs")
      .update({
        status: completed ? "completed" : "pending",
        current_table_index: currentTableIndex,
        counts,
        last_error: null,
        available_at: now,
        processing_started_at: null,
        completed_at: completed ? now : null,
        updated_at: now,
      })
      .eq("id", job.id)
      .eq("status", "processing");
    if (updateError) throw updateError;

    if (completed) {
      await recordComplianceWebhookEvent({
        supabase,
        shop: job.shop_domain,
        topic: "SHOP_REDACT",
        status: "completed",
        details: {
          deletedCounts: counts,
          sessionsDeleted: true,
          retainedData: "Minimal compliance audit and redaction job only.",
        },
      });
    }

    return { completed, failed: false, batchesProcessed };
  } catch (error) {
    const now = new Date().toISOString();
    await supabase
      .from("shop_redaction_jobs")
      .update({
        status: "error",
        current_table_index: currentTableIndex,
        counts,
        last_error: toErrorMessage(error).slice(0, 1000),
        available_at: getShopRedactionRetryAt(job.attempt_count),
        processing_started_at: null,
        updated_at: now,
      })
      .eq("id", job.id)
      .eq("status", "processing");

    return { completed: false, failed: true, batchesProcessed };
  }
}

export async function processShopRedactionJobsBatch({
  supabase,
  sessionStore,
  batchSize = 2,
  tableBatchSize = SHOP_REDACTION_TABLE_BATCH_SIZE,
  maxTableBatches = SHOP_REDACTION_BATCHES_PER_TICK,
}: {
  supabase: SupabaseClient;
  sessionStore: SessionStore;
  batchSize?: number;
  tableBatchSize?: number;
  maxTableBatches?: number;
}) {
  const { data, error } = await supabase.rpc("claim_shop_redaction_jobs", {
    p_batch_size: Math.min(Math.max(Math.floor(batchSize), 1), 10),
    p_max_attempts: 10,
  });
  if (error) throw error;

  const jobs = (data ?? []) as ShopRedactionJobRow[];
  const results = await mapWithConcurrency(jobs, 2, (job) =>
    processShopRedactionJob({
      supabase,
      sessionStore,
      job,
      tableBatchSize,
      maxTableBatches,
    }),
  );

  return {
    claimed: jobs.length,
    completed: results.filter((result) => result.completed).length,
    continued: results.filter(
      (result) => !result.completed && !result.failed,
    ).length,
    failed: results.filter((result) => result.failed).length,
    batchesProcessed: results.reduce(
      (total, result) => total + result.batchesProcessed,
      0,
    ),
  };
}

export function getComplianceErrorDetails(error: unknown) {
  return {
    error: toErrorMessage(error),
  };
}
