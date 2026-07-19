-- Phase 7P PRE-MIGRATION preflight. READ ONLY.
-- Run this before 20260717120000_existing_store_upgrade_hardening.sql.
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
  ('shops','shop_domain'),
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
  ('sync_jobs','shop_domain'), ('sync_jobs','status'),
  ('sync_jobs','job_type'), ('sync_jobs','progress'), ('sync_jobs','details'),
  ('webhook_events','shop_domain'), ('webhook_events','status'),
  ('compliance_webhook_events','shop_domain'),
  ('compliance_webhook_events','status'),
  ('sync_automation_state','next_reconciliation_due_at'),
  ('pos_attribution_setup','tile_confirmed_at')
),
required_indexes(name) AS (VALUES
  ('shops_shop_domain_key'), ('orders_shop_order_uidx'),
  ('order_lines_shop_line_item_uidx'), ('products_shop_product_uidx'),
  ('variants_shop_variant_uidx'), ('inventory_levels_shop_location_item_uidx'),
  ('inventory_items_shop_inventory_item_uidx'),
  ('order_transactions_shop_transaction_key'),
  ('staff_people_shop_email_uidx'),
  ('staff_identity_aliases_shop_type_value_uidx'),
  ('user_location_access_shop_user_id_location_uidx'),
  ('sync_jobs_one_active_per_shop_type_idx'),
  ('sync_jobs_one_active_full_operation_per_shop_idx'),
  ('webhook_events_shop_webhook_id_uidx')
),
permission_schema_ready AS (
  SELECT to_regclass('public.user_location_access') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('shop_domain'), ('user_email'), ('shopify_user_id'),
        ('shopify_location_id')
      ) required(column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public'
          AND c.table_name='user_location_access'
          AND c.column_name=required.column_name
      )
    ) AS ready
),
sync_job_schema_ready AS (
  SELECT to_regclass('public.sync_jobs') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('shop_domain'), ('status'), ('job_type')
      ) required(column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public'
          AND c.table_name='sync_jobs'
          AND c.column_name=required.column_name
      )
    ) AS ready
),
object_findings AS (
  SELECT 'BLOCKED' severity, 'TABLE' check_type, name object_name,
    'Required prerequisite table is missing.' detail
  FROM required_tables WHERE to_regclass('public.' || name) IS NULL
  UNION ALL
  SELECT 'BLOCKED', 'VIEW', name, 'Required prerequisite view is missing.'
  FROM required_views
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname=name
  )
  UNION ALL
  SELECT 'BLOCKED', 'COLUMN', table_name || '.' || column_name,
    'Required prerequisite column is missing.'
  FROM required_columns
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name=required_columns.table_name
      AND c.column_name=required_columns.column_name
  )
  UNION ALL
  SELECT 'BLOCKED', 'FUNCTION', name || '(' || args || ')',
    'Required prerequisite function signature is missing.'
  FROM required_functions
  WHERE to_regprocedure('public.' || name || '(' || args || ')') IS NULL
  UNION ALL
  SELECT 'BLOCKED', 'INDEX', name, 'Required prerequisite index is missing.'
  FROM required_indexes WHERE to_regclass('public.' || name) IS NULL
),
constraint_findings AS (
  SELECT 'BLOCKED' severity, 'CONSTRAINT' check_type,
    'sync_jobs job_type check' object_name,
    'The final prerequisite job-type constraint must include full_refresh, financial_backfill_30d and orders_reconciliation_48h. Continue the historical migration sequence through 20260713120000_sync_automation_and_retention.sql.' detail
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid=to_regclass('public.sync_jobs') AND c.contype='c'
      AND pg_get_constraintdef(c.oid) LIKE '%full_refresh%'
      AND pg_get_constraintdef(c.oid) LIKE '%financial_backfill_30d%'
      AND pg_get_constraintdef(c.oid) LIKE '%orders_reconciliation_48h%'
  )
),
target_permission_duplicate_counts AS (
  SELECT
    CASE WHEN NOT permission_schema_ready.ready THEN NULL
      ELSE ((xpath(
        '/table/row/duplicate_groups/text()',
        query_to_xml(format($query$
          SELECT count(*) AS duplicate_groups FROM (
            SELECT 1 FROM public.user_location_access
            WHERE shop_domain = %L AND user_email IS NOT NULL
            GROUP BY shop_domain, lower(btrim(user_email)),
              coalesce(btrim(shopify_user_id), ''),
              coalesce(btrim(shopify_location_id), '')
            HAVING count(*) > 1
          ) duplicates
        $query$, target.shop_domain), false, false, '')
      ))[1]::text)::bigint END AS email_identity_groups,
    CASE WHEN NOT permission_schema_ready.ready THEN NULL
      ELSE ((xpath(
        '/table/row/duplicate_groups/text()',
        query_to_xml(format($query$
          SELECT count(*) AS duplicate_groups FROM (
            SELECT 1 FROM public.user_location_access
            WHERE shop_domain = %L AND shopify_user_id IS NOT NULL
            GROUP BY shop_domain, btrim(shopify_user_id),
              coalesce(btrim(shopify_location_id), '')
            HAVING count(*) > 1
          ) duplicates
        $query$, target.shop_domain), false, false, '')
      ))[1]::text)::bigint END AS user_identity_groups
  FROM target CROSS JOIN permission_schema_ready
),
global_permission_duplicate_counts AS (
  SELECT
    CASE WHEN NOT permission_schema_ready.ready THEN NULL
      ELSE ((xpath(
        '/table/row/duplicate_groups/text()',
        query_to_xml($query$
          SELECT count(*) AS duplicate_groups FROM (
            SELECT 1 FROM public.user_location_access
            WHERE user_email IS NOT NULL
            GROUP BY shop_domain, lower(btrim(user_email)),
              coalesce(btrim(shopify_user_id), ''),
              coalesce(btrim(shopify_location_id), '')
            HAVING count(*) > 1
          ) duplicates
        $query$, false, false, '')
      ))[1]::text)::bigint END AS email_identity_groups,
    CASE WHEN NOT permission_schema_ready.ready THEN NULL
      ELSE ((xpath(
        '/table/row/duplicate_groups/text()',
        query_to_xml($query$
          SELECT count(*) AS duplicate_groups FROM (
            SELECT 1 FROM public.user_location_access
            WHERE shopify_user_id IS NOT NULL
            GROUP BY shop_domain, btrim(shopify_user_id),
              coalesce(btrim(shopify_location_id), '')
            HAVING count(*) > 1
          ) duplicates
        $query$, false, false, '')
      ))[1]::text)::bigint END AS user_identity_groups
  FROM permission_schema_ready
),
active_full_job_count AS (
  SELECT CASE WHEN NOT sync_job_schema_ready.ready THEN NULL
    ELSE ((xpath(
      '/table/row/active_jobs/text()',
      query_to_xml(format($query$
        SELECT count(*) AS active_jobs
        FROM public.sync_jobs
        WHERE shop_domain = %L
          AND status IN ('pending', 'running')
          AND job_type IN ('full', 'full_refresh')
      $query$, target.shop_domain), false, false, '')
    ))[1]::text)::bigint END AS active_jobs
  FROM target CROSS JOIN sync_job_schema_ready
),
data_findings AS (
  SELECT 'BLOCKED' severity, 'TARGET' check_type, 'shop_domain' object_name,
    'Replace the target placeholder with exactly one intended pilot shop domain.' detail
  FROM target WHERE shop_domain ~ '^<[^>]+>$' OR btrim(shop_domain) = ''
  UNION ALL
  SELECT 'BLOCKED', 'PERMISSION_DUPLICATES',
    'target: email + Shopify user + location',
    email_identity_groups || ' duplicate normalized identity group(s) exist for the target shop. Target details are diagnostic; the global checks determine migration readiness.'
  FROM target_permission_duplicate_counts WHERE email_identity_groups > 0
  UNION ALL
  SELECT 'BLOCKED', 'PERMISSION_DUPLICATES',
    'target: Shopify user + location',
    user_identity_groups || ' duplicate normalized identity group(s) exist for the target shop. Target details are diagnostic; the global checks determine migration readiness.'
  FROM target_permission_duplicate_counts WHERE user_identity_groups > 0
  UNION ALL
  SELECT 'BLOCKED', 'GLOBAL_PERMISSION_DUPLICATES',
    'all tenants: email + Shopify user + location',
    email_identity_groups || ' duplicate normalized identity group(s) exist across user_location_access. The Phase 7P global unique index cannot be created.'
  FROM global_permission_duplicate_counts WHERE email_identity_groups > 0
  UNION ALL
  SELECT 'BLOCKED', 'GLOBAL_PERMISSION_DUPLICATES',
    'all tenants: Shopify user + location',
    user_identity_groups || ' duplicate normalized identity group(s) exist across user_location_access. The Phase 7P global strict user index cannot be created.'
  FROM global_permission_duplicate_counts WHERE user_identity_groups > 0
  UNION ALL
  SELECT 'WARNING', 'ACTIVE_JOB', 'full/full_refresh',
    active_jobs || ' active full operation(s) already exist for the target shop. Record or complete the work before starting the controlled pilot.'
  FROM active_full_job_count WHERE active_jobs > 0
),
findings AS (
  SELECT * FROM object_findings
  UNION ALL SELECT * FROM constraint_findings
  UNION ALL SELECT * FROM data_findings
),
summary AS (
  SELECT CASE
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='BLOCKED')
        THEN 'BLOCKED'
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='WARNING')
        THEN 'WARNING'
      ELSE 'GO'
    END severity,
    'SUMMARY' check_type,
    'Phase 7P preflight' object_name,
    CASE
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='BLOCKED')
        THEN 'Stop. Resolve every BLOCKED finding before applying the Phase 7P migration.'
      WHEN EXISTS (SELECT 1 FROM findings WHERE severity='WARNING')
        THEN 'Review warnings before applying the Phase 7P migration.'
      ELSE 'Prerequisite schema and all-tenant permission identities are ready; target-shop duplicate details also passed.'
    END detail
)
SELECT severity, check_type, object_name, detail
FROM (
SELECT * FROM findings
UNION ALL
SELECT * FROM summary
) results
ORDER BY
CASE results.severity
WHEN 'BLOCKED' THEN 1
WHEN 'WARNING' THEN 2
ELSE 3
END,
results.check_type,
results.object_name;
