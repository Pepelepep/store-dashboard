CREATE UNIQUE INDEX IF NOT EXISTS variants_shop_variant_uidx
    ON public.variants USING btree (shop_domain, shopify_variant_id);

CREATE INDEX IF NOT EXISTS variants_shop_inventory_item_idx
    ON public.variants USING btree (shop_domain, inventory_item_id);

CREATE INDEX IF NOT EXISTS order_lines_shop_variant_idx
    ON public.order_lines USING btree (shop_domain, shopify_variant_id);

CREATE UNIQUE INDEX IF NOT EXISTS orders_shop_order_uidx
    ON public.orders USING btree (shop_domain, shopify_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_shop_inventory_item_uidx
    ON public.inventory_items USING btree (shop_domain, inventory_item_id);

CREATE OR REPLACE FUNCTION public.update_variant_costs_from_inventory_items_for_shop(
    p_shop_domain text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    updated_count integer;
BEGIN
    UPDATE public.variants AS variant
    SET
        unit_cost = inventory_item.unit_cost,
        sku = COALESCE(variant.sku, inventory_item.sku),
        updated_at = now()
    FROM public.inventory_items AS inventory_item
    WHERE variant.shop_domain = p_shop_domain
        AND inventory_item.shop_domain = variant.shop_domain
        AND inventory_item.inventory_item_id = variant.inventory_item_id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_variant_costs_from_inventory_items(
    p_shop_domain text,
    p_inventory_item_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    updated_count integer;
BEGIN
    UPDATE public.variants AS variant
    SET
        unit_cost = inventory_item.unit_cost,
        sku = COALESCE(variant.sku, inventory_item.sku),
        updated_at = now()
    FROM public.inventory_items AS inventory_item
    WHERE variant.shop_domain = p_shop_domain
        AND variant.inventory_item_id = ANY(p_inventory_item_ids)
        AND inventory_item.shop_domain = variant.shop_domain
        AND inventory_item.inventory_item_id = variant.inventory_item_id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_order_line_cogs_for_shop(
    p_shop_domain text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    updated_count integer;
    fallback_count integer;
BEGIN
    UPDATE public.order_lines AS order_line
    SET
        unit_cost = CASE
            WHEN variant.unit_cost IS NOT NULL THEN variant.unit_cost
            ELSE NULL
        END,
        cogs = CASE
            WHEN variant.unit_cost IS NOT NULL THEN order_line.quantity * variant.unit_cost
            WHEN order_line.revenue > 0 THEN order_line.revenue * 0.5
            ELSE NULL
        END,
        gross_profit = CASE
            WHEN variant.unit_cost IS NOT NULL THEN
                order_line.revenue - (order_line.quantity * variant.unit_cost)
            WHEN order_line.revenue > 0 THEN order_line.revenue - (order_line.revenue * 0.5)
            ELSE NULL
        END,
        cost_source = CASE
            WHEN variant.unit_cost IS NOT NULL THEN 'recomputed_from_current_variant_cost'
            WHEN order_line.revenue > 0 THEN 'FALLBACK_50_PERCENT_CUSTOM_SALE'
            ELSE 'MISSING_COST'
        END
    FROM public.variants AS variant
    WHERE order_line.shop_domain = p_shop_domain
        AND variant.shop_domain = order_line.shop_domain
        AND variant.shopify_variant_id = order_line.shopify_variant_id
        AND variant.unit_cost IS NOT NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    UPDATE public.order_lines AS order_line
    SET
        unit_cost = NULL,
        cogs = CASE
            WHEN order_line.revenue > 0 THEN order_line.revenue * 0.5
            ELSE NULL
        END,
        gross_profit = CASE
            WHEN order_line.revenue > 0 THEN order_line.revenue - (order_line.revenue * 0.5)
            ELSE NULL
        END,
        cost_source = CASE
            WHEN order_line.revenue > 0 THEN 'FALLBACK_50_PERCENT_CUSTOM_SALE'
            ELSE 'MISSING_COST'
        END
    WHERE order_line.shop_domain = p_shop_domain
        AND NOT EXISTS (
            SELECT 1
            FROM public.variants AS variant
            WHERE variant.shop_domain = order_line.shop_domain
                AND variant.shopify_variant_id = order_line.shopify_variant_id
                AND variant.unit_cost IS NOT NULL
        );

    GET DIAGNOSTICS fallback_count = ROW_COUNT;

    RETURN updated_count + fallback_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_order_line_cogs_for_variants(
    p_shop_domain text,
    p_variant_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    updated_count integer;
    fallback_count integer;
BEGIN
    UPDATE public.order_lines AS order_line
    SET
        unit_cost = variant.unit_cost,
        cogs = order_line.quantity * variant.unit_cost,
        gross_profit = order_line.revenue - (order_line.quantity * variant.unit_cost),
        cost_source = 'recomputed_from_current_variant_cost'
    FROM public.variants AS variant
    WHERE order_line.shop_domain = p_shop_domain
        AND order_line.shopify_variant_id = ANY(p_variant_ids)
        AND variant.shop_domain = order_line.shop_domain
        AND variant.shopify_variant_id = order_line.shopify_variant_id
        AND variant.unit_cost IS NOT NULL;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    UPDATE public.order_lines AS order_line
    SET
        unit_cost = NULL,
        cogs = CASE
            WHEN order_line.revenue > 0 THEN order_line.revenue * 0.5
            ELSE NULL
        END,
        gross_profit = CASE
            WHEN order_line.revenue > 0 THEN order_line.revenue - (order_line.revenue * 0.5)
            ELSE NULL
        END,
        cost_source = CASE
            WHEN order_line.revenue > 0 THEN 'FALLBACK_50_PERCENT_CUSTOM_SALE'
            ELSE 'MISSING_COST'
        END
    WHERE order_line.shop_domain = p_shop_domain
        AND order_line.shopify_variant_id = ANY(p_variant_ids)
        AND NOT EXISTS (
            SELECT 1
            FROM public.variants AS variant
            WHERE variant.shop_domain = order_line.shop_domain
                AND variant.shopify_variant_id = order_line.shopify_variant_id
                AND variant.unit_cost IS NOT NULL
        );

    GET DIAGNOSTICS fallback_count = ROW_COUNT;

    RETURN updated_count + fallback_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_order_line_cogs_for_inventory_items(
    p_shop_domain text,
    p_inventory_item_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    variant_ids text[];
BEGIN
    SELECT COALESCE(array_agg(variant.shopify_variant_id), ARRAY[]::text[])
    INTO variant_ids
    FROM public.variants AS variant
    WHERE variant.shop_domain = p_shop_domain
        AND variant.inventory_item_id = ANY(p_inventory_item_ids);

    RETURN public.recompute_order_line_cogs_for_variants(
        p_shop_domain,
        variant_ids
    );
END;
$$;
