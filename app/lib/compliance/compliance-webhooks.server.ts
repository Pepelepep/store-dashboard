import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkArray, mapWithConcurrency } from "../db/batch-query.server.ts";

const REDACT_BATCH_CONCURRENCY = 4;

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

export function getComplianceErrorDetails(error: unknown) {
  return {
    error: toErrorMessage(error),
  };
}
