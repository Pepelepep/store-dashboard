-- Production scale foundation:
-- - restore every reporting index on environments that missed the earlier
--   additive migration;
-- - remove redundant unique indexes that doubled write amplification;
-- - make maintenance leasing and shop redaction durable and concurrency-safe;
-- - index foreign keys and operational queue paths.

CREATE INDEX IF NOT EXISTS order_lines_shop_created_id_idx
  ON public.order_lines (shop_domain, created_at_shopify DESC, id ASC);

CREATE INDEX IF NOT EXISTS order_lines_shop_location_created_id_idx
  ON public.order_lines (
    shop_domain,
    retail_location_id,
    created_at_shopify DESC,
    id ASC
  );

CREATE INDEX IF NOT EXISTS order_transactions_shop_processed_id_idx
  ON public.order_transactions (shop_domain, processed_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS inventory_levels_shop_location_id_idx
  ON public.inventory_levels (shop_domain, shopify_location_id, id ASC);

CREATE INDEX IF NOT EXISTS variants_shop_id_idx
  ON public.variants (shop_domain, id ASC);

CREATE INDEX IF NOT EXISTS products_shop_id_idx
  ON public.products (shop_domain, id ASC);

CREATE INDEX IF NOT EXISTS sync_runs_shop_status_finished_idx
  ON public.sync_runs (shop_domain, status, finished_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS webhook_events_shop_status_processed_idx
  ON public.webhook_events (shop_domain, status, processed_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS webhook_events_done_processed_idx
  ON public.webhook_events (processed_at ASC, id ASC)
  WHERE status = 'done';

CREATE INDEX IF NOT EXISTS sync_automation_due_idx
  ON public.sync_automation_state (next_reconciliation_due_at ASC, shop_domain ASC);

CREATE INDEX IF NOT EXISTS sync_jobs_pending_created_idx
  ON public.sync_jobs (created_at ASC, id ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS dashboard_memberships_person_id_idx
  ON public.dashboard_memberships (person_id);

CREATE INDEX IF NOT EXISTS staff_identity_aliases_person_id_idx
  ON public.staff_identity_aliases (person_id);

CREATE INDEX IF NOT EXISTS user_location_access_membership_id_idx
  ON public.user_location_access (membership_id);

CREATE INDEX IF NOT EXISTS user_location_access_person_id_idx
  ON public.user_location_access (person_id);

-- These indexes duplicate constraint-backed unique indexes with the same
-- columns. Keeping both makes every sync update two identical btrees.
DROP INDEX IF EXISTS public.inventory_levels_shop_location_item_uidx;
DROP INDEX IF EXISTS public.inventory_items_shop_inventory_item_uidx;
DROP INDEX IF EXISTS public.variants_shop_variant_uidx;
DROP INDEX IF EXISTS public.order_lines_shop_line_item_uidx;
DROP INDEX IF EXISTS public.orders_shop_order_uidx;
DROP INDEX IF EXISTS public.products_shop_product_uidx;
DROP INDEX IF EXISTS public.locations_shop_location_uidx;

ALTER TABLE public.inventory_items SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.inventory_levels SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.order_lines SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.webhook_events SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE public.maintenance_tick_state
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_maintenance_tick(
  p_lease_seconds integer DEFAULT 240
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_claimed uuid;
BEGIN
  INSERT INTO public.maintenance_tick_state (singleton, updated_at)
  VALUES (true, v_now)
  ON CONFLICT (singleton) DO NOTHING;

  UPDATE public.maintenance_tick_state
  SET
    lease_token = v_token,
    lease_expires_at = v_now + make_interval(
      secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 240), 30), 900)
    ),
    last_started_at = v_now,
    updated_at = v_now
  WHERE singleton = true
    AND (lease_expires_at IS NULL OR lease_expires_at <= v_now)
  RETURNING lease_token INTO v_claimed;

  RETURN v_claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_maintenance_tick(
  p_lease_token uuid,
  p_succeeded boolean,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE public.maintenance_tick_state
  SET
    last_completed_at = v_now,
    last_succeeded_at = CASE
      WHEN p_succeeded THEN v_now
      ELSE last_succeeded_at
    END,
    last_error = CASE
      WHEN p_succeeded THEN NULL
      ELSE LEFT(COALESCE(p_error, 'Maintenance tick failed.'), 1000)
    END,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = v_now
  WHERE singleton = true
    AND lease_token = p_lease_token;

  RETURN FOUND;
END;
$$;

CREATE TABLE IF NOT EXISTS public.shop_redaction_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain text NOT NULL,
  shopify_webhook_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  current_table_index integer NOT NULL DEFAULT 0 CHECK (current_table_index >= 0),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_redaction_jobs ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS shop_redaction_jobs_webhook_uidx
  ON public.shop_redaction_jobs (shop_domain, shopify_webhook_id)
  WHERE shopify_webhook_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS shop_redaction_jobs_one_active_shop_uidx
  ON public.shop_redaction_jobs (shop_domain)
  WHERE status IN ('pending', 'processing', 'error');

CREATE INDEX IF NOT EXISTS shop_redaction_jobs_claim_idx
  ON public.shop_redaction_jobs (status, available_at, received_at, id);

CREATE OR REPLACE FUNCTION public.claim_shop_redaction_jobs(
  p_batch_size integer DEFAULT 2,
  p_max_attempts integer DEFAULT 10,
  p_stale_after interval DEFAULT interval '15 minutes'
)
RETURNS SETOF public.shop_redaction_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.shop_redaction_jobs
    WHERE attempt_count < LEAST(GREATEST(COALESCE(p_max_attempts, 10), 1), 50)
      AND (
        (status IN ('pending', 'error') AND available_at <= now())
        OR (
          status = 'processing'
          AND processing_started_at IS NOT NULL
          AND processing_started_at < now() - p_stale_after
        )
      )
    ORDER BY available_at ASC, received_at ASC, id ASC
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 2), 1), 10)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.shop_redaction_jobs AS job
  SET
    status = 'processing',
    attempt_count = job.attempt_count + 1,
    processing_started_at = now(),
    last_error = NULL,
    updated_at = now()
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_shop_table_batch(
  p_shop_domain text,
  p_table_name text,
  p_batch_size integer DEFAULT 2000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed_tables CONSTANT text[] := ARRAY[
    'webhook_events',
    'sync_jobs',
    'sync_runs',
    'order_transactions',
    'fixed_expenses',
    'user_location_access',
    'dashboard_memberships',
    'staff_identity_aliases',
    'staff_people',
    'order_lines',
    'orders',
    'inventory_levels',
    'inventory_items',
    'variants',
    'products',
    'locations',
    'staff_members',
    'sync_automation_state',
    'pos_attribution_setup',
    'shops'
  ];
  v_deleted integer;
  v_limit integer := LEAST(GREATEST(COALESCE(p_batch_size, 2000), 1), 10000);
BEGIN
  IF NULLIF(BTRIM(p_shop_domain), '') IS NULL
    OR NOT (p_table_name = ANY(v_allowed_tables)) THEN
    RAISE EXCEPTION 'invalid_shop_redaction_batch';
  END IF;

  EXECUTE format(
    'DELETE FROM public.%I WHERE ctid IN (' ||
    'SELECT ctid FROM public.%I WHERE shop_domain = $1 LIMIT $2' ||
    ')',
    p_table_name,
    p_table_name
  )
  USING p_shop_domain, v_limit;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE TABLE IF NOT EXISTS public.shopops_schema_versions (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shopops_schema_versions ENABLE ROW LEVEL SECURITY;

INSERT INTO public.shopops_schema_versions (version)
VALUES ('20260815173141_scale_foundation_queues_and_indexes')
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_shopops_operational_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'maintenance_last_succeeded_at', (
      SELECT last_succeeded_at
      FROM public.maintenance_tick_state
      WHERE singleton = true
    ),
    'maintenance_lease_expires_at', (
      SELECT lease_expires_at
      FROM public.maintenance_tick_state
      WHERE singleton = true
    ),
    'webhooks_pending', (
      SELECT count(*)
      FROM public.webhook_events
      WHERE status = 'pending'
    ),
    'webhooks_processing', (
      SELECT count(*)
      FROM public.webhook_events
      WHERE status = 'processing'
    ),
    'webhooks_terminal_error', (
      SELECT count(*)
      FROM public.webhook_events
      WHERE status = 'error' AND attempt_count >= 5
    ),
    'oldest_webhook_pending_at', (
      SELECT min(received_at)
      FROM public.webhook_events
      WHERE status = 'pending'
    ),
    'sync_jobs_pending', (
      SELECT count(*)
      FROM public.sync_jobs
      WHERE status = 'pending'
    ),
    'sync_jobs_running', (
      SELECT count(*)
      FROM public.sync_jobs
      WHERE status = 'running'
    ),
    'oldest_sync_job_pending_at', (
      SELECT min(created_at)
      FROM public.sync_jobs
      WHERE status = 'pending'
    ),
    'redactions_pending', (
      SELECT count(*)
      FROM public.shop_redaction_jobs
      WHERE status IN ('pending', 'processing', 'error')
    ),
    'oldest_redaction_pending_at', (
      SELECT min(received_at)
      FROM public.shop_redaction_jobs
      WHERE status IN ('pending', 'processing', 'error')
    ),
    'reconciliations_due', (
      SELECT count(*)
      FROM public.sync_automation_state
      WHERE next_reconciliation_due_at <= now()
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_reporting_order_lines(
  p_shop_domain text,
  p_location_ids text[],
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_staff_key text DEFAULT NULL,
  p_vendor text DEFAULT NULL
)
RETURNS SETOF public.order_lines
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT line.*
  FROM public.order_lines AS line
  WHERE line.shop_domain = p_shop_domain
    AND line.retail_location_id = ANY(p_location_ids)
    AND line.created_at_shopify >= p_start_at
    AND line.created_at_shopify < p_end_at
    AND (
      NULLIF(BTRIM(p_vendor), '') IS NULL
      OR COALESCE(NULLIF(BTRIM(line.vendor), ''), '-') = p_vendor
    )
    AND (
      NULLIF(BTRIM(p_staff_key), '') IS NULL
      OR (
        p_staff_key = 'staff:unassigned'
        AND NULLIF(BTRIM(line.shopops_effective_staff_id), '') IS NULL
      )
      OR (
        p_staff_key = 'staff:unmapped'
        AND NULLIF(BTRIM(line.shopops_effective_staff_id), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.staff_identity_aliases AS alias
          WHERE alias.shop_domain = line.shop_domain
            AND alias.alias_value = line.shopops_effective_staff_id
            AND alias.alias_type = CASE line.shopops_attribution_source
              WHEN 'attributed_user_id' THEN 'pos_attributed_user_id'
              WHEN 'attributed_staff_member_id' THEN 'pos_staff_member_id'
              WHEN 'pos_session_staff_member' THEN 'pos_staff_member_id'
              WHEN 'pos_session_user' THEN 'pos_user_id'
              WHEN 'pos_session' THEN 'pos_user_id'
              ELSE 'pos_effective_staff_id'
            END
            AND alias.person_id IS NOT NULL
        )
      )
      OR (
        p_staff_key LIKE 'person:%'
        AND EXISTS (
          SELECT 1
          FROM public.staff_identity_aliases AS alias
          WHERE alias.shop_domain = line.shop_domain
            AND alias.alias_value = line.shopops_effective_staff_id
            AND alias.alias_type = CASE line.shopops_attribution_source
              WHEN 'attributed_user_id' THEN 'pos_attributed_user_id'
              WHEN 'attributed_staff_member_id' THEN 'pos_staff_member_id'
              WHEN 'pos_session_staff_member' THEN 'pos_staff_member_id'
              WHEN 'pos_session_user' THEN 'pos_user_id'
              WHEN 'pos_session' THEN 'pos_user_id'
              ELSE 'pos_effective_staff_id'
            END
            AND alias.person_id::text = SUBSTRING(p_staff_key FROM 8)
        )
      )
    )
  ORDER BY line.created_at_shopify DESC, line.id ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_reporting_filter_options(
  p_shop_domain text,
  p_location_ids text[],
  p_start_at timestamptz,
  p_end_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT line.*
    FROM public.order_lines AS line
    WHERE line.shop_domain = p_shop_domain
      AND line.retail_location_id = ANY(p_location_ids)
      AND line.created_at_shopify >= p_start_at
      AND line.created_at_shopify < p_end_at
  ),
  vendor_options AS (
    SELECT DISTINCT
      NULLIF(BTRIM(vendor), '') AS value
    FROM scoped
    WHERE NULLIF(BTRIM(vendor), '') IS NOT NULL
  ),
  staff_options AS (
    SELECT DISTINCT
      CASE
        WHEN alias.person_id IS NOT NULL AND person.display_name IS NOT NULL
          THEN 'person:' || alias.person_id::text
        WHEN NULLIF(BTRIM(line.shopops_effective_staff_id), '') IS NOT NULL
          THEN 'staff:unmapped'
        ELSE 'staff:unassigned'
      END AS value,
      CASE
        WHEN alias.person_id IS NOT NULL AND person.display_name IS NOT NULL
          THEN person.display_name
        WHEN NULLIF(BTRIM(line.shopops_effective_staff_id), '') IS NOT NULL
          THEN 'Unmapped POS seller'
        ELSE 'Unassigned'
      END AS label
    FROM scoped AS line
    LEFT JOIN public.staff_identity_aliases AS alias
      ON alias.shop_domain = line.shop_domain
      AND alias.alias_value = line.shopops_effective_staff_id
      AND alias.alias_type = CASE line.shopops_attribution_source
        WHEN 'attributed_user_id' THEN 'pos_attributed_user_id'
        WHEN 'attributed_staff_member_id' THEN 'pos_staff_member_id'
        WHEN 'pos_session_staff_member' THEN 'pos_staff_member_id'
        WHEN 'pos_session_user' THEN 'pos_user_id'
        WHEN 'pos_session' THEN 'pos_user_id'
        ELSE 'pos_effective_staff_id'
      END
    LEFT JOIN public.staff_people AS person
      ON person.shop_domain = alias.shop_domain
      AND person.id = alias.person_id
  )
  SELECT jsonb_build_object(
    'vendors', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('value', value, 'label', value)
        ORDER BY value
      )
      FROM vendor_options
    ), '[]'::jsonb),
    'staff', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('value', value, 'label', label)
        ORDER BY label, value
      )
      FROM staff_options
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON TABLE public.shop_redaction_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.shopops_schema_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_redaction_jobs TO service_role;
GRANT SELECT ON TABLE public.shopops_schema_versions TO service_role;

REVOKE ALL ON FUNCTION public.claim_maintenance_tick(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_maintenance_tick(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_shop_redaction_jobs(integer, integer, interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_shop_table_batch(text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_shopops_operational_health()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_reporting_order_lines(
  text, text[], timestamptz, timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_reporting_filter_options(
  text, text[], timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_maintenance_tick(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_maintenance_tick(uuid, boolean, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_shop_redaction_jobs(integer, integer, interval)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_shop_table_batch(text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_shopops_operational_health()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_reporting_order_lines(
  text, text[], timestamptz, timestamptz, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_reporting_filter_options(
  text, text[], timestamptz, timestamptz
) TO service_role;

ANALYZE public.order_lines;
ANALYZE public.order_transactions;
ANALYZE public.inventory_levels;
ANALYZE public.variants;
ANALYZE public.products;
ANALYZE public.sync_runs;
ANALYZE public.sync_jobs;
ANALYZE public.webhook_events;
