-- Phase 7P FINAL-STATE postflight. READ ONLY.
-- Run after the Phase 7P migration and after opening the upgraded app once.
-- Replace exactly one value here; all tenant data checks use this domain.
WITH
target AS (
  SELECT '<SHOP_DOMAIN>'::text AS shop_domain
),
required_tables(name) AS (VALUES
  ('shops'), ('fixed_expenses'), ('locations'), ('products'), ('variants'),
  ('inventory_levels'), ('inventory_items'), ('orders'), ('order_lines'),
  ('order_transactions'), ('sync_runs'), ('sync_jobs'), ('webhook_events'),
  ('compliance_webhook_events'), ('maintenance_tick_state'),
  ('sync_automation_state'), ('staff_people'), ('staff_identity_aliases'),
  ('user_location_access'), ('pos_attribution_setup')
),
required_views(name) AS (VALUES ('staff_pos_seller_metrics')),
required_functions(name, args) AS (VALUES
  ('claim_webhook_events', 'integer, integer, interval'),
  ('cleanup_operational_sync_history', 'integer'),
  ('get_data_quality_report', 'text, text[]'),
  ('recompute_order_line_cogs_for_shop', 'text'),
  ('remove_or_archive_staff', 'text, uuid'),
  ('remove_staff_dashboard_access', 'text, uuid'),
  ('replace_staff_dashboard_access', 'text, uuid, text, text, text[], text[]'),
  ('restore_archived_staff', 'text, uuid')
),
required_columns(table_name, column_name) AS (VALUES
  ('shops','shop_domain'), ('shops','marketplace_initialized_at'),
  ('orders','shop_domain'), ('orders','shopify_order_id'), ('orders','net_sales'),
  ('orders','refunds'), ('orders','financial_data_complete'),
  ('order_lines','shop_domain'), ('order_lines','shopify_line_item_id'),
  ('order_lines','quantity'), ('order_lines','revenue'),
  ('order_lines','cogs'), ('order_lines','gross_sales'),
  ('order_lines','discounts'),
  ('order_lines','returns'), ('order_lines','net_sales'),
  ('order_lines','cost_at_sale'), ('order_lines','shopops_staff_member_id'),
  ('order_lines','shopops_user_id'),
  ('order_lines','shopops_attributed_user_id'),
  ('order_lines','shopops_effective_staff_id'),
  ('order_lines','shopops_attribution_source'),
  ('order_lines','shopops_pos_location_id'),
  ('order_transactions','shop_domain'), ('order_transactions','kind'),
  ('order_transactions','status'), ('order_transactions','amount'),
  ('user_location_access','shop_domain'), ('user_location_access','user_email'),
  ('user_location_access','shopify_user_id'),
  ('user_location_access','shopify_location_id'),
  ('user_location_access','access_label'),
  ('user_location_access','person_id'),
  ('staff_identity_aliases','review_status'),
  ('sync_jobs','shop_domain'), ('sync_jobs','status'), ('sync_jobs','job_type'),
  ('sync_jobs','progress'), ('sync_jobs','details'),
  ('webhook_events','shop_domain'), ('webhook_events','status'),
  ('compliance_webhook_events','shop_domain'),
  ('compliance_webhook_events','status'),
  ('sync_automation_state','shop_domain'),
  ('sync_automation_state','next_reconciliation_due_at'),
  ('pos_attribution_setup','shop_domain'),
  ('pos_attribution_setup','tile_confirmed_at')
),
required_indexes(name, expected_fragment) AS (VALUES
  ('shops_shop_domain_key', NULL),
  ('orders_shop_order_uidx', NULL),
  ('order_lines_shop_line_item_uidx', NULL),
  ('products_shop_product_uidx', NULL),
  ('variants_shop_variant_uidx', NULL),
  ('inventory_levels_shop_location_item_uidx', NULL),
  ('inventory_items_shop_inventory_item_uidx', NULL),
  ('order_transactions_shop_transaction_key', NULL),
  ('staff_people_shop_email_uidx', NULL),
  ('staff_identity_aliases_shop_type_value_uidx', NULL),
  ('sync_jobs_one_active_per_shop_type_idx', NULL),
  ('sync_jobs_one_active_full_operation_per_shop_idx', NULL),
  ('webhook_events_shop_webhook_id_uidx', NULL),
  ('user_location_access_shop_email_user_location_uidx', 'lower(btrim(user_email))'),
  ('user_location_access_shop_user_location_strict_uidx', 'btrim(shopify_user_id)')
),
object_findings AS (
  SELECT 'BLOCKED' severity, 'TABLE' check_type, name object_name,
    'Required final table is missing.' detail
  FROM required_tables WHERE to_regclass('public.' || name) IS NULL
  UNION ALL
  SELECT 'BLOCKED', 'VIEW', name, 'Required final view is missing.'
  FROM required_views
  WHERE NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname=name)
  UNION ALL
  SELECT 'BLOCKED', 'COLUMN', table_name || '.' || column_name,
    'Required final column is missing.'
  FROM required_columns
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name=required_columns.table_name
      AND c.column_name=required_columns.column_name
  )
  UNION ALL
  SELECT 'BLOCKED', 'FUNCTION', name || '(' || args || ')',
    'Required final function signature is missing.'
  FROM required_functions
  WHERE to_regprocedure('public.' || name || '(' || args || ')') IS NULL
  UNION ALL
  SELECT 'BLOCKED', 'INDEX', name, 'Required final index is missing.'
  FROM required_indexes WHERE to_regclass('public.' || name) IS NULL
  UNION ALL
  SELECT 'BLOCKED', 'INDEX_DEFINITION', name,
    'Index exists but does not match the required trim/lower normalization.'
  FROM required_indexes
  WHERE expected_fragment IS NOT NULL
    AND to_regclass('public.' || name) IS NOT NULL
    AND position(expected_fragment IN pg_get_indexdef(to_regclass('public.' || name))) = 0
  UNION ALL
  SELECT 'BLOCKED', 'INDEX_UNIQUENESS', name,
    'Phase 7P permission index exists but is not unique.'
  FROM required_indexes
  JOIN pg_index ON indexrelid=to_regclass('public.' || name)
  WHERE name IN (
    'user_location_access_shop_email_user_location_uidx',
    'user_location_access_shop_user_location_strict_uidx'
  ) AND NOT indisunique
),
constraint_findings AS (
  SELECT 'BLOCKED' severity, 'CONSTRAINT' check_type,
    'sync_jobs job_type check' object_name,
    'Final job-type constraint must include full_refresh, financial_backfill_30d and orders_reconciliation_48h.' detail
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.sync_jobs') AND c.contype='c'
      AND pg_get_constraintdef(c.oid) LIKE '%full_refresh%'
      AND pg_get_constraintdef(c.oid) LIKE '%financial_backfill_30d%'
      AND pg_get_constraintdef(c.oid) LIKE '%orders_reconciliation_48h%'
  )
),
data_check_specs(check_name, relation_name, severity, detail, query_template) AS (VALUES
  ('logical_shop_count', 'shops', 'BLOCKED',
    'Target must resolve to exactly one logical shops row.',
    'SELECT 1 FROM public.shops WHERE shop_domain=%L HAVING count(*) <> 1'),
  ('marketplace_initialized', 'shops', 'BLOCKED',
    'marketplace_initialized_at is NULL after the app was opened; mandatory initialization did not complete.',
    'SELECT 1 FROM public.shops WHERE shop_domain=%L AND marketplace_initialized_at IS NULL'),
  ('sync_automation_state_count', 'sync_automation_state', 'BLOCKED',
    'Target must have exactly one sync_automation_state row.',
    'SELECT 1 FROM public.sync_automation_state WHERE shop_domain=%L HAVING count(*) <> 1'),
  ('pos_attribution_setup_count', 'pos_attribution_setup', 'BLOCKED',
    'Target must have exactly one pos_attribution_setup row.',
    'SELECT 1 FROM public.pos_attribution_setup WHERE shop_domain=%L HAVING count(*) <> 1'),
  ('duplicate_shopify_orders', 'orders', 'BLOCKED',
    'Duplicate Shopify order IDs exist for the target shop.',
    'SELECT 1 FROM public.orders WHERE shop_domain=%L AND shopify_order_id IS NOT NULL GROUP BY shopify_order_id HAVING count(*) > 1'),
  ('duplicate_shopify_lines', 'order_lines', 'BLOCKED',
    'Duplicate Shopify line item IDs exist for the target shop.',
    'SELECT 1 FROM public.order_lines WHERE shop_domain=%L AND shopify_line_item_id IS NOT NULL GROUP BY shopify_line_item_id HAVING count(*) > 1'),
  ('duplicate_permission_email_identity', 'user_location_access', 'BLOCKED',
    'Duplicate normalized email/user/location permission identities exist.',
    'SELECT 1 FROM public.user_location_access WHERE shop_domain=%L AND user_email IS NOT NULL GROUP BY lower(btrim(user_email)), coalesce(btrim(shopify_user_id), ''''), coalesce(btrim(shopify_location_id), '''') HAVING count(*) > 1'),
  ('duplicate_permission_user_identity', 'user_location_access', 'BLOCKED',
    'Duplicate normalized Shopify-user/location permission identities exist.',
    'SELECT 1 FROM public.user_location_access WHERE shop_domain=%L AND shopify_user_id IS NOT NULL GROUP BY btrim(shopify_user_id), coalesce(btrim(shopify_location_id), '''') HAVING count(*) > 1'),
  ('multiple_active_full_rebuilds', 'sync_jobs', 'BLOCKED',
    'More than one full/full_refresh operation is active for the target shop.',
    'SELECT 1 FROM public.sync_jobs WHERE shop_domain=%L AND status IN (''pending'',''running'') AND job_type IN (''full'',''full_refresh'') HAVING count(*) > 1')
),
data_results AS (
  SELECT specs.*,
    CASE WHEN to_regclass('public.' || relation_name) IS NULL
      OR EXISTS (
        SELECT 1 FROM required_columns rc
        WHERE rc.table_name=relation_name
          AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema='public'
              AND c.table_name=rc.table_name
              AND c.column_name=rc.column_name
          )
      ) THEN NULL
      ELSE (xpath(
        'count(/table/row)',
        query_to_xml(format(query_template, target.shop_domain), false, false, '')
      ))[1]::text::numeric
    END AS finding_count
  FROM data_check_specs specs CROSS JOIN target
),
data_findings AS (
  SELECT severity, 'TARGET_DATA' check_type, check_name object_name,
    detail || ' Finding groups: ' || finding_count::text AS detail
  FROM data_results WHERE finding_count > 0
  UNION ALL
  SELECT 'BLOCKED', 'TARGET', 'shop_domain',
    'Replace the target placeholder with exactly one intended pilot shop domain.'
  FROM target WHERE shop_domain ~ '^<[^>]+>$' OR btrim(shop_domain)=''
),
findings AS (
  SELECT * FROM object_findings
  UNION ALL SELECT * FROM constraint_findings
  UNION ALL SELECT * FROM data_findings
),
summary AS (
  SELECT CASE
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='BLOCKED') THEN 'BLOCKED'
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='WARNING') THEN 'WARNING'
      ELSE 'GO'
    END severity,
    'SUMMARY' check_type, 'Phase 7P postflight' object_name,
    CASE
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='BLOCKED')
        THEN 'Stop. Resolve every BLOCKED finding before the pilot continues.'
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='WARNING')
        THEN 'Final schema is present, but review every WARNING before continuing.'
      ELSE 'Final schema, target identity, uniqueness and active-rebuild checks passed.'
    END detail
)
SELECT * FROM findings
UNION ALL SELECT * FROM summary
ORDER BY CASE severity WHEN 'BLOCKED' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
  check_type, object_name;
