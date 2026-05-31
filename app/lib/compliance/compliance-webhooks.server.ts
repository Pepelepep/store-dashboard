import type { SupabaseClient } from "@supabase/supabase-js";

import db from "../../db.server";

const SHOP_SCOPED_TABLES_TO_DELETE = [
  "sync_jobs",
  "sync_runs",
  "fixed_expenses",
  "user_location_access",
  "order_lines",
  "orders",
  "inventory_levels",
  "inventory_items",
  "variants",
  "products",
  "locations",
  "staff_members",
  "shops",
] as const;

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

function getOrderIdCandidates(orderIds: Array<string | number> | null | undefined) {
  const candidates = new Set<string>();

  for (const rawOrderId of orderIds ?? []) {
    const orderId = String(rawOrderId).trim();
    if (!orderId) continue;

    candidates.add(orderId);
    candidates.add(`gid://shopify/Order/${orderId}`);
  }

  return Array.from(candidates);
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
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
    console.error(`Failed to record compliance webhook event for ${topic}.`, error);
  }
}

export function getSafeCustomerRequestDetails(payload: CustomerCompliancePayload) {
  return {
    dataRequestId: payload.data_request?.id ? String(payload.data_request.id) : null,
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

  let ordersUpdated = 0;
  let orderLinesUpdated = 0;

  for (const batch of chunkArray(orderIdCandidates, 100)) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .update({ order_name: "Redacted order" })
      .eq("shop_domain", shop)
      .in("shopify_order_id", batch)
      .select("id");

    if (ordersError) throw ordersError;
    ordersUpdated += orders?.length ?? 0;

    const { data: orderLines, error: orderLinesError } = await supabase
      .from("order_lines")
      .update({ order_name: "Redacted order" })
      .eq("shop_domain", shop)
      .in("shopify_order_id", batch)
      .select("id");

    if (orderLinesError) throw orderLinesError;
    orderLinesUpdated += orderLines?.length ?? 0;
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
    .select("id", { count: "exact", head: true })
    .eq("shop_domain", shop);

  if (error) throw error;

  return count ?? 0;
}

export async function deleteShopScopedSupabaseData({
  supabase,
  shop,
}: {
  supabase: SupabaseClient;
  shop: string;
}) {
  const deletedCounts: Record<string, number> = {};

  for (const table of SHOP_SCOPED_TABLES_TO_DELETE) {
    const rowCount = await getShopScopedRowCount({ supabase, table, shop });
    deletedCounts[table] = rowCount;

    const { error } = await supabase.from(table).delete().eq("shop_domain", shop);
    if (error) throw error;
  }

  await db.session.deleteMany({ where: { shop } });

  return deletedCounts;
}

export function getComplianceErrorDetails(error: unknown) {
  return {
    error: toErrorMessage(error),
  };
}
