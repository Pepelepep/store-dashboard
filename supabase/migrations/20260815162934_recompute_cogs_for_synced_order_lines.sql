CREATE OR REPLACE FUNCTION public.recompute_order_line_cogs_for_order_lines(
    p_shop_domain text,
    p_shopify_line_item_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    updated_count integer;
BEGIN
    IF COALESCE(array_length(p_shopify_line_item_ids, 1), 0) = 0 THEN
        RETURN 0;
    END IF;

    WITH shop_settings AS (
        SELECT
            COALESCE(shop.cogs_estimate_enabled, false) AS estimate_enabled,
            shop.cogs_estimate_percent AS estimate_percent,
            COALESCE(shop.cogs_estimate_custom_sales, false) AS estimate_custom_sales
        FROM public.shops AS shop
        WHERE shop.shop_domain = p_shop_domain
    ),
    resolved_lines AS (
        SELECT
            order_line.id,
            COALESCE(
                order_line.cost_at_sale,
                variant.unit_cost,
                CASE
                    WHEN order_line.cost_source IS DISTINCT FROM
                        'SHOP_PERCENT_ESTIMATE'
                        THEN order_line.unit_cost
                    ELSE NULL
                END
            ) AS actual_unit_cost,
            GREATEST(
                COALESCE(order_line.quantity, 0)
                    - COALESCE(order_line.returned_quantity, 0),
                0
            ) AS remaining_quantity,
            CASE
                WHEN order_line.quantity > 0
                    AND order_line.gross_sales IS NOT NULL
                    THEN order_line.gross_sales / order_line.quantity
                ELSE COALESCE(order_line.unit_price, 0)
            END AS selling_unit_price,
            settings.estimate_enabled,
            settings.estimate_percent,
            settings.estimate_custom_sales,
            order_line.shopify_variant_id
        FROM public.order_lines AS order_line
        LEFT JOIN public.variants AS variant
            ON variant.shop_domain = order_line.shop_domain
            AND variant.shopify_variant_id = order_line.shopify_variant_id
        CROSS JOIN shop_settings AS settings
        WHERE order_line.shop_domain = p_shop_domain
            AND order_line.shopify_line_item_id = ANY(p_shopify_line_item_ids)
    ),
    calculated_lines AS (
        SELECT
            resolved_line.id,
            resolved_line.actual_unit_cost,
            resolved_line.remaining_quantity,
            CASE
                WHEN resolved_line.remaining_quantity = 0 THEN NULL
                WHEN resolved_line.actual_unit_cost IS NOT NULL THEN
                    resolved_line.actual_unit_cost
                WHEN resolved_line.estimate_enabled
                    AND resolved_line.estimate_percent BETWEEN 0 AND 100
                    AND (
                        resolved_line.shopify_variant_id IS NOT NULL
                        OR resolved_line.estimate_custom_sales
                    )
                    THEN
                        resolved_line.selling_unit_price
                            * (resolved_line.estimate_percent / 100.0)
                ELSE NULL
            END AS effective_unit_cost,
            CASE
                WHEN resolved_line.remaining_quantity = 0 THEN
                    'FULLY_RETURNED'
                WHEN resolved_line.actual_unit_cost IS NOT NULL THEN
                    'ACTUAL_SHOPIFY_COST'
                WHEN resolved_line.estimate_enabled
                    AND resolved_line.estimate_percent BETWEEN 0 AND 100
                    AND (
                        resolved_line.shopify_variant_id IS NOT NULL
                        OR resolved_line.estimate_custom_sales
                    )
                    THEN 'SHOP_PERCENT_ESTIMATE'
                ELSE 'MISSING_COST'
            END AS cost_source,
            CASE
                WHEN resolved_line.remaining_quantity > 0
                    AND resolved_line.actual_unit_cost IS NULL
                    AND resolved_line.estimate_enabled
                    AND resolved_line.estimate_percent BETWEEN 0 AND 100
                    AND (
                        resolved_line.shopify_variant_id IS NOT NULL
                        OR resolved_line.estimate_custom_sales
                    )
                    THEN resolved_line.estimate_percent
                ELSE NULL
            END AS applied_estimate_percent
        FROM resolved_lines AS resolved_line
    )
    UPDATE public.order_lines AS order_line
    SET
        unit_cost = calculated_line.actual_unit_cost,
        cogs = CASE
            WHEN calculated_line.remaining_quantity = 0 THEN 0
            WHEN calculated_line.effective_unit_cost IS NULL THEN NULL
            ELSE
                calculated_line.effective_unit_cost
                    * calculated_line.remaining_quantity
        END,
        gross_profit = CASE
            WHEN calculated_line.remaining_quantity = 0 THEN
                COALESCE(order_line.net_sales, order_line.revenue, 0)
            WHEN calculated_line.effective_unit_cost IS NULL THEN NULL
            ELSE
                COALESCE(order_line.net_sales, order_line.revenue, 0)
                    - (
                        calculated_line.effective_unit_cost
                            * calculated_line.remaining_quantity
                    )
        END,
        cost_source = calculated_line.cost_source,
        cogs_estimate_percent = calculated_line.applied_estimate_percent
    FROM calculated_lines AS calculated_line
    WHERE order_line.id = calculated_line.id;

    GET DIAGNOSTICS updated_count = ROW_COUNT;

    RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_order_line_cogs_for_order_lines(
    text,
    text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.recompute_order_line_cogs_for_order_lines(
    text,
    text[]
) TO service_role;
