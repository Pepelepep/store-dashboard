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
BEGIN
    WITH resolved_costs AS (
        SELECT
            order_line.id,
            COALESCE(order_line.cost_at_sale, variant.unit_cost) AS unit_cost,
            CASE
                WHEN order_line.cost_at_sale IS NOT NULL THEN
                    COALESCE(
                        NULLIF(order_line.cost_at_sale_source, ''),
                        'SHOPIFY_UNIT_COST_AT_SALE'
                    )
                WHEN variant.unit_cost IS NOT NULL THEN
                    'recomputed_from_current_variant_cost'
                ELSE
                    'MISSING_COST'
            END AS cost_source
        FROM public.order_lines AS order_line
        LEFT JOIN public.variants AS variant
            ON variant.shop_domain = order_line.shop_domain
            AND variant.shopify_variant_id = order_line.shopify_variant_id
        WHERE order_line.shop_domain = p_shop_domain
    )
    UPDATE public.order_lines AS order_line
    SET
        unit_cost = resolved_cost.unit_cost,
        cogs = CASE
            WHEN resolved_cost.unit_cost IS NULL THEN NULL
            ELSE
                GREATEST(
                    COALESCE(order_line.quantity, 0)
                        - COALESCE(order_line.returned_quantity, 0),
                    0
                ) * resolved_cost.unit_cost
        END,
        gross_profit = CASE
            WHEN resolved_cost.unit_cost IS NULL THEN NULL
            ELSE
                COALESCE(order_line.net_sales, order_line.revenue, 0)
                    - (
                        GREATEST(
                            COALESCE(order_line.quantity, 0)
                                - COALESCE(order_line.returned_quantity, 0),
                            0
                        ) * resolved_cost.unit_cost
                    )
        END,
        cost_source = resolved_cost.cost_source
    FROM resolved_costs AS resolved_cost
    WHERE order_line.id = resolved_cost.id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count;
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
BEGIN
    WITH resolved_costs AS (
        SELECT
            order_line.id,
            COALESCE(order_line.cost_at_sale, variant.unit_cost) AS unit_cost,
            CASE
                WHEN order_line.cost_at_sale IS NOT NULL THEN
                    COALESCE(
                        NULLIF(order_line.cost_at_sale_source, ''),
                        'SHOPIFY_UNIT_COST_AT_SALE'
                    )
                WHEN variant.unit_cost IS NOT NULL THEN
                    'recomputed_from_current_variant_cost'
                ELSE
                    'MISSING_COST'
            END AS cost_source
        FROM public.order_lines AS order_line
        LEFT JOIN public.variants AS variant
            ON variant.shop_domain = order_line.shop_domain
            AND variant.shopify_variant_id = order_line.shopify_variant_id
        WHERE order_line.shop_domain = p_shop_domain
            AND order_line.shopify_variant_id = ANY(p_variant_ids)
    )
    UPDATE public.order_lines AS order_line
    SET
        unit_cost = resolved_cost.unit_cost,
        cogs = CASE
            WHEN resolved_cost.unit_cost IS NULL THEN NULL
            ELSE
                GREATEST(
                    COALESCE(order_line.quantity, 0)
                        - COALESCE(order_line.returned_quantity, 0),
                    0
                ) * resolved_cost.unit_cost
        END,
        gross_profit = CASE
            WHEN resolved_cost.unit_cost IS NULL THEN NULL
            ELSE
                COALESCE(order_line.net_sales, order_line.revenue, 0)
                    - (
                        GREATEST(
                            COALESCE(order_line.quantity, 0)
                                - COALESCE(order_line.returned_quantity, 0),
                            0
                        ) * resolved_cost.unit_cost
                    )
        END,
        cost_source = resolved_cost.cost_source
    FROM resolved_costs AS resolved_cost
    WHERE order_line.id = resolved_cost.id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count;
END;
$$;

WITH historical_rows AS (
    SELECT
        order_line.id,
        COALESCE(order_line.cost_at_sale, variant.unit_cost) AS unit_cost,
        CASE
            WHEN order_line.cost_at_sale IS NOT NULL THEN
                COALESCE(
                    NULLIF(order_line.cost_at_sale_source, ''),
                    'SHOPIFY_UNIT_COST_AT_SALE'
                )
            WHEN variant.unit_cost IS NOT NULL THEN
                'recomputed_from_current_variant_cost'
            ELSE
                'MISSING_COST'
        END AS cost_source
    FROM public.order_lines AS order_line
    LEFT JOIN public.variants AS variant
        ON variant.shop_domain = order_line.shop_domain
        AND variant.shopify_variant_id = order_line.shopify_variant_id
    WHERE order_line.cost_source = 'FALLBACK_50_PERCENT_CUSTOM_SALE'
        OR COALESCE(order_line.returned_quantity, 0) > 0
)
UPDATE public.order_lines AS order_line
SET
    unit_cost = historical_row.unit_cost,
    cogs = CASE
        WHEN historical_row.unit_cost IS NULL THEN NULL
        ELSE
            GREATEST(
                COALESCE(order_line.quantity, 0)
                    - COALESCE(order_line.returned_quantity, 0),
                0
            ) * historical_row.unit_cost
    END,
    gross_profit = CASE
        WHEN historical_row.unit_cost IS NULL THEN NULL
        ELSE
            COALESCE(order_line.net_sales, order_line.revenue, 0)
                - (
                    GREATEST(
                        COALESCE(order_line.quantity, 0)
                            - COALESCE(order_line.returned_quantity, 0),
                        0
                    ) * historical_row.unit_cost
                )
    END,
    cost_source = historical_row.cost_source
FROM historical_rows AS historical_row
WHERE order_line.id = historical_row.id;
