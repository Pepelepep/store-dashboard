CREATE OR REPLACE VIEW public.staff_pos_seller_metrics AS
WITH totals AS (
  SELECT
    lines.shop_domain,
    lines.shopops_attribution_source AS attribution_source,
    lines.shopops_effective_staff_id AS effective_staff_id,
    count(DISTINCT coalesce(lines.shopify_order_id, lines.order_name)) AS order_count,
    coalesce(sum(lines.net_sales), 0) AS net_sales
  FROM public.order_lines lines
  WHERE lines.shopops_effective_staff_id IS NOT NULL
    AND nullif(trim(lines.shopops_effective_staff_id), '') IS NOT NULL
  GROUP BY lines.shop_domain, lines.shopops_attribution_source, lines.shopops_effective_staff_id
), latest AS (
  SELECT DISTINCT ON (
    lines.shop_domain,
    lines.shopops_attribution_source,
    lines.shopops_effective_staff_id
  )
    lines.shop_domain,
    lines.shopops_attribution_source AS attribution_source,
    lines.shopops_effective_staff_id AS effective_staff_id,
    lines.order_name AS last_order_name,
    lines.created_at_shopify AS last_activity_at,
    lines.retail_location_name AS last_location,
    lines.shopops_pos_device_name AS last_device,
    lines.shopify_order_id AS last_shopify_order_id
  FROM public.order_lines lines
  WHERE lines.shopops_effective_staff_id IS NOT NULL
    AND nullif(trim(lines.shopops_effective_staff_id), '') IS NOT NULL
  ORDER BY
    lines.shop_domain,
    lines.shopops_attribution_source,
    lines.shopops_effective_staff_id,
    lines.created_at_shopify DESC NULLS LAST
)
SELECT
  totals.shop_domain,
  totals.attribution_source,
  totals.effective_staff_id,
  latest.last_order_name,
  latest.last_activity_at,
  latest.last_location,
  latest.last_device,
  totals.order_count,
  totals.net_sales,
  latest.last_shopify_order_id
FROM totals
JOIN latest
  ON latest.shop_domain = totals.shop_domain
 AND latest.attribution_source IS NOT DISTINCT FROM totals.attribution_source
 AND latest.effective_staff_id = totals.effective_staff_id;

GRANT SELECT ON public.staff_pos_seller_metrics TO service_role;
