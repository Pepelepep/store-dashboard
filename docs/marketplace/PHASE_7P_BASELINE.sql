-- Phase 7P target-shop baseline. READ ONLY.
-- Replace exactly one value here and run the same script before and after.
WITH
target AS (
  SELECT '<SHOP_DOMAIN>'::text AS shop_domain
),
line_values AS (
  SELECT
    coalesce(
      net_sales,
      CASE
        WHEN gross_sales IS NOT NULL
          AND discounts IS NOT NULL
          AND returns IS NOT NULL
          THEN gross_sales - discounts - returns
        ELSE revenue
      END
    ) AS calculated_net_sales,
    discounts,
    CASE WHEN cost_at_sale IS NOT NULL
      THEN cost_at_sale * quantity
      ELSE cogs
    END AS calculated_cogs
  FROM public.order_lines, target
  WHERE order_lines.shop_domain = target.shop_domain
),
line_metrics AS (
  SELECT
    count(*) AS line_count,
    CASE WHEN bool_or(calculated_net_sales IS NULL) THEN NULL
      ELSE sum(calculated_net_sales) END AS net_sales,
    CASE WHEN bool_or(discounts IS NULL) THEN NULL
      ELSE sum(discounts) END AS discounts,
    CASE WHEN bool_or(calculated_cogs IS NULL) THEN NULL
      ELSE sum(calculated_cogs) END AS cogs,
    CASE WHEN bool_or(
      calculated_net_sales IS NULL OR calculated_cogs IS NULL
    ) THEN NULL ELSE sum(calculated_net_sales - calculated_cogs) END AS profit,
    count(*) FILTER (
      WHERE calculated_net_sales IS NULL
    ) AS lines_without_calculable_net_sales,
    count(*) FILTER (
      WHERE discounts IS NULL
    ) AS lines_without_stored_discounts,
    count(*) FILTER (
      WHERE calculated_cogs IS NULL
    ) AS lines_without_calculable_cogs
  FROM line_values
),
refund_metrics AS (
  SELECT
    CASE WHEN count(*) FILTER (
      WHERE upper(kind)='REFUND'
        AND (status IS NULL OR upper(status)='SUCCESS')
        AND amount IS NULL
    ) > 0 THEN NULL ELSE sum(amount) FILTER (
      WHERE upper(kind)='REFUND'
        AND (status IS NULL OR upper(status)='SUCCESS')
    ) END AS refunds,
    count(*) FILTER (
      WHERE upper(kind)='REFUND'
        AND (status IS NULL OR upper(status)='SUCCESS')
    ) AS successful_refund_transactions,
    count(*) FILTER (
      WHERE upper(kind)='REFUND'
        AND (status IS NULL OR upper(status)='SUCCESS')
        AND amount IS NULL
    ) AS successful_refunds_without_amount
  FROM public.order_transactions, target
  WHERE order_transactions.shop_domain = target.shop_domain
),
baseline(metric, numeric_value, text_value, note) AS (
  SELECT 'target.shop_domain', NULL::numeric, shop_domain,
    'Every tenant-scoped query in this snapshot uses this exact domain.' FROM target
  UNION ALL SELECT 'identity.shop_records', count(*)::numeric, NULL,
    'Expected: one. Preserve the existing shops.id across upgrade.'
    FROM public.shops, target WHERE shops.shop_domain=target.shop_domain
  UNION ALL SELECT 'identity.shop_ids', NULL,
    string_agg(shops.id::text, ',' ORDER BY shops.id::text),
    'Compare exactly before and after; NULL means no shops row exists.'
    FROM public.shops, target WHERE shops.shop_domain=target.shop_domain
  UNION ALL SELECT 'identity.sessions', NULL, NULL,
    'UNAVAILABLE IN SUPABASE: Prisma Session rows live in DATABASE_URL. Run the separate read-only query printed below.'
  UNION ALL SELECT 'catalog.locations', count(*)::numeric, NULL, NULL
    FROM public.locations, target WHERE locations.shop_domain=target.shop_domain
  UNION ALL SELECT 'catalog.products', count(*)::numeric, NULL, NULL
    FROM public.products, target WHERE products.shop_domain=target.shop_domain
  UNION ALL SELECT 'catalog.variants', count(*)::numeric, NULL, NULL
    FROM public.variants, target WHERE variants.shop_domain=target.shop_domain
  UNION ALL SELECT 'inventory.levels', count(*)::numeric, NULL, NULL
    FROM public.inventory_levels, target WHERE inventory_levels.shop_domain=target.shop_domain
  UNION ALL SELECT 'inventory.items', count(*)::numeric, NULL, NULL
    FROM public.inventory_items, target WHERE inventory_items.shop_domain=target.shop_domain
  UNION ALL SELECT 'orders.rows', count(*)::numeric, NULL, NULL
    FROM public.orders, target WHERE orders.shop_domain=target.shop_domain
  UNION ALL SELECT 'orders.distinct_shopify_order_ids',
    count(DISTINCT shopify_order_id)::numeric, NULL,
    'Must remain equal to orders.rows when order identity is unique.'
    FROM public.orders, target WHERE orders.shop_domain=target.shop_domain
  UNION ALL SELECT 'orders.lines', line_count::numeric, NULL, NULL FROM line_metrics
  UNION ALL SELECT 'financial.net_sales', net_sales, NULL,
    'Approved line formula; NULL means at least one line cannot be safely calculated.' FROM line_metrics
  UNION ALL SELECT 'financial.discounts', discounts, NULL,
    'Stored line discounts; NULL means at least one line lacks a stored value.' FROM line_metrics
  UNION ALL SELECT 'financial.refunds', refunds, NULL,
    'Successful REFUND transactions only; NULL means none exist or at least one lacks an amount. Review the coverage counts.' FROM refund_metrics
  UNION ALL SELECT 'financial.cogs', cogs, NULL,
    'cost_at_sale * quantity, otherwise stored cogs. NULL means at least one line lacks calculable COGS.' FROM line_metrics
  UNION ALL SELECT 'financial.profit', profit, NULL,
    'Net sales minus the approved COGS expression; NULL means it cannot be safely calculated.' FROM line_metrics
  UNION ALL SELECT 'financial.lines_without_calculable_cogs',
    lines_without_calculable_cogs::numeric, NULL,
    'If nonzero, COGS/profit coverage is incomplete.' FROM line_metrics
  UNION ALL SELECT 'financial.lines_without_calculable_net_sales',
    lines_without_calculable_net_sales::numeric, NULL,
    'If nonzero, net-sales/profit coverage is incomplete.' FROM line_metrics
  UNION ALL SELECT 'financial.lines_without_stored_discounts',
    lines_without_stored_discounts::numeric, NULL,
    'If nonzero, the discounts total is unavailable rather than reported as zero.' FROM line_metrics
  UNION ALL SELECT 'financial.successful_refund_transactions',
    successful_refund_transactions::numeric, NULL, NULL FROM refund_metrics
  UNION ALL SELECT 'financial.successful_refunds_without_amount',
    successful_refunds_without_amount::numeric, NULL,
    'If nonzero, the refunds total is unavailable rather than reported as zero.' FROM refund_metrics
  UNION ALL SELECT 'staff.people', count(*)::numeric, NULL, NULL
    FROM public.staff_people, target WHERE staff_people.shop_domain=target.shop_domain
  UNION ALL SELECT 'staff.identity_aliases', count(*)::numeric, NULL, NULL
    FROM public.staff_identity_aliases, target WHERE staff_identity_aliases.shop_domain=target.shop_domain
  UNION ALL SELECT 'permissions.rows', count(*)::numeric, NULL, NULL
    FROM public.user_location_access, target WHERE user_location_access.shop_domain=target.shop_domain
  UNION ALL SELECT 'jobs.queued', count(*)::numeric, NULL, NULL
    FROM public.sync_jobs, target WHERE sync_jobs.shop_domain=target.shop_domain AND status='pending'
  UNION ALL SELECT 'jobs.running', count(*)::numeric, NULL, NULL
    FROM public.sync_jobs, target WHERE sync_jobs.shop_domain=target.shop_domain AND status='running'
  UNION ALL SELECT 'jobs.failed', count(*)::numeric, NULL, NULL
    FROM public.sync_jobs, target WHERE sync_jobs.shop_domain=target.shop_domain AND status='error'
  UNION ALL SELECT 'webhooks.failed', count(*)::numeric, NULL, NULL
    FROM public.webhook_events, target WHERE webhook_events.shop_domain=target.shop_domain AND status='error'
  UNION ALL SELECT 'webhooks.compliance_failed', count(*)::numeric, NULL,
    'Compliance webhook failures are reported separately from operational webhook failures.'
    FROM public.compliance_webhook_events, target
    WHERE compliance_webhook_events.shop_domain=target.shop_domain AND status='error'
)
SELECT metric, numeric_value, text_value, note FROM baseline ORDER BY metric;

-- Separate Prisma/session database query (DATABASE_URL), also READ ONLY:
-- SELECT count(*) AS session_count,
--        count(*) FILTER (WHERE "isOnline" = false) AS offline_sessions,
--        count(*) FILTER (WHERE "isOnline" = true) AS online_sessions
-- FROM "Session" WHERE shop = 'COPY THE target.shop_domain VALUE ABOVE';
