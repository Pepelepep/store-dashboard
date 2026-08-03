CREATE OR REPLACE FUNCTION public.get_product_cost_coverage_summary(
    p_shop_domain text
)
RETURNS TABLE(
    actual_line_count bigint,
    estimated_line_count bigint,
    missing_line_count bigint,
    missing_sales_amount numeric,
    affected_product_count bigint,
    actual_cogs numeric,
    estimated_cogs numeric,
    total_net_sales numeric,
    product_missing_line_count bigint,
    product_estimate_basis numeric,
    custom_missing_line_count bigint,
    custom_estimate_basis numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH relevant_lines AS (
        SELECT
            order_line.product_title,
            order_line.variant_title,
            order_line.shopify_variant_id,
            order_line.cost_source,
            order_line.cogs,
            COALESCE(order_line.net_sales, order_line.revenue, 0) AS net_sales,
            GREATEST(
                COALESCE(order_line.quantity, 0)
                    - COALESCE(order_line.returned_quantity, 0),
                0
            ) AS remaining_quantity,
            COALESCE(
                order_line.cost_at_sale,
                CASE
                    WHEN order_line.cost_source IS DISTINCT FROM
                        'SHOP_PERCENT_ESTIMATE'
                        THEN order_line.unit_cost
                    ELSE NULL
                END
            ) AS actual_unit_cost,
            CASE
                WHEN COALESCE(order_line.quantity, 0) > 0
                    AND order_line.gross_sales IS NOT NULL
                    THEN
                        order_line.gross_sales
                            / COALESCE(order_line.quantity, 0)
                ELSE COALESCE(order_line.unit_price, 0)
            END AS selling_unit_price
        FROM public.order_lines AS order_line
        WHERE order_line.shop_domain = p_shop_domain
    ),
    classified_lines AS (
        SELECT
            relevant_line.*,
            CASE
                WHEN relevant_line.actual_unit_cost IS NOT NULL THEN 'actual'
                WHEN relevant_line.cost_source = 'SHOP_PERCENT_ESTIMATE'
                    AND relevant_line.cogs IS NOT NULL
                    THEN 'estimated'
                ELSE 'missing'
            END AS coverage_kind,
            CASE
                WHEN relevant_line.shopify_variant_id IS NOT NULL
                    THEN 'variant:' || relevant_line.shopify_variant_id
                ELSE
                    'custom:'
                        || COALESCE(relevant_line.product_title, 'Custom sale')
                        || ':'
                        || COALESCE(relevant_line.variant_title, '')
            END AS coverage_key
        FROM relevant_lines AS relevant_line
        WHERE relevant_line.remaining_quantity > 0
    ),
    net_sales_total AS (
        SELECT COALESCE(SUM(relevant_line.net_sales), 0) AS total_net_sales
        FROM relevant_lines AS relevant_line
    )
    SELECT
        COUNT(*) FILTER (
            WHERE classified_line.coverage_kind = 'actual'
        ) AS actual_line_count,
        COUNT(*) FILTER (
            WHERE classified_line.coverage_kind = 'estimated'
        ) AS estimated_line_count,
        COUNT(*) FILTER (
            WHERE classified_line.coverage_kind = 'missing'
        ) AS missing_line_count,
        COALESCE(
            SUM(classified_line.net_sales) FILTER (
                WHERE classified_line.coverage_kind = 'missing'
            ),
            0
        ) AS missing_sales_amount,
        COUNT(DISTINCT classified_line.coverage_key) FILTER (
            WHERE classified_line.coverage_kind = 'missing'
        ) AS affected_product_count,
        COALESCE(
            SUM(
                classified_line.actual_unit_cost
                    * classified_line.remaining_quantity
            ) FILTER (
                WHERE classified_line.coverage_kind = 'actual'
            ),
            0
        ) AS actual_cogs,
        COALESCE(
            SUM(classified_line.cogs) FILTER (
                WHERE classified_line.coverage_kind = 'estimated'
            ),
            0
        ) AS estimated_cogs,
        net_sales_total.total_net_sales,
        COUNT(*) FILTER (
            WHERE classified_line.actual_unit_cost IS NULL
                AND classified_line.shopify_variant_id IS NOT NULL
        ) AS product_missing_line_count,
        COALESCE(
            SUM(
                classified_line.selling_unit_price
                    * classified_line.remaining_quantity
            ) FILTER (
                WHERE classified_line.actual_unit_cost IS NULL
                    AND classified_line.shopify_variant_id IS NOT NULL
            ),
            0
        ) AS product_estimate_basis,
        COUNT(*) FILTER (
            WHERE classified_line.actual_unit_cost IS NULL
                AND classified_line.shopify_variant_id IS NULL
        ) AS custom_missing_line_count,
        COALESCE(
            SUM(
                classified_line.selling_unit_price
                    * classified_line.remaining_quantity
            ) FILTER (
                WHERE classified_line.actual_unit_cost IS NULL
                    AND classified_line.shopify_variant_id IS NULL
            ),
            0
        ) AS custom_estimate_basis
    FROM net_sales_total
    LEFT JOIN classified_lines AS classified_line ON true
    GROUP BY net_sales_total.total_net_sales;
$$;

CREATE OR REPLACE FUNCTION public.get_missing_product_costs_page(
    p_shop_domain text,
    p_search text DEFAULT NULL,
    p_limit integer DEFAULT 25,
    p_offset integer DEFAULT 0
)
RETURNS TABLE(
    group_key text,
    product_title text,
    variant_title text,
    units_sold bigint,
    sales_affected numeric,
    shopify_product_id text,
    total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH missing_lines AS (
        SELECT
            CASE
                WHEN order_line.shopify_variant_id IS NOT NULL
                    THEN 'variant:' || order_line.shopify_variant_id
                ELSE
                    'custom:'
                        || COALESCE(order_line.product_title, 'Custom sale')
                        || ':'
                        || COALESCE(order_line.variant_title, '')
            END AS group_key,
            COALESCE(order_line.product_title, 'Custom sale') AS product_title,
            COALESCE(
                order_line.variant_title,
                CASE
                    WHEN order_line.shopify_variant_id IS NULL
                        THEN 'Custom sale'
                    ELSE '-'
                END
            ) AS variant_title,
            order_line.shopify_variant_id,
            GREATEST(
                COALESCE(order_line.quantity, 0)
                    - COALESCE(order_line.returned_quantity, 0),
                0
            ) AS remaining_quantity,
            COALESCE(order_line.net_sales, order_line.revenue, 0) AS net_sales
        FROM public.order_lines AS order_line
        WHERE order_line.shop_domain = p_shop_domain
            AND GREATEST(
                COALESCE(order_line.quantity, 0)
                    - COALESCE(order_line.returned_quantity, 0),
                0
            ) > 0
            AND order_line.cost_at_sale IS NULL
            AND (
                order_line.unit_cost IS NULL
                OR order_line.cost_source = 'SHOP_PERCENT_ESTIMATE'
            )
            AND NOT (
                order_line.cost_source = 'SHOP_PERCENT_ESTIMATE'
                AND order_line.cogs IS NOT NULL
            )
            AND (
                NULLIF(TRIM(p_search), '') IS NULL
                OR COALESCE(order_line.product_title, 'Custom sale')
                    ILIKE '%' || TRIM(p_search) || '%'
                OR COALESCE(order_line.variant_title, '')
                    ILIKE '%' || TRIM(p_search) || '%'
            )
    ),
    grouped_missing_lines AS (
        SELECT
            missing_line.group_key,
            MAX(missing_line.product_title) AS product_title,
            MAX(missing_line.variant_title) AS variant_title,
            SUM(missing_line.remaining_quantity) AS units_sold,
            SUM(missing_line.net_sales) AS sales_affected,
            MAX(variant.shopify_product_id) AS shopify_product_id
        FROM missing_lines AS missing_line
        LEFT JOIN public.variants AS variant
            ON variant.shop_domain = p_shop_domain
            AND variant.shopify_variant_id = missing_line.shopify_variant_id
        GROUP BY missing_line.group_key
    )
    SELECT
        grouped_line.group_key,
        grouped_line.product_title,
        grouped_line.variant_title,
        grouped_line.units_sold,
        grouped_line.sales_affected,
        grouped_line.shopify_product_id,
        COUNT(*) OVER () AS total_count
    FROM grouped_missing_lines AS grouped_line
    ORDER BY grouped_line.sales_affected DESC, grouped_line.group_key
    LIMIT LEAST(GREATEST(p_limit, 1), 25)
    OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.get_product_cost_coverage_summary(text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_cost_coverage_summary(text)
    TO service_role;

REVOKE ALL ON FUNCTION public.get_missing_product_costs_page(
    text,
    text,
    integer,
    integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_missing_product_costs_page(
    text,
    text,
    integer,
    integer
) TO service_role;
