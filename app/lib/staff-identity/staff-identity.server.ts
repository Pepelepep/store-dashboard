import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getStaffIdentityAliasCandidates,
  staffIdentityAliasKey,
  type StaffAliasType,
  type StaffIdentityAliasRow,
  type StaffIdentityOrderLine,
} from "./staff-identity";
import { fetchAllSupabasePages } from "../db/supabase-pagination.server";
import { chunkArray, mapWithConcurrency } from "../db/batch-query.server.ts";

const STAFF_ALIAS_VALUE_BATCH_SIZE = 100;
const STAFF_ALIAS_BATCH_CONCURRENCY = 4;

export async function fetchStaffIdentityAliasesForOrderLines({
  supabase,
  shop,
  orderLines,
}: {
  supabase: SupabaseClient;
  shop: string;
  orderLines: StaffIdentityOrderLine[];
}) {
  const valuesByType = new Map<StaffAliasType, Set<string>>();

  for (const line of orderLines) {
    for (const candidate of getStaffIdentityAliasCandidates(line)) {
      const values = valuesByType.get(candidate.aliasType) ?? new Set<string>();
      values.add(candidate.aliasValue);
      valuesByType.set(candidate.aliasType, values);
    }
  }

  const batchTasks: Array<{ aliasType: StaffAliasType; aliasValueBatch: string[] }> = [];

  for (const [aliasType, values] of valuesByType) {
    const aliasValues = Array.from(values);

    if (aliasValues.length === 0) continue;

    for (const aliasValueBatch of chunkArray(
      aliasValues,
      STAFF_ALIAS_VALUE_BATCH_SIZE,
    )) {
      batchTasks.push({ aliasType, aliasValueBatch });
    }
  }

  // staff_identity_aliases has no shop-scoped date/range column, so unlike
  // the refund-transactions query this .in() can't be dropped in favor of a
  // plain range scan — it genuinely needs the alias-value list. Running the
  // batches with bounded concurrency instead of one-at-a-time keeps a single
  // slow/failed batch from blocking every other alias type/chunk.
  const batchResults = await mapWithConcurrency(
    batchTasks,
    STAFF_ALIAS_BATCH_CONCURRENCY,
    ({ aliasType, aliasValueBatch }) =>
      fetchAllSupabasePages<StaffIdentityAliasRow>({
        label: "Staff identity aliases",
        getRowKey: (alias) => alias.id,
        fetchPage: (from, to) =>
          supabase
            .from("staff_identity_aliases")
            .select(
              "id, shop_domain, person_id, alias_type, alias_value, source, review_status, suggestion_dismissed_at, first_seen_at, last_seen_at, last_location_id, last_device_id, last_device_name, created_at, updated_at, staff_people!staff_identity_aliases_shop_person_fkey(id, shop_domain, display_name, email, is_active, created_at, updated_at)",
            )
            .eq("shop_domain", shop)
            .eq("alias_type", aliasType)
            .in("alias_value", aliasValueBatch)
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: StaffIdentityAliasRow[] | null;
            error: { message: string } | null;
          }>,
      }),
  );

  const aliasesByKey = new Map<string, StaffIdentityAliasRow>();

  for (const aliases of batchResults) {
    for (const alias of aliases) {
      aliasesByKey.set(
        staffIdentityAliasKey(alias.alias_type, alias.alias_value),
        alias,
      );
    }
  }

  return aliasesByKey;
}

export async function upsertPosStaffIdentityAliasesFromOrderLines({
  supabase,
  shop,
  orderLines,
}: {
  supabase: SupabaseClient;
  shop: string;
  orderLines: StaffIdentityOrderLine[];
}) {
  const aliasRowsByKey = new Map<
    string,
    {
      shop_domain: string;
      alias_type: StaffAliasType;
      alias_value: string;
      source: string;
      first_seen_at: string;
      last_seen_at: string;
      last_location_id: string | null;
      last_device_id: string | null;
      last_device_name: string | null;
    }
  >();

  for (const line of orderLines) {
    const seenAt = line.created_at_shopify ?? new Date().toISOString();

    for (const candidate of getStaffIdentityAliasCandidates(line)) {
      const key = staffIdentityAliasKey(candidate.aliasType, candidate.aliasValue);
      const existing = aliasRowsByKey.get(key);

      if (existing && existing.last_seen_at >= seenAt) {
        continue;
      }

      aliasRowsByKey.set(key, {
        shop_domain: shop,
        alias_type: candidate.aliasType,
        alias_value: candidate.aliasValue,
        source: line.shopops_attribution_source ?? "order_line_sync",
        first_seen_at: existing?.first_seen_at ?? seenAt,
        last_seen_at: seenAt,
        last_location_id: line.shopops_pos_location_id ?? null,
        last_device_id: line.shopops_pos_device_id ?? null,
        last_device_name: line.shopops_pos_device_name ?? null,
      });
    }

  }

  const aliasRows = Array.from(aliasRowsByKey.values());

  if (aliasRows.length === 0) {
    return;
  }

  const existingAliases = await fetchStaffIdentityAliasesForOrderLines({
    supabase,
    shop,
    orderLines,
  });
  const rows = aliasRows.map((row) => {
    const existing = existingAliases.get(
      staffIdentityAliasKey(row.alias_type, row.alias_value),
    );

    return {
      ...row,
      person_id: existing?.person_id ?? null,
      first_seen_at: existing?.first_seen_at ?? row.first_seen_at,
      updated_at: new Date().toISOString(),
      review_status: existing?.person_id ? "mapped" : (existing?.review_status ?? "pending"),
    };
  });

  const { error } = await supabase
    .from("staff_identity_aliases")
    .upsert(rows, { onConflict: "shop_domain,alias_type,alias_value" });

  if (error) {
    throw new Error(error.message);
  }
}
