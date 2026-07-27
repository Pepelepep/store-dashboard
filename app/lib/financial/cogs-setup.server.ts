import { getSupabaseAdminClient } from "../db/supabase.server";

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdminClient>;

export const PRODUCT_COST_PAGE_SIZE = 25;

export type MissingProductCostRow = {
  key: string;
  product: string;
  variant: string;
  unitsSold: number;
  salesAffected: number;
  shopifyProductId: string | null;
};

export type MissingProductCostsPageData = {
  rows: MissingProductCostRow[];
  page: number;
  pageSize: number;
  search: string;
  totalCount: number;
};

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
  missingProducts: MissingProductCostsPageData;
};

type CoverageSummaryRpcRow = {
  actual_line_count: number | string | null;
  estimated_line_count: number | string | null;
  missing_line_count: number | string | null;
  missing_sales_amount: number | string | null;
  affected_product_count: number | string | null;
  actual_cogs: number | string | null;
  estimated_cogs: number | string | null;
  total_net_sales: number | string | null;
  product_missing_line_count: number | string | null;
  product_estimate_basis: number | string | null;
  custom_missing_line_count: number | string | null;
  custom_estimate_basis: number | string | null;
};

type MissingProductRpcRow = {
  group_key: string;
  product_title: string | null;
  variant_title: string | null;
  units_sold: number | string | null;
  sales_affected: number | string | null;
  shopify_product_id: string | null;
  total_count: number | string | null;
};

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadMissingProductCostsPage({
  supabase,
  shop,
  page = 1,
  search = "",
}: {
  supabase: SupabaseAdminClient;
  shop: string;
  page?: number;
  search?: string;
}): Promise<MissingProductCostsPageData> {
  const normalizedPage = Math.max(Math.floor(numberValue(page)), 1);
  const normalizedSearch = search.trim().slice(0, 120);
  const { data, error } = await supabase.rpc(
    "get_missing_product_costs_page",
    {
      p_shop_domain: shop,
      p_search: normalizedSearch || null,
      p_limit: PRODUCT_COST_PAGE_SIZE,
      p_offset: (normalizedPage - 1) * PRODUCT_COST_PAGE_SIZE,
    },
  );

  if (error) throw new Response(error.message, { status: 500 });

  const rpcRows = (data ?? []) as MissingProductRpcRow[];

  return {
    rows: rpcRows.map((row) => ({
      key: row.group_key,
      product: row.product_title?.trim() || "Custom sale",
      variant: row.variant_title?.trim() || "-",
      unitsSold: numberValue(row.units_sold),
      salesAffected: numberValue(row.sales_affected),
      shopifyProductId: row.shopify_product_id,
    })),
    page: normalizedPage,
    pageSize: PRODUCT_COST_PAGE_SIZE,
    search: normalizedSearch,
    totalCount: numberValue(rpcRows[0]?.total_count),
  };
}

export async function loadProductCostSetup({
  supabase,
  shop,
}: {
  supabase: SupabaseAdminClient;
  shop: string;
}): Promise<ProductCostSetupData> {
  const [
    { data: shopRow, error: shopError },
    coverageResult,
    missingProducts,
    syncResult,
  ] = await Promise.all([
    supabase
      .from("shops")
      .select(
        "cogs_estimate_enabled, cogs_estimate_percent, cogs_estimate_custom_sales, cogs_estimate_updated_at",
      )
      .eq("shop_domain", shop)
      .maybeSingle(),
    supabase.rpc("get_product_cost_coverage_summary", {
      p_shop_domain: shop,
    }),
    loadMissingProductCostsPage({ supabase, shop }),
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
  if (coverageResult.error) {
    throw new Response(coverageResult.error.message, { status: 500 });
  }
  if (syncResult.error) {
    throw new Response(syncResult.error.message, { status: 500 });
  }

  const summary = (
    (coverageResult.data ?? []) as CoverageSummaryRpcRow[]
  )[0] ?? {
    actual_line_count: 0,
    estimated_line_count: 0,
    missing_line_count: 0,
    missing_sales_amount: 0,
    affected_product_count: 0,
    actual_cogs: 0,
    estimated_cogs: 0,
    total_net_sales: 0,
    product_missing_line_count: 0,
    product_estimate_basis: 0,
    custom_missing_line_count: 0,
    custom_estimate_basis: 0,
  };

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
      actualLineCount: numberValue(summary.actual_line_count),
      estimatedLineCount: numberValue(summary.estimated_line_count),
      missingLineCount: numberValue(summary.missing_line_count),
      missingSalesAmount: numberValue(summary.missing_sales_amount),
      affectedProductCount: numberValue(summary.affected_product_count),
      actualCogs: numberValue(summary.actual_cogs),
      estimatedCogs: numberValue(summary.estimated_cogs),
      lastCalculatedAt:
        shopRow?.cogs_estimate_updated_at ??
        syncResult.data?.finished_at ??
        null,
    },
    previewBasis: {
      totalNetSales: numberValue(summary.total_net_sales),
      actualCogs: numberValue(summary.actual_cogs),
      productMissingLineCount: numberValue(
        summary.product_missing_line_count,
      ),
      productEstimateBasis: numberValue(summary.product_estimate_basis),
      customMissingLineCount: numberValue(summary.custom_missing_line_count),
      customEstimateBasis: numberValue(summary.custom_estimate_basis),
    },
    missingProducts,
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
