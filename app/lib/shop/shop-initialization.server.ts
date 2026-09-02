import type { SupabaseClient } from "@supabase/supabase-js";

import { createManualSyncJob } from "../sync/sync-jobs.server";

type ShopInitializationResult = {
  inserted: boolean;
};

// Operational history alone does not prove that merchant business data exists.
// A shop with only old jobs/runs/webhooks still needs its initial rebuild.
const legacyBusinessFootprintTables = [
  "fixed_expenses",
  "locations",
  "products",
  "variants",
  "inventory_levels",
  "inventory_items",
  "orders",
  "order_lines",
  "order_transactions",
  "staff_people",
  "staff_identity_aliases",
  "user_location_access",
] as const;

async function hasExistingShopFootprint({
  shop,
  supabase,
}: {
  shop: string;
  supabase: SupabaseClient;
}) {
  const results = await Promise.all(
    legacyBusinessFootprintTables.map(async (table) => {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", shop);

      if (error) throw new Error(`${table}: ${error.message}`);
      return (count ?? 0) > 0;
    }),
  );

  return results.some(Boolean);
}

// A footprint of leftover rows (e.g. from webhooks trickling in, or a prior
// partial sync) does not prove full order history was ever imported — only a
// full_refresh reaching "success" does, since that is the only job type that
// pulls unbounded (not just a 7-day) order history. Without this check, a
// reinstalled shop with a partial footprint would never get its historical
// rebuild queued.
async function hasCompletedFullHistorySync({
  shop,
  supabase,
}: {
  shop: string;
  supabase: SupabaseClient;
}) {
  const { count, error } = await supabase
    .from("sync_jobs")
    .select("*", { count: "exact", head: true })
    .eq("shop_domain", shop)
    .eq("job_type", "full_refresh")
    .eq("status", "success");

  if (error) throw new Error(`sync_jobs: ${error.message}`);
  return (count ?? 0) > 0;
}

async function ensureOptionalShopState({
  shop,
  supabase,
}: {
  shop: string;
  supabase: SupabaseClient;
}) {
  const [automationResult, posSetupResult] = await Promise.all([
    supabase
      .from("sync_automation_state")
      .upsert(
        { shop_domain: shop },
        { onConflict: "shop_domain", ignoreDuplicates: true },
      ),
    supabase
      .from("pos_attribution_setup")
      .upsert(
        { shop_domain: shop },
        { onConflict: "shop_domain", ignoreDuplicates: true },
      ),
  ]);

  if (automationResult.error) {
    throw new Error(`sync_automation_state: ${automationResult.error.message}`);
  }
  if (posSetupResult.error) {
    throw new Error(`pos_attribution_setup: ${posSetupResult.error.message}`);
  }
}

export async function ensureShopInitialized({
  route,
  shop,
  supabase,
}: {
  route: string;
  shop: string;
  supabase: SupabaseClient;
}): Promise<ShopInitializationResult> {
  const { data: existingShop, error: selectError } = await supabase
    .from("shops")
    .select("shop_domain, marketplace_initialized_at")
    .eq("shop_domain", shop)
    .maybeSingle();

  if (selectError) {
    console.error("[fresh-install:init] shop lookup failed", {
      route,
      shop,
      error: selectError.message,
    });
    throw new Response(selectError.message, { status: 500 });
  }

  let inserted = false;
  if (!existingShop) {
    console.info("[shop:init] missing shop row", {
      route,
      shop,
      missingShopRow: true,
    });

    const { error: insertError } = await supabase.from("shops").insert({
      shop_domain: shop,
      shop_name: shop,
      updated_at: new Date().toISOString(),
    });

    if (insertError?.code === "23505") {
      console.info("[shop:init] concurrent shop initialization reused", {
        route,
        shop,
      });
    } else if (insertError) {
      console.error("[shop:init] shop insert failed", {
        route,
        shop,
        error: insertError.message,
      });
      throw new Response(insertError.message, { status: 500 });
    } else {
      inserted = true;
    }
  }

  try {
    if (existingShop?.marketplace_initialized_at) {
      await ensureOptionalShopState({ shop, supabase });
      return { inserted };
    }

    const hasExistingFootprint = await hasExistingShopFootprint({
      shop,
      supabase,
    });
    const hasCompletedFullHistory = hasExistingFootprint
      ? await hasCompletedFullHistorySync({ shop, supabase })
      : false;

    await ensureOptionalShopState({ shop, supabase });

    if (!hasExistingFootprint || !hasCompletedFullHistory) {
      const initialSync = await createManualSyncJob({
        supabase,
        shop,
        jobType: "full_refresh",
        trigger: "initial_setup",
      });
      console.info("[shop:init] initial rebuild ready", {
        route,
        shop,
        reused: initialSync.reused,
        hadPartialFootprint: hasExistingFootprint,
      });
    } else if (inserted) {
      console.info("[shop:init] legacy shop footprint preserved", {
        route,
        shop,
      });
    }

    const { error: initializedError } = await supabase
      .from("shops")
      .update({ marketplace_initialized_at: new Date().toISOString() })
      .eq("shop_domain", shop)
      .is("marketplace_initialized_at", null);
    if (initializedError) {
      throw new Error(`shops: ${initializedError.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[shop:init] initialization failed", {
      route,
      shop,
      error: message,
    });
    throw new Response(message, { status: 500 });
  }

  return { inserted };
}

export function logEmptyDataState({
  route,
  shop,
  reason,
  counts,
}: {
  route: string;
  shop: string;
  reason: string;
  counts?: Record<string, number>;
}) {
  console.info("[fresh-install:empty-data]", {
    route,
    shop,
    reason,
    counts,
  });
}
