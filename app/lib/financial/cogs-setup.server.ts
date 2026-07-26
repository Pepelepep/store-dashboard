import { getSupabaseAdminClient } from "../db/supabase.server";
import {
  calculateRemainingLineCogs,
  getPreDiscountUnitPrice,
  getActualUnitCost,
  getRemainingProductQuantity,
  summarizeCogs,
  type EstimateLine,
} from "./cogs";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

export type ProductCostSetupData = {
  settings: {
    enabled: boolean;
    percent: number | null;
    estimateCustomSales: boolean;
    updatedAt: string | null;
  };
  coverage: {
    actualLineCount: number;
    estimatedLineCount: number;
    missingLineCount: number;
    missingSalesAmount: number;
    affectedProductCount: number;
    actualCogs: number;
    estimatedCogs: number;
    lastCalculatedAt: string | null;
  };
  previewBasis: {
    totalNetSales: number;
    actualCogs: number;
    productMissingLineCount: number;
    productEstimateBasis: number;
    customMissingLineCount: number;
    customEstimateBasis: number;
  };
  missingProducts: Array<{
    key: string;
    product: string;
    variant: string;
    unitsSold: number;
    salesAffected: number;
    shopifyProductId: string | null;
  }>;
};

type SetupOrderLine = EstimateLine & {
  shopify_line_item_id: string;
  product_title: string | null;
  variant_title: string | null;
  shopify_variant_id: string | null;
};

async function fetchAllOrderLines({
  supabase,
  shop,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
}) {
  const rows: SetupOrderLine[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("order_lines")
      .select(
        "shopify_line_item_id, product_title, variant_title, shopify_variant_id, quantity, returned_quantity, unit_price, gross_sales, net_sales, revenue, cost_at_sale, unit_cost, cogs, cost_source",
      )
      .eq("shop_domain", shop)
      .order("created_at_shopify", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw new Response(error.message, { status: 500 });

    const page = (data ?? []) as SetupOrderLine[];
    rows.push(...page);

    if (page.length < pageSize) return rows;
  }
}

async function fetchProductIdsByVariant({
  supabase,
  shop,
  variantIds,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  variantIds: string[];
}) {
  const result = new Map<string, string>();
  const uniqueIds = Array.from(new Set(variantIds)).filter(Boolean);

  for (let index = 0; index < uniqueIds.length; index += 500) {
    const batch = uniqueIds.slice(index, index + 500);
    const { data, error } = await supabase
      .from("variants")
      .select("shopify_variant_id, shopify_product_id")
      .eq("shop_domain", shop)
      .in("shopify_variant_id", batch);

    if (error) throw new Response(error.message, { status: 500 });

    for (const row of data ?? []) {
      if (row.shopify_product_id) {
        result.set(row.shopify_variant_id, row.shopify_product_id);
      }
    }
  }

  return result;
}

export async function loadProductCostSetup({
  supabase,
  shop,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
}): Promise<ProductCostSetupData> {
  const [{ data: shopRow, error: shopError }, orderLines, syncResult] =
    await Promise.all([
      supabase
        .from("shops")
        .select(
          "cogs_estimate_enabled, cogs_estimate_percent, cogs_estimate_custom_sales, cogs_estimate_updated_at",
        )
        .eq("shop_domain", shop)
        .maybeSingle(),
      fetchAllOrderLines({ supabase, shop }),
      supabase
        .from("sync_runs")
        .select("finished_at")
        .eq("shop_domain", shop)
        .eq("status", "success")
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (shopError) throw new Response(shopError.message, { status: 500 });
  if (syncResult.error) {
    throw new Response(syncResult.error.message, { status: 500 });
  }

  const summary = summarizeCogs(orderLines);
  const missingLines = orderLines.filter(
    (line) => calculateRemainingLineCogs(line) === null,
  );
  const productIdsByVariant = await fetchProductIdsByVariant({
    supabase,
    shop,
    variantIds: missingLines
      .map((line) => line.shopify_variant_id)
      .filter((value): value is string => Boolean(value)),
  });
  const missingGroups = new Map<
    string,
    ProductCostSetupData["missingProducts"][number]
  >();
  let missingSalesAmount = 0;
  let totalNetSales = 0;
  let productMissingLineCount = 0;
  let productEstimateBasis = 0;
  let customMissingLineCount = 0;
  let customEstimateBasis = 0;

  for (const line of orderLines) {
    totalNetSales += Number(line.net_sales ?? line.revenue ?? 0);
    const isCustom = !line.shopify_variant_id;
    const remainingQuantity = getRemainingProductQuantity(line);

    if (remainingQuantity > 0 && getActualUnitCost(line) === null) {
      const estimateBasis =
        getPreDiscountUnitPrice(line) * remainingQuantity;

      if (isCustom) {
        customMissingLineCount += 1;
        customEstimateBasis += estimateBasis;
      } else {
        productMissingLineCount += 1;
        productEstimateBasis += estimateBasis;
      }
    }

    if (calculateRemainingLineCogs(line) !== null) continue;

    const salesAffected = Number(line.net_sales ?? line.revenue ?? 0);
    const key = line.shopify_variant_id
      ? `variant:${line.shopify_variant_id}`
      : `custom:${line.product_title ?? "Custom sale"}:${line.variant_title ?? ""}`;
    const existing = missingGroups.get(key) ?? {
      key,
      product: line.product_title?.trim() || "Custom sale",
      variant: line.variant_title?.trim() || (isCustom ? "Custom sale" : "-"),
      unitsSold: 0,
      salesAffected: 0,
      shopifyProductId: line.shopify_variant_id
        ? (productIdsByVariant.get(line.shopify_variant_id) ?? null)
        : null,
    };

    existing.unitsSold += remainingQuantity;
    existing.salesAffected += salesAffected;
    missingGroups.set(key, existing);
    missingSalesAmount += salesAffected;
  }

  return {
    settings: {
      enabled: Boolean(shopRow?.cogs_estimate_enabled),
      percent:
        shopRow?.cogs_estimate_percent === null ||
        shopRow?.cogs_estimate_percent === undefined
          ? null
          : Number(shopRow.cogs_estimate_percent),
      estimateCustomSales: Boolean(shopRow?.cogs_estimate_custom_sales),
      updatedAt: shopRow?.cogs_estimate_updated_at ?? null,
    },
    coverage: {
      actualLineCount: summary.actualCogsLineCount,
      estimatedLineCount: summary.estimatedCogsLineCount,
      missingLineCount: summary.missingCogsLineCount,
      missingSalesAmount,
      affectedProductCount: missingGroups.size,
      actualCogs: summary.actualCogs,
      estimatedCogs: summary.estimatedCogs,
      lastCalculatedAt:
        shopRow?.cogs_estimate_updated_at ??
        syncResult.data?.finished_at ??
        null,
    },
    previewBasis: {
      totalNetSales,
      actualCogs: summary.actualCogs,
      productMissingLineCount,
      productEstimateBasis,
      customMissingLineCount,
      customEstimateBasis,
    },
    missingProducts: Array.from(missingGroups.values())
      .sort((a, b) => b.salesAffected - a.salesAffected)
      .slice(0, 10),
  };
}

export async function saveProductCostSettings({
  supabase,
  shop,
  enabled,
  percent,
  estimateCustomSales,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  enabled: boolean;
  percent: number | null;
  estimateCustomSales: boolean;
}) {
  const { data, error } = await supabase.rpc(
    "update_shop_cogs_estimate_settings",
    {
      p_shop_domain: shop,
      p_enabled: enabled,
      p_percent: enabled ? percent : null,
      p_estimate_custom_sales: enabled && estimateCustomSales,
    },
  );

  if (error) {
    throw new Response(error.message, { status: 500 });
  }

  return typeof data === "number" ? data : Number(data ?? 0);
}
