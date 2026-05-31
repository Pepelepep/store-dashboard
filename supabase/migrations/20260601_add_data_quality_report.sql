CREATE OR REPLACE FUNCTION public.get_data_quality_report(
    p_shop_domain text,
    p_location_ids text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT jsonb_build_object(
    'productsWithoutVariants', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.products AS product
            WHERE product.shop_domain = p_shop_domain
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.variants AS variant
                    WHERE variant.shop_domain = product.shop_domain
                        AND variant.shopify_product_id = product.shopify_product_id
                )
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    product.shopify_product_id,
                    product.title,
                    product.status
                FROM public.products AS product
                WHERE product.shop_domain = p_shop_domain
                    AND NOT EXISTS (
                        SELECT 1
                        FROM public.variants AS variant
                        WHERE variant.shop_domain = product.shop_domain
                            AND variant.shopify_product_id = product.shopify_product_id
                    )
                ORDER BY product.updated_at DESC
                LIMIT 10
            ) AS sample
        )
    ),
    'variantsMissingInventoryItemId', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.variants AS variant
            WHERE variant.shop_domain = p_shop_domain
                AND NULLIF(BTRIM(variant.inventory_item_id), '') IS NULL
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    variant.shopify_variant_id,
                    variant.shopify_product_id,
                    variant.title,
                    variant.sku
                FROM public.variants AS variant
                WHERE variant.shop_domain = p_shop_domain
                    AND NULLIF(BTRIM(variant.inventory_item_id), '') IS NULL
                ORDER BY variant.updated_at DESC
                LIMIT 10
            ) AS sample
        )
    ),
    'variantsMissingUnitCost', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.variants AS variant
            WHERE variant.shop_domain = p_shop_domain
                AND variant.unit_cost IS NULL
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    variant.shopify_variant_id,
                    variant.inventory_item_id,
                    variant.title,
                    variant.sku
                FROM public.variants AS variant
                WHERE variant.shop_domain = p_shop_domain
                    AND variant.unit_cost IS NULL
                ORDER BY variant.updated_at DESC
                LIMIT 10
            ) AS sample
        )
    ),
    'orderLinesMissingCogs', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.order_lines AS order_line
            WHERE order_line.shop_domain = p_shop_domain
                AND order_line.cogs IS NULL
                AND (
                    COALESCE(array_length(p_location_ids, 1), 0) = 0
                    OR order_line.retail_location_id = ANY(p_location_ids)
                )
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    order_line.order_name,
                    order_line.shopify_order_id,
                    order_line.created_at_shopify,
                    order_line.retail_location_name,
                    order_line.product_title,
                    order_line.sku,
                    order_line.revenue,
                    order_line.cost_source
                FROM public.order_lines AS order_line
                WHERE order_line.shop_domain = p_shop_domain
                    AND order_line.cogs IS NULL
                    AND (
                        COALESCE(array_length(p_location_ids, 1), 0) = 0
                        OR order_line.retail_location_id = ANY(p_location_ids)
                    )
                ORDER BY order_line.created_at_shopify DESC
                LIMIT 10
            ) AS sample
        )
    ),
    'orderLinesUsingFallbackCost', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.order_lines AS order_line
            WHERE order_line.shop_domain = p_shop_domain
                AND order_line.cost_source = 'FALLBACK_50_PERCENT_CUSTOM_SALE'
                AND (
                    COALESCE(array_length(p_location_ids, 1), 0) = 0
                    OR order_line.retail_location_id = ANY(p_location_ids)
                )
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    order_line.order_name,
                    order_line.shopify_order_id,
                    order_line.created_at_shopify,
                    order_line.retail_location_name,
                    order_line.product_title,
                    order_line.sku,
                    order_line.revenue,
                    order_line.cost_source
                FROM public.order_lines AS order_line
                WHERE order_line.shop_domain = p_shop_domain
                    AND order_line.cost_source = 'FALLBACK_50_PERCENT_CUSTOM_SALE'
                    AND (
                        COALESCE(array_length(p_location_ids, 1), 0) = 0
                        OR order_line.retail_location_id = ANY(p_location_ids)
                    )
                ORDER BY order_line.created_at_shopify DESC
                LIMIT 10
            ) AS sample
        )
    ),
    'ordersWithoutOrderLines', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.orders AS shop_order
            WHERE shop_order.shop_domain = p_shop_domain
                AND (
                    COALESCE(array_length(p_location_ids, 1), 0) = 0
                    OR shop_order.retail_location_id = ANY(p_location_ids)
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM public.order_lines AS order_line
                    WHERE order_line.shop_domain = shop_order.shop_domain
                        AND order_line.shopify_order_id = shop_order.shopify_order_id
                )
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    shop_order.order_name,
                    shop_order.shopify_order_id,
                    shop_order.created_at_shopify,
                    shop_order.retail_location_name,
                    shop_order.total_price
                FROM public.orders AS shop_order
                WHERE shop_order.shop_domain = p_shop_domain
                    AND (
                        COALESCE(array_length(p_location_ids, 1), 0) = 0
                        OR shop_order.retail_location_id = ANY(p_location_ids)
                    )
                    AND NOT EXISTS (
                        SELECT 1
                        FROM public.order_lines AS order_line
                        WHERE order_line.shop_domain = shop_order.shop_domain
                            AND order_line.shopify_order_id = shop_order.shopify_order_id
                    )
                ORDER BY shop_order.created_at_shopify DESC
                LIMIT 10
            ) AS sample
        )
    ),
    'inventoryLevelsWithoutMatchingVariantOrProduct', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.inventory_levels AS inventory_level
            LEFT JOIN public.variants AS variant
                ON variant.shop_domain = inventory_level.shop_domain
                AND variant.shopify_variant_id = inventory_level.shopify_variant_id
            LEFT JOIN public.products AS product
                ON product.shop_domain = inventory_level.shop_domain
                AND product.shopify_product_id = variant.shopify_product_id
            WHERE inventory_level.shop_domain = p_shop_domain
                AND (
                    COALESCE(array_length(p_location_ids, 1), 0) = 0
                    OR inventory_level.shopify_location_id = ANY(p_location_ids)
                )
                AND (
                    variant.shopify_variant_id IS NULL
                    OR product.shopify_product_id IS NULL
                )
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    inventory_level.shopify_location_id,
                    inventory_level.shopify_variant_id,
                    inventory_level.inventory_item_id,
                    inventory_level.sku,
                    inventory_level.available
                FROM public.inventory_levels AS inventory_level
                LEFT JOIN public.variants AS variant
                    ON variant.shop_domain = inventory_level.shop_domain
                    AND variant.shopify_variant_id = inventory_level.shopify_variant_id
                LEFT JOIN public.products AS product
                    ON product.shop_domain = inventory_level.shop_domain
                    AND product.shopify_product_id = variant.shopify_product_id
                WHERE inventory_level.shop_domain = p_shop_domain
                    AND (
                        COALESCE(array_length(p_location_ids, 1), 0) = 0
                        OR inventory_level.shopify_location_id = ANY(p_location_ids)
                    )
                    AND (
                        variant.shopify_variant_id IS NULL
                        OR product.shopify_product_id IS NULL
                    )
                ORDER BY inventory_level.synced_at DESC
                LIMIT 10
            ) AS sample
        )
    ),
    'orderLinesMissingStaffAttribution', jsonb_build_object(
        'count', (
            SELECT count(*)
            FROM public.order_lines AS order_line
            WHERE order_line.shop_domain = p_shop_domain
                AND order_line.staff_member_id IS NULL
                AND order_line.staff_member_email IS NULL
                AND order_line.staff_member_name IS NULL
                AND (
                    COALESCE(array_length(p_location_ids, 1), 0) = 0
                    OR order_line.retail_location_id = ANY(p_location_ids)
                )
        ),
        'samples', (
            SELECT COALESCE(jsonb_agg(to_jsonb(sample)), '[]'::jsonb)
            FROM (
                SELECT
                    order_line.order_name,
                    order_line.shopify_order_id,
                    order_line.created_at_shopify,
                    order_line.retail_location_name,
                    order_line.product_title,
                    order_line.sku,
                    order_line.revenue,
                    order_line.staff_source
                FROM public.order_lines AS order_line
                WHERE order_line.shop_domain = p_shop_domain
                    AND order_line.staff_member_id IS NULL
                    AND order_line.staff_member_email IS NULL
                    AND order_line.staff_member_name IS NULL
                    AND (
                        COALESCE(array_length(p_location_ids, 1), 0) = 0
                        OR order_line.retail_location_id = ANY(p_location_ids)
                    )
                ORDER BY order_line.created_at_shopify DESC
                LIMIT 10
            ) AS sample
        )
    )
);
$$;
