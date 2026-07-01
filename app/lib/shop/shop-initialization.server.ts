import type { SupabaseClient } from "@supabase/supabase-js";

type ShopInitializationResult = {
  inserted: boolean;
};

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
    .select("shop_domain")
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

  if (existingShop) {
    return { inserted: false };
  }

  console.info("[fresh-install:init] missing shop row", {
    route,
    shop,
    missingShopRow: true,
  });

  const { error: upsertError } = await supabase.from("shops").upsert(
    {
      shop_domain: shop,
      shop_name: shop,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_domain" },
  );

  if (upsertError) {
    console.error("[fresh-install:init] shop upsert failed", {
      route,
      shop,
      error: upsertError.message,
    });
    throw new Response(upsertError.message, { status: 500 });
  }

  return { inserted: true };
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
