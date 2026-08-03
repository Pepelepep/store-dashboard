-- Portable schema-only baseline of the reviewed remote public application schema.
-- Captured immediately before the pending 20260802120000 canonical-access migration.
-- Prisma-owned objects, auditor-specific grants, and non-portable ownership are omitted.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


COMMENT ON SCHEMA "public" IS 'standard public schema';


CREATE OR REPLACE FUNCTION "public"."archive_staff_with_dashboard_protection"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_person_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_membership_id uuid;
  v_role text;
  v_owner boolean;
  v_has_aliases boolean;
BEGIN
  IF v_shop IS NULL OR p_actor_membership_id IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'staff_member_not_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shopops-memberships:' || v_shop, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  PERFORM 1 FROM public.staff_people people
  WHERE people.shop_domain = v_shop AND people.id = p_person_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_member_not_found'; END IF;

  SELECT id, role, is_owner
  INTO v_membership_id, v_role, v_owner
  FROM public.dashboard_memberships
  WHERE shop_domain = v_shop AND person_id = p_person_id
  FOR UPDATE;

  IF v_owner THEN RAISE EXCEPTION 'owner_membership_locked'; END IF;
  IF v_membership_id IS NOT NULL AND v_role = 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'admin')
      AND membership.id <> v_membership_id
  ) THEN
    RAISE EXCEPTION 'last_admin_required';
  END IF;

  IF v_membership_id IS NOT NULL THEN
    UPDATE public.dashboard_memberships
    SET status = 'disabled', updated_at = now()
    WHERE id = v_membership_id;
    DELETE FROM public.user_location_access
    WHERE shop_domain = v_shop AND membership_id = v_membership_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop AND alias.person_id = p_person_id
  ) INTO v_has_aliases;

  IF v_membership_id IS NULL AND NOT v_has_aliases THEN
    DELETE FROM public.staff_people
    WHERE shop_domain = v_shop AND id = p_person_id;
    RETURN 'deleted';
  END IF;

  UPDATE public.staff_people
  SET is_active = false, updated_at = now()
  WHERE shop_domain = v_shop AND id = p_person_id;
  RETURN 'archived';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "topic" "text" NOT NULL,
    "shopify_webhook_id" "text",
    "resource_gid" "text",
    "parent_resource_gid" "text",
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "available_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processing_started_at" timestamp with time zone,
    "processed_at" timestamp with time zone,
    CONSTRAINT "webhook_events_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'done'::"text", 'error'::"text"])))
);


CREATE OR REPLACE FUNCTION "public"."claim_webhook_events"("p_batch_size" integer DEFAULT 25, "p_max_attempts" integer DEFAULT 5, "p_stale_after" interval DEFAULT '00:15:00'::interval) RETURNS SETOF "public"."webhook_events"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT id
        FROM public.webhook_events
        WHERE attempt_count < p_max_attempts
            AND (
                (status IN ('pending', 'error') AND available_at <= now())
                OR (
                    status = 'processing'
                    AND processing_started_at IS NOT NULL
                    AND processing_started_at < now() - p_stale_after
                )
            )
        ORDER BY available_at ASC, received_at ASC
        LIMIT GREATEST(p_batch_size, 0)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.webhook_events AS event
    SET
        status = 'processing',
        processing_started_at = now(),
        processed_at = NULL
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.*;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."cleanup_operational_sync_history"("p_batch_size" integer DEFAULT 500) RETURNS TABLE("sync_jobs_deleted" integer, "sync_runs_deleted" integer, "webhook_events_deleted" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(coalesce(p_batch_size, 500), 1), 2000);
BEGIN
  WITH deleted AS (
    DELETE FROM public.sync_jobs
    WHERE id IN (
      SELECT id FROM public.sync_jobs
      WHERE (
        (status = 'success' AND finished_at < now() - interval '30 days')
        OR (status = 'cancelled' AND finished_at < now() - interval '90 days')
      )
      ORDER BY finished_at ASC
      LIMIT v_limit
    )
    RETURNING 1
  ) SELECT count(*)::integer INTO sync_jobs_deleted FROM deleted;

  WITH deleted AS (
    DELETE FROM public.sync_runs
    WHERE id IN (
      SELECT id FROM public.sync_runs
      WHERE (
        (status = 'success' AND finished_at < now() - interval '30 days')
        OR (status = 'error' AND finished_at < now() - interval '90 days')
      )
      ORDER BY finished_at ASC
      LIMIT v_limit
    )
    RETURNING 1
  ) SELECT count(*)::integer INTO sync_runs_deleted FROM deleted;

  WITH deleted AS (
    DELETE FROM public.webhook_events
    WHERE id IN (
      SELECT id FROM public.webhook_events
      WHERE status = 'done'
        AND processed_at < now() - interval '30 days'
      ORDER BY processed_at ASC
      LIMIT v_limit
    )
    RETURNING 1
  ) SELECT count(*)::integer INTO webhook_events_deleted FROM deleted;

  RETURN NEXT;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."disable_dashboard_membership"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_target_membership_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_target_role text;
  v_target_owner boolean;
BEGIN
  IF v_shop IS NULL OR p_actor_membership_id IS NULL OR p_target_membership_id IS NULL THEN
    RAISE EXCEPTION 'invalid_membership';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shopops-memberships:' || v_shop, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  SELECT membership.role, membership.is_owner
  INTO v_target_role, v_target_owner
  FROM public.dashboard_memberships membership
  WHERE membership.id = p_target_membership_id
    AND membership.shop_domain = v_shop
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_not_found'; END IF;
  IF v_target_owner THEN RAISE EXCEPTION 'owner_membership_locked'; END IF;

  IF v_target_role = 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'admin')
      AND membership.id <> p_target_membership_id
  ) THEN
    RAISE EXCEPTION 'last_admin_required';
  END IF;

  UPDATE public.dashboard_memberships
  SET status = 'disabled', updated_at = now()
  WHERE id = p_target_membership_id;

  DELETE FROM public.user_location_access
  WHERE shop_domain = v_shop AND membership_id = p_target_membership_id;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."get_data_quality_report"("p_shop_domain" "text", "p_location_ids" "text"[] DEFAULT NULL::"text"[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


CREATE OR REPLACE FUNCTION "public"."get_missing_product_costs_page"("p_shop_domain" "text", "p_search" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 25, "p_offset" integer DEFAULT 0) RETURNS TABLE("group_key" "text", "product_title" "text", "variant_title" "text", "units_sold" bigint, "sales_affected" numeric, "shopify_product_id" "text", "total_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


CREATE OR REPLACE FUNCTION "public"."get_product_cost_coverage_summary"("p_shop_domain" "text") RETURNS TABLE("actual_line_count" bigint, "estimated_line_count" bigint, "missing_line_count" bigint, "missing_sales_amount" numeric, "affected_product_count" bigint, "actual_cogs" numeric, "estimated_cogs" numeric, "total_net_sales" numeric, "product_missing_line_count" bigint, "product_estimate_basis" numeric, "custom_missing_line_count" bigint, "custom_estimate_basis" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


CREATE OR REPLACE FUNCTION "public"."materialize_dashboard_owner"("p_shop_domain" "text", "p_shopify_user_id" "text", "p_normalized_email" "text", "p_display_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_user_id text := nullif(btrim(p_shopify_user_id), '');
  v_email text := lower(nullif(btrim(p_normalized_email), ''));
  v_display_name text := coalesce(nullif(btrim(p_display_name), ''), v_email, v_user_id, 'Store owner');
  v_owner_id uuid;
  v_identity_owner uuid;
BEGIN
  IF v_shop IS NULL OR (v_user_id IS NULL AND v_email IS NULL) THEN
    RAISE EXCEPTION 'invalid_owner_identity';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('shopops-memberships:' || v_shop, 0));

  SELECT membership.id
  INTO v_owner_id
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop AND membership.is_owner = true
  FOR UPDATE;

  SELECT membership.id
  INTO v_identity_owner
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND (
      (v_user_id IS NOT NULL AND membership.shopify_user_id = v_user_id)
      OR (v_email IS NOT NULL AND lower(membership.normalized_email) = v_email)
    )
  ORDER BY membership.is_owner DESC, membership.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_owner_id IS NULL THEN
    IF v_identity_owner IS NOT NULL THEN
      v_owner_id := v_identity_owner;
      UPDATE public.dashboard_memberships
      SET
        shopify_user_id = coalesce(v_user_id, shopify_user_id),
        normalized_email = coalesce(v_email, normalized_email),
        display_name = v_display_name,
        role = 'owner',
        status = 'active',
        is_owner = true,
        updated_at = now()
      WHERE id = v_owner_id;
    ELSE
      INSERT INTO public.dashboard_memberships (
        shop_domain, shopify_user_id, normalized_email, display_name,
        role, status, is_owner
      ) VALUES (
        v_shop, v_user_id, v_email, v_display_name,
        'owner', 'active', true
      ) RETURNING id INTO v_owner_id;
    END IF;
  ELSE
    IF v_identity_owner IS NOT NULL AND v_identity_owner <> v_owner_id THEN
      RAISE EXCEPTION 'owner_identity_conflict';
    END IF;

    UPDATE public.dashboard_memberships
    SET
      shopify_user_id = coalesce(v_user_id, shopify_user_id),
      normalized_email = coalesce(v_email, normalized_email),
      display_name = v_display_name,
      role = 'owner',
      status = 'active',
      is_owner = true,
      updated_at = now()
    WHERE id = v_owner_id;
  END IF;

  RETURN v_owner_id;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."recompute_order_line_cogs_for_inventory_items"("p_shop_domain" "text", "p_inventory_item_ids" "text"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


CREATE OR REPLACE FUNCTION "public"."recompute_order_line_cogs_for_shop"("p_shop_domain" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    updated_count integer;
BEGIN
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
            settings.estimate_custom_sales
        FROM public.order_lines AS order_line
        LEFT JOIN public.variants AS variant
            ON variant.shop_domain = order_line.shop_domain
            AND variant.shopify_variant_id = order_line.shopify_variant_id
        CROSS JOIN shop_settings AS settings
        WHERE order_line.shop_domain = p_shop_domain
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
                        order_line.shopify_variant_id IS NOT NULL
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
                        order_line.shopify_variant_id IS NOT NULL
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
                        order_line.shopify_variant_id IS NOT NULL
                        OR resolved_line.estimate_custom_sales
                    )
                    THEN resolved_line.estimate_percent
                ELSE NULL
            END AS applied_estimate_percent
        FROM resolved_lines AS resolved_line
        JOIN public.order_lines AS order_line
            ON order_line.id = resolved_line.id
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


CREATE OR REPLACE FUNCTION "public"."recompute_order_line_cogs_for_variants"("p_shop_domain" "text", "p_variant_ids" "text"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    updated_count integer;
BEGIN
    WITH shop_settings AS (
        SELECT
            COALESCE(shop.cogs_estimate_enabled, false) AS estimate_enabled,
            shop.cogs_estimate_percent AS estimate_percent
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
            settings.estimate_percent
        FROM public.order_lines AS order_line
        LEFT JOIN public.variants AS variant
            ON variant.shop_domain = order_line.shop_domain
            AND variant.shopify_variant_id = order_line.shopify_variant_id
        CROSS JOIN shop_settings AS settings
        WHERE order_line.shop_domain = p_shop_domain
            AND order_line.shopify_variant_id = ANY(p_variant_ids)
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
                    THEN 'SHOP_PERCENT_ESTIMATE'
                ELSE 'MISSING_COST'
            END AS cost_source,
            CASE
                WHEN resolved_line.remaining_quantity > 0
                    AND resolved_line.actual_unit_cost IS NULL
                    AND resolved_line.estimate_enabled
                    AND resolved_line.estimate_percent BETWEEN 0 AND 100
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


CREATE OR REPLACE FUNCTION "public"."remove_or_archive_staff"("p_shop_domain" "text", "p_person_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_has_access boolean;
  v_has_aliases boolean;
  v_has_pos_aliases boolean;
  v_email text;
BEGIN
  IF nullif(trim(p_shop_domain), '') IS NULL OR p_person_id IS NULL THEN
    RAISE EXCEPTION 'staff_member_not_found';
  END IF;

  SELECT lower(nullif(trim(people.email), ''))
  INTO v_email
  FROM public.staff_people people
  WHERE people.shop_domain = p_shop_domain
    AND people.id = p_person_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_member_not_found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_location_access access
    WHERE access.shop_domain = p_shop_domain
      AND (
        access.person_id = p_person_id
        OR (v_email IS NOT NULL AND lower(access.user_email) = v_email)
        OR EXISTS (
          SELECT 1 FROM public.staff_identity_aliases aliases
          WHERE aliases.shop_domain = p_shop_domain
            AND aliases.person_id = p_person_id
            AND (
              (aliases.alias_type = 'email' AND lower(access.user_email) = lower(aliases.alias_value))
              OR (
                aliases.alias_type = 'shopify_admin_user_id'
                AND access.shopify_user_id = aliases.alias_value
              )
            )
        )
      )
  ) INTO v_has_access;

  SELECT
    EXISTS (
      SELECT 1 FROM public.staff_identity_aliases aliases
      WHERE aliases.shop_domain = p_shop_domain
        AND aliases.person_id = p_person_id
    ),
    EXISTS (
      SELECT 1 FROM public.staff_identity_aliases aliases
      WHERE aliases.shop_domain = p_shop_domain
        AND aliases.person_id = p_person_id
        AND aliases.alias_type IN (
          'pos_staff_member_id', 'pos_user_id',
          'pos_attributed_user_id', 'pos_effective_staff_id'
        )
    )
  INTO v_has_aliases, v_has_pos_aliases;

  IF NOT v_has_access AND NOT v_has_aliases AND NOT v_has_pos_aliases THEN
    DELETE FROM public.staff_people
    WHERE shop_domain = p_shop_domain AND id = p_person_id;
    RETURN 'deleted';
  END IF;

  IF v_has_access THEN
    PERFORM public.remove_staff_dashboard_access(p_shop_domain, p_person_id);
    DELETE FROM public.user_location_access access
    WHERE access.shop_domain = p_shop_domain
      AND v_email IS NOT NULL
      AND lower(access.user_email) = v_email;
  END IF;

  UPDATE public.staff_people
  SET is_active = false, updated_at = now()
  WHERE shop_domain = p_shop_domain AND id = p_person_id;

  RETURN 'archived';
END;
$$;


CREATE OR REPLACE FUNCTION "public"."remove_staff_dashboard_access"("p_shop_domain" "text", "p_person_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_known_emails text[];
  v_shopify_user_ids text[];
BEGIN
  IF nullif(trim(p_shop_domain), '') IS NULL OR p_person_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.staff_people people
    WHERE people.shop_domain = p_shop_domain AND people.id = p_person_id
  ) THEN
    RAISE EXCEPTION 'staff_member_not_found';
  END IF;

  SELECT
    coalesce(array_agg(DISTINCT lower(aliases.alias_value)) FILTER (WHERE aliases.alias_type = 'email'), ARRAY[]::text[]),
    coalesce(array_agg(DISTINCT aliases.alias_value) FILTER (WHERE aliases.alias_type = 'shopify_admin_user_id'), ARRAY[]::text[])
  INTO v_known_emails, v_shopify_user_ids
  FROM public.staff_identity_aliases aliases
  WHERE aliases.shop_domain = p_shop_domain AND aliases.person_id = p_person_id;

  DELETE FROM public.user_location_access access
  WHERE access.shop_domain = p_shop_domain
    AND (
      access.person_id = p_person_id
      OR (access.user_email IS NOT NULL AND lower(access.user_email) = ANY(v_known_emails))
      OR (access.shopify_user_id IS NOT NULL AND access.shopify_user_id = ANY(v_shopify_user_ids))
    );
END;
$$;


CREATE OR REPLACE FUNCTION "public"."replace_dashboard_membership_access"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_person_id" "uuid", "p_canonical_email" "text", "p_role" "text", "p_location_ids" "text"[], "p_shopify_user_ids" "text"[], "p_dashboard_user_limit" integer) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_email text := lower(nullif(btrim(p_canonical_email), ''));
  v_display_name text;
  v_membership_id uuid;
  v_existing_role text;
  v_existing_status text;
  v_location_ids text[];
  v_user_ids text[];
  v_active_count integer;
BEGIN
  IF v_shop IS NULL OR p_actor_membership_id IS NULL OR p_person_id IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'invalid_access_identity';
  END IF;
  IF p_role NOT IN ('admin', 'manager', 'viewer') THEN
    RAISE EXCEPTION 'invalid_access_role';
  END IF;
  IF v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_access_identity';
  END IF;
  IF p_dashboard_user_limit IS NOT NULL AND p_dashboard_user_limit < 1 THEN
    RAISE EXCEPTION 'invalid_plan_limit';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('shopops-memberships:' || v_shop, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  SELECT people.display_name
  INTO v_display_name
  FROM public.staff_people people
  WHERE people.id = p_person_id
    AND people.shop_domain = v_shop
    AND people.is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active_staff_member_required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'email'
      AND lower(alias.alias_value) = v_email
      AND alias.person_id IS DISTINCT FROM p_person_id
  ) THEN
    RAISE EXCEPTION 'login_email_in_use';
  END IF;

  SELECT membership.id, membership.role, membership.status
  INTO v_membership_id, v_existing_role, v_existing_status
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND (
      membership.person_id = p_person_id
      OR lower(membership.normalized_email) = v_email
    )
  ORDER BY (membership.person_id = p_person_id) DESC, membership.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_membership_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.id = v_membership_id AND membership.is_owner = true
  ) THEN
    RAISE EXCEPTION 'owner_membership_locked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop
      AND membership.id IS DISTINCT FROM v_membership_id
      AND lower(membership.normalized_email) = v_email
  ) THEN
    RAISE EXCEPTION 'dashboard_identity_in_use';
  END IF;

  SELECT coalesce(array_agg(DISTINCT btrim(value)) FILTER (WHERE nullif(btrim(value), '') IS NOT NULL), ARRAY[]::text[])
  INTO v_user_ids
  FROM unnest(coalesce(p_shopify_user_ids, ARRAY[]::text[])) value;

  IF EXISTS (
    SELECT 1 FROM unnest(v_user_ids) requested(value)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_identity_aliases alias
      WHERE alias.shop_domain = v_shop
        AND alias.person_id = p_person_id
        AND alias.alias_type = 'shopify_admin_user_id'
        AND alias.alias_value = requested.value
    )
  ) THEN
    RAISE EXCEPTION 'invalid_login_identity';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop
      AND membership.id IS DISTINCT FROM v_membership_id
      AND membership.shopify_user_id = ANY(v_user_ids)
  ) THEN
    RAISE EXCEPTION 'dashboard_identity_in_use';
  END IF;

  IF p_role = 'admin' THEN
    v_location_ids := ARRAY['*']::text[];
  ELSE
    SELECT coalesce(array_agg(DISTINCT location.shopify_location_id), ARRAY[]::text[])
    INTO v_location_ids
    FROM public.locations location
    WHERE location.shop_domain = v_shop
      AND location.shopify_is_active = true
      AND location.reporting_enabled = true
      AND location.shopify_location_id = ANY(coalesce(p_location_ids, ARRAY[]::text[]));

    IF cardinality(v_location_ids) = 0
      OR cardinality(v_location_ids) <> cardinality(ARRAY(
        SELECT DISTINCT btrim(value)
        FROM unnest(coalesce(p_location_ids, ARRAY[]::text[])) value
        WHERE nullif(btrim(value), '') IS NOT NULL
      )) THEN
      RAISE EXCEPTION 'invalid_access_locations';
    END IF;
  END IF;

  IF v_existing_role = 'admin' AND p_role <> 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'admin')
      AND membership.id <> v_membership_id
  ) THEN
    RAISE EXCEPTION 'last_admin_required';
  END IF;

  IF v_membership_id IS NULL OR v_existing_status <> 'active' THEN
    SELECT count(*)::integer
    INTO v_active_count
    FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop AND membership.status = 'active';

    IF p_dashboard_user_limit IS NOT NULL AND v_active_count >= p_dashboard_user_limit THEN
      RAISE EXCEPTION 'dashboard_plan_capacity';
    END IF;
  END IF;

  IF v_membership_id IS NULL THEN
    INSERT INTO public.dashboard_memberships (
      shop_domain, person_id, shopify_user_id, normalized_email,
      display_name, role, status, is_owner
    ) VALUES (
      v_shop, p_person_id, v_user_ids[1], v_email,
      v_display_name, p_role, 'active', false
    ) RETURNING id INTO v_membership_id;
  ELSE
    UPDATE public.dashboard_memberships
    SET
      person_id = p_person_id,
      shopify_user_id = coalesce(v_user_ids[1], shopify_user_id),
      normalized_email = v_email,
      display_name = v_display_name,
      role = p_role,
      status = 'active',
      updated_at = now()
    WHERE id = v_membership_id;
  END IF;

  INSERT INTO public.staff_identity_aliases (
    shop_domain, person_id, alias_type, alias_value, source,
    review_status, first_seen_at, last_seen_at, updated_at
  ) VALUES (
    v_shop, p_person_id, 'email', v_email, 'staff_manager',
    'mapped', now(), now(), now()
  )
  ON CONFLICT (shop_domain, alias_type, alias_value)
  DO UPDATE SET
    person_id = EXCLUDED.person_id,
    review_status = 'mapped',
    last_seen_at = now(),
    updated_at = now();

  UPDATE public.staff_people
  SET email = v_email, updated_at = now()
  WHERE id = p_person_id AND shop_domain = v_shop;

  DELETE FROM public.user_location_access access
  WHERE access.shop_domain = v_shop
    AND (
      access.membership_id = v_membership_id
      OR access.person_id = p_person_id
      OR lower(access.user_email) = v_email
      OR access.shopify_user_id = ANY(v_user_ids)
    );

  INSERT INTO public.user_location_access (
    shop_domain, membership_id, person_id, access_label, user_email,
    shopify_user_id, shopify_location_id, location_name,
    role, can_view, can_manage
  )
  SELECT DISTINCT
    v_shop,
    v_membership_id,
    p_person_id,
    v_display_name,
    v_email,
    identities.shopify_user_id,
    location_id,
    CASE WHEN location_id = '*' THEN 'All reporting locations' ELSE location.name END,
    p_role,
    true,
    p_role IN ('manager', 'admin')
  FROM unnest(v_location_ids) location_id
  LEFT JOIN public.locations location
    ON location.shop_domain = v_shop
   AND location.shopify_location_id = location_id
  CROSS JOIN LATERAL unnest(
    CASE WHEN cardinality(v_user_ids) = 0 THEN ARRAY[NULL]::text[] ELSE v_user_ids END
  ) identities(shopify_user_id);

  RETURN v_membership_id;
END;
$_$;


CREATE OR REPLACE FUNCTION "public"."replace_staff_dashboard_access"("p_shop_domain" "text", "p_person_id" "uuid", "p_canonical_email" "text", "p_role" "text", "p_location_ids" "text"[], "p_shopify_user_ids" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_email text := lower(nullif(trim(p_canonical_email), ''));
  v_display_name text;
  v_location_ids text[];
  v_shopify_user_ids text[];
  v_known_emails text[];
BEGIN
  IF nullif(trim(p_shop_domain), '') IS NULL OR p_person_id IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'invalid_access_identity';
  END IF;

  IF v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_access_identity';
  END IF;

  IF p_role NOT IN ('viewer', 'manager', 'admin') THEN
    RAISE EXCEPTION 'invalid_access_role';
  END IF;

  SELECT people.display_name
  INTO v_display_name
  FROM public.staff_people people
  WHERE people.id = p_person_id
    AND people.shop_domain = p_shop_domain
  FOR UPDATE;

  IF v_display_name IS NULL THEN
    RAISE EXCEPTION 'staff_member_not_found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_identity_aliases aliases
    WHERE aliases.shop_domain = p_shop_domain
      AND aliases.alias_type = 'email'
      AND lower(aliases.alias_value) = v_email
      AND aliases.person_id IS DISTINCT FROM p_person_id
  ) THEN
    RAISE EXCEPTION 'login_email_in_use';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_shopify_user_ids, ARRAY[]::text[])) requested(value)
    WHERE nullif(trim(requested.value), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.staff_identity_aliases aliases
        WHERE aliases.shop_domain = p_shop_domain
          AND aliases.person_id = p_person_id
          AND aliases.alias_type = 'shopify_admin_user_id'
          AND aliases.alias_value = trim(requested.value)
      )
  ) THEN
    RAISE EXCEPTION 'invalid_login_identity';
  END IF;

  SELECT coalesce(array_agg(DISTINCT aliases.alias_value), ARRAY[]::text[])
  INTO v_shopify_user_ids
  FROM public.staff_identity_aliases aliases
  WHERE aliases.shop_domain = p_shop_domain
    AND aliases.person_id = p_person_id
    AND aliases.alias_type = 'shopify_admin_user_id'
    AND nullif(trim(aliases.alias_value), '') IS NOT NULL;

  IF p_role = 'admin' THEN
    v_location_ids := ARRAY['*']::text[];
  ELSE
    SELECT coalesce(array_agg(DISTINCT locations.shopify_location_id), ARRAY[]::text[])
    INTO v_location_ids
    FROM public.locations locations
    WHERE locations.shop_domain = p_shop_domain
      AND locations.is_active = true
      AND locations.shopify_location_id = ANY(coalesce(p_location_ids, ARRAY[]::text[]));

    IF cardinality(v_location_ids) = 0
      OR cardinality(v_location_ids) <> cardinality(ARRAY(SELECT DISTINCT unnest(coalesce(p_location_ids, ARRAY[]::text[])))) THEN
      RAISE EXCEPTION 'invalid_access_locations';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_location_access access
    WHERE access.shop_domain = p_shop_domain
      AND access.person_id IS NOT NULL
      AND access.person_id <> p_person_id
      AND (
        (access.user_email IS NOT NULL AND lower(access.user_email) = v_email)
        OR (access.shopify_user_id IS NOT NULL AND access.shopify_user_id = ANY(v_shopify_user_ids))
      )
  ) THEN
    RAISE EXCEPTION 'dashboard_identity_in_use';
  END IF;

  INSERT INTO public.staff_identity_aliases (
    shop_domain, person_id, alias_type, alias_value, source,
    review_status, first_seen_at, last_seen_at, updated_at
  ) VALUES (
    p_shop_domain, p_person_id, 'email', v_email, 'staff_manager',
    'mapped', now(), now(), now()
  )
  ON CONFLICT (shop_domain, alias_type, alias_value)
  DO UPDATE SET
    person_id = EXCLUDED.person_id,
    review_status = 'mapped',
    last_seen_at = now(),
    updated_at = now();

  UPDATE public.staff_people
  SET email = v_email, updated_at = now()
  WHERE id = p_person_id AND shop_domain = p_shop_domain;

  SELECT coalesce(array_agg(DISTINCT lower(aliases.alias_value)), ARRAY[v_email]::text[])
  INTO v_known_emails
  FROM public.staff_identity_aliases aliases
  WHERE aliases.shop_domain = p_shop_domain
    AND aliases.person_id = p_person_id
    AND aliases.alias_type = 'email';

  DELETE FROM public.user_location_access access
  WHERE access.shop_domain = p_shop_domain
    AND (
      access.person_id = p_person_id
      OR (access.user_email IS NOT NULL AND lower(access.user_email) = ANY(v_known_emails))
      OR (access.shopify_user_id IS NOT NULL AND access.shopify_user_id = ANY(v_shopify_user_ids))
    );

  INSERT INTO public.user_location_access (
    shop_domain, person_id, access_label, user_email, shopify_user_id,
    shopify_location_id, location_name, role, can_view, can_manage
  )
  SELECT DISTINCT
    p_shop_domain,
    p_person_id,
    v_display_name,
    v_email,
    identities.shopify_user_id,
    location_id,
    CASE WHEN location_id = '*' THEN 'All locations' ELSE locations.name END,
    p_role,
    true,
    p_role IN ('manager', 'admin')
  FROM unnest(v_location_ids) location_id
  LEFT JOIN public.locations locations
    ON locations.shop_domain = p_shop_domain
   AND locations.shopify_location_id = location_id
  CROSS JOIN LATERAL unnest(
    CASE WHEN cardinality(v_shopify_user_ids) = 0
      THEN ARRAY[NULL]::text[] ELSE v_shopify_user_ids END
  ) identities(shopify_user_id);
END;
$_$;


CREATE OR REPLACE FUNCTION "public"."restore_archived_staff"("p_shop_domain" "text", "p_person_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.staff_people
  SET is_active = true, updated_at = now()
  WHERE shop_domain = p_shop_domain AND id = p_person_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_member_not_found';
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."select_active_dashboard_memberships"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_membership_ids" "uuid"[], "p_dashboard_user_limit" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_ids uuid[];
  v_owner_id uuid;
  v_active_admin_count integer;
  v_selected_admin_count integer;
BEGIN
  IF v_shop IS NULL OR p_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'invalid_membership_selection';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shopops-memberships:' || v_shop, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  SELECT coalesce(array_agg(DISTINCT value), ARRAY[]::uuid[])
  INTO v_ids
  FROM unnest(coalesce(p_membership_ids, ARRAY[]::uuid[])) value;

  SELECT id INTO v_owner_id
  FROM public.dashboard_memberships
  WHERE shop_domain = v_shop AND is_owner = true
  FOR UPDATE;
  IF v_owner_id IS NULL OR NOT (v_owner_id = ANY(v_ids)) THEN
    RAISE EXCEPTION 'owner_membership_locked';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) selected(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.dashboard_memberships membership
      WHERE membership.id = selected.id
        AND membership.shop_domain = v_shop
        AND membership.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'invalid_membership_selection';
  END IF;

  IF p_dashboard_user_limit IS NOT NULL AND cardinality(v_ids) > p_dashboard_user_limit THEN
    RAISE EXCEPTION 'dashboard_plan_capacity';
  END IF;

  SELECT count(*)::integer INTO v_active_admin_count
  FROM public.dashboard_memberships
  WHERE shop_domain = v_shop AND status = 'active' AND role IN ('owner', 'admin');
  SELECT count(*)::integer INTO v_selected_admin_count
  FROM public.dashboard_memberships
  WHERE shop_domain = v_shop AND role IN ('owner', 'admin') AND id = ANY(v_ids);
  IF v_active_admin_count > 0 AND v_selected_admin_count = 0 THEN
    RAISE EXCEPTION 'last_admin_required';
  END IF;

  UPDATE public.dashboard_memberships
  SET status = 'disabled', updated_at = now()
  WHERE shop_domain = v_shop
    AND status = 'active'
    AND is_owner = false
    AND NOT (id = ANY(v_ids));

  DELETE FROM public.user_location_access access
  USING public.dashboard_memberships membership
  WHERE membership.id = access.membership_id
    AND membership.shop_domain = v_shop
    AND membership.status = 'disabled';
END;
$$;


CREATE OR REPLACE FUNCTION "public"."select_reporting_locations"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_location_ids" "text"[], "p_location_limit" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_ids text[];
  v_detected_count integer;
BEGIN
  IF v_shop IS NULL OR p_actor_membership_id IS NULL THEN
    RAISE EXCEPTION 'invalid_location_selection';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('shopops-locations:' || v_shop, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  SELECT coalesce(array_agg(DISTINCT btrim(value)) FILTER (WHERE nullif(btrim(value), '') IS NOT NULL), ARRAY[]::text[])
  INTO v_ids
  FROM unnest(coalesce(p_location_ids, ARRAY[]::text[])) value;

  IF p_location_limit IS NOT NULL AND cardinality(v_ids) > p_location_limit THEN
    RAISE EXCEPTION 'location_plan_capacity';
  END IF;

  SELECT count(*)::integer INTO v_detected_count
  FROM public.locations
  WHERE shop_domain = v_shop AND shopify_is_active = true;
  IF v_detected_count > 0 AND cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'reporting_location_required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) selected(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.locations location
      WHERE location.shop_domain = v_shop
        AND location.shopify_location_id = selected.id
        AND location.shopify_is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'invalid_location_selection';
  END IF;

  UPDATE public.locations
  SET
    reporting_enabled = shopify_is_active AND shopify_location_id = ANY(v_ids),
    updated_at = now()
  WHERE shop_domain = v_shop;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."update_shop_cogs_estimate_settings"("p_shop_domain" "text", "p_enabled" boolean, "p_percent" numeric, "p_estimate_custom_sales" boolean) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF p_enabled AND (p_percent IS NULL OR p_percent < 0 OR p_percent > 100) THEN
        RAISE EXCEPTION 'Estimated cost rate must be between 0 and 100';
    END IF;

    UPDATE public.shops
    SET
        cogs_estimate_enabled = p_enabled,
        cogs_estimate_percent = CASE WHEN p_enabled THEN p_percent ELSE NULL END,
        cogs_estimate_custom_sales =
            CASE WHEN p_enabled THEN p_estimate_custom_sales ELSE false END,
        cogs_estimate_updated_at = now(),
        updated_at = now()
    WHERE shop_domain = p_shop_domain;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shop not found';
    END IF;

    RETURN public.recompute_order_line_cogs_for_shop(p_shop_domain);
END;
$$;


CREATE OR REPLACE FUNCTION "public"."update_variant_costs_from_inventory_items"("p_shop_domain" "text", "p_inventory_item_ids" "text"[]) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


CREATE OR REPLACE FUNCTION "public"."update_variant_costs_from_inventory_items_for_shop"("p_shop_domain" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
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


CREATE TABLE IF NOT EXISTS "public"."compliance_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "topic" "text" NOT NULL,
    "status" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."dashboard_memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "person_id" "uuid",
    "shopify_user_id" "text",
    "normalized_email" "text",
    "display_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_owner" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dashboard_memberships_identity_check" CHECK ((("person_id" IS NOT NULL) OR (NULLIF("btrim"("shopify_user_id"), ''::"text") IS NOT NULL) OR (NULLIF("btrim"("normalized_email"), ''::"text") IS NOT NULL))),
    CONSTRAINT "dashboard_memberships_owner_shape_check" CHECK (((("is_owner" = true) AND ("role" = 'owner'::"text") AND ("status" = 'active'::"text")) OR (("is_owner" = false) AND ("role" <> 'owner'::"text")))),
    CONSTRAINT "dashboard_memberships_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'viewer'::"text"]))),
    CONSTRAINT "dashboard_memberships_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'disabled'::"text"])))
);


CREATE TABLE IF NOT EXISTS "public"."fixed_expenses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_location_id" "text",
    "location_name" "text",
    "expense_name" "text" NOT NULL,
    "expense_category" "text",
    "monthly_amount" numeric DEFAULT 0 NOT NULL,
    "start_month" "date" NOT NULL,
    "end_month" "date",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."inventory_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "inventory_item_id" "text" NOT NULL,
    "sku" "text",
    "tracked" boolean,
    "unit_cost" numeric,
    "cost_source" "text",
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."inventory_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_location_id" "text" NOT NULL,
    "shopify_variant_id" "text",
    "inventory_item_id" "text" NOT NULL,
    "sku" "text",
    "available" integer DEFAULT 0,
    "tracked" boolean DEFAULT true,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_location_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "city" "text",
    "province" "text",
    "country" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "shopify_is_active" boolean DEFAULT true NOT NULL,
    "reporting_enabled" boolean DEFAULT false NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."maintenance_tick_state" (
    "singleton" boolean DEFAULT true NOT NULL,
    "last_started_at" timestamp with time zone,
    "last_completed_at" timestamp with time zone,
    "last_succeeded_at" timestamp with time zone,
    "last_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "maintenance_tick_state_singleton_check" CHECK (("singleton" = true))
);


CREATE TABLE IF NOT EXISTS "public"."order_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_order_id" "text" NOT NULL,
    "shopify_line_item_id" "text" NOT NULL,
    "order_name" "text" NOT NULL,
    "created_at_shopify" timestamp with time zone NOT NULL,
    "retail_location_id" "text",
    "retail_location_name" "text",
    "shopify_variant_id" "text",
    "inventory_item_id" "text",
    "product_title" "text",
    "variant_title" "text",
    "sku" "text",
    "vendor" "text",
    "quantity" integer DEFAULT 0 NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "revenue" numeric DEFAULT 0 NOT NULL,
    "unit_cost" numeric,
    "cogs" numeric,
    "gross_profit" numeric,
    "cost_source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "staff_member_id" "text",
    "staff_member_name" "text",
    "staff_member_email" "text",
    "staff_source" "text",
    "gross_sales" numeric(18,4),
    "discounts" numeric(18,4),
    "returns" numeric(18,4),
    "net_sales" numeric(18,4),
    "refunded_amount" numeric(18,4),
    "taxes" numeric(18,4),
    "returned_quantity" integer,
    "cost_at_sale" numeric(18,4),
    "cost_at_sale_source" "text",
    "cost_at_sale_captured_at" timestamp with time zone,
    "discount_amount" numeric(18,4),
    "discount_allocations" "jsonb",
    "shopops_staff_member_id" "text",
    "shopops_user_id" "text",
    "shopops_pos_location_id" "text",
    "shopops_pos_device_id" "text",
    "shopops_pos_device_name" "text",
    "shopops_attribution_source" "text",
    "shopops_staff_label" "text",
    "shopops_attributed_user_id" "text",
    "shopops_attributed_staff_member_id" "text",
    "shopops_effective_staff_id" "text",
    "cogs_estimate_percent" numeric
);


CREATE TABLE IF NOT EXISTS "public"."order_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_order_id" "text" NOT NULL,
    "shopify_transaction_id" "text" NOT NULL,
    "kind" "text",
    "status" "text",
    "gateway" "text",
    "processed_at" timestamp with time zone,
    "amount" numeric(18,4),
    "currency_code" "text",
    "parent_transaction_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_order_id" "text" NOT NULL,
    "order_name" "text" NOT NULL,
    "created_at_shopify" timestamp with time zone NOT NULL,
    "financial_status" "text",
    "retail_location_id" "text",
    "retail_location_name" "text",
    "total_price" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "staff_member_id" "text",
    "staff_member_name" "text",
    "staff_member_email" "text",
    "staff_source" "text",
    "shopify_updated_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancel_reason" "text",
    "currency_code" "text",
    "gross_sales" numeric(18,4),
    "discounts" numeric(18,4),
    "returns" numeric(18,4),
    "net_sales" numeric(18,4),
    "refunds" numeric(18,4),
    "taxes" numeric(18,4),
    "shipping" numeric(18,4),
    "total_sales" numeric(18,4),
    "transactions_total" numeric(18,4),
    "financial_data_complete" boolean DEFAULT true NOT NULL,
    "financial_incomplete_reason" "text",
    "financial_payload" "jsonb",
    "total_discount_amount" numeric(18,4),
    "current_total_discount_amount" numeric(18,4),
    "line_discount_amount" numeric(18,4),
    "shipping_discount_amount" numeric(18,4),
    "discount_applications" "jsonb",
    "discount_codes" "jsonb"
);


CREATE TABLE IF NOT EXISTS "public"."pos_attribution_setup" (
    "shop_domain" "text" NOT NULL,
    "tile_confirmed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_product_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "vendor" "text",
    "product_type" "text",
    "status" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shop_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "marketplace_initialized_at" timestamp with time zone,
    "cogs_estimate_enabled" boolean DEFAULT false NOT NULL,
    "cogs_estimate_percent" numeric,
    "cogs_estimate_custom_sales" boolean DEFAULT false NOT NULL,
    "cogs_estimate_updated_at" timestamp with time zone,
    CONSTRAINT "shops_cogs_estimate_percent_check" CHECK (((("cogs_estimate_enabled" = false) AND (("cogs_estimate_percent" IS NULL) OR (("cogs_estimate_percent" >= (0)::numeric) AND ("cogs_estimate_percent" <= (100)::numeric)))) OR (("cogs_estimate_enabled" = true) AND (("cogs_estimate_percent" >= (0)::numeric) AND ("cogs_estimate_percent" <= (100)::numeric)))))
);


CREATE TABLE IF NOT EXISTS "public"."staff_identity_aliases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "person_id" "uuid",
    "alias_type" "text" NOT NULL,
    "alias_value" "text" NOT NULL,
    "source" "text",
    "first_seen_at" timestamp with time zone,
    "last_seen_at" timestamp with time zone,
    "last_location_id" "text",
    "last_device_id" "text",
    "last_device_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "suggestion_dismissed_at" timestamp with time zone,
    CONSTRAINT "staff_identity_aliases_review_status_check" CHECK (("review_status" = ANY (ARRAY['pending'::"text", 'deferred'::"text", 'mapped'::"text"]))),
    CONSTRAINT "staff_identity_aliases_type_check" CHECK (("alias_type" = ANY (ARRAY['email'::"text", 'shopify_admin_user_id'::"text", 'pos_staff_member_id'::"text", 'pos_user_id'::"text", 'pos_attributed_user_id'::"text", 'pos_effective_staff_id'::"text"])))
);


CREATE TABLE IF NOT EXISTS "public"."staff_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_staff_id" "text" NOT NULL,
    "email" "text",
    "name" "text",
    "first_name" "text",
    "last_name" "text",
    "is_active" boolean,
    "is_owner" boolean,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


CREATE TABLE IF NOT EXISTS "public"."staff_people" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "email" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE OR REPLACE VIEW "public"."staff_pos_seller_metrics" AS
 WITH "reporting_lines" AS (
         SELECT "lines"."id",
            "lines"."shop_domain",
            "lines"."shopify_order_id",
            "lines"."shopify_line_item_id",
            "lines"."order_name",
            "lines"."created_at_shopify",
            "lines"."retail_location_id",
            "lines"."retail_location_name",
            "lines"."shopify_variant_id",
            "lines"."inventory_item_id",
            "lines"."product_title",
            "lines"."variant_title",
            "lines"."sku",
            "lines"."vendor",
            "lines"."quantity",
            "lines"."unit_price",
            "lines"."revenue",
            "lines"."unit_cost",
            "lines"."cogs",
            "lines"."gross_profit",
            "lines"."cost_source",
            "lines"."created_at",
            "lines"."staff_member_id",
            "lines"."staff_member_name",
            "lines"."staff_member_email",
            "lines"."staff_source",
            "lines"."gross_sales",
            "lines"."discounts",
            "lines"."returns",
            "lines"."net_sales",
            "lines"."refunded_amount",
            "lines"."taxes",
            "lines"."returned_quantity",
            "lines"."cost_at_sale",
            "lines"."cost_at_sale_source",
            "lines"."cost_at_sale_captured_at",
            "lines"."discount_amount",
            "lines"."discount_allocations",
            "lines"."shopops_staff_member_id",
            "lines"."shopops_user_id",
            "lines"."shopops_pos_location_id",
            "lines"."shopops_pos_device_id",
            "lines"."shopops_pos_device_name",
            "lines"."shopops_attribution_source",
            "lines"."shopops_staff_label",
            "lines"."shopops_attributed_user_id",
            "lines"."shopops_attributed_staff_member_id",
            "lines"."shopops_effective_staff_id",
            "lines"."cogs_estimate_percent"
           FROM ("public"."order_lines" "lines"
             JOIN "public"."locations" "location" ON ((("location"."shop_domain" = "lines"."shop_domain") AND ("location"."shopify_location_id" = "lines"."retail_location_id") AND ("location"."shopify_is_active" = true) AND ("location"."reporting_enabled" = true))))
        ), "totals" AS (
         SELECT "lines"."shop_domain",
            "lines"."shopops_attribution_source" AS "attribution_source",
            "lines"."shopops_effective_staff_id" AS "effective_staff_id",
            "count"(DISTINCT COALESCE("lines"."shopify_order_id", "lines"."order_name")) AS "order_count",
            COALESCE("sum"("lines"."net_sales"), (0)::numeric) AS "net_sales"
           FROM "reporting_lines" "lines"
          WHERE (("lines"."shopops_effective_staff_id" IS NOT NULL) AND (NULLIF("btrim"("lines"."shopops_effective_staff_id"), ''::"text") IS NOT NULL))
          GROUP BY "lines"."shop_domain", "lines"."shopops_attribution_source", "lines"."shopops_effective_staff_id"
        ), "latest" AS (
         SELECT DISTINCT ON ("lines"."shop_domain", "lines"."shopops_attribution_source", "lines"."shopops_effective_staff_id") "lines"."shop_domain",
            "lines"."shopops_attribution_source" AS "attribution_source",
            "lines"."shopops_effective_staff_id" AS "effective_staff_id",
            "lines"."order_name" AS "last_order_name",
            "lines"."created_at_shopify" AS "last_activity_at",
            "lines"."retail_location_name" AS "last_location",
            "lines"."shopops_pos_device_name" AS "last_device",
            "lines"."shopify_order_id" AS "last_shopify_order_id"
           FROM "reporting_lines" "lines"
          WHERE (("lines"."shopops_effective_staff_id" IS NOT NULL) AND (NULLIF("btrim"("lines"."shopops_effective_staff_id"), ''::"text") IS NOT NULL))
          ORDER BY "lines"."shop_domain", "lines"."shopops_attribution_source", "lines"."shopops_effective_staff_id", "lines"."created_at_shopify" DESC NULLS LAST
        )
 SELECT "totals"."shop_domain",
    "totals"."attribution_source",
    "totals"."effective_staff_id",
    "latest"."last_order_name",
    "latest"."last_activity_at",
    "latest"."last_location",
    "latest"."last_device",
    "totals"."order_count",
    "totals"."net_sales",
    "latest"."last_shopify_order_id"
   FROM ("totals"
     JOIN "latest" ON ((("latest"."shop_domain" = "totals"."shop_domain") AND (NOT ("latest"."attribution_source" IS DISTINCT FROM "totals"."attribution_source")) AND ("latest"."effective_staff_id" = "totals"."effective_staff_id"))));


CREATE TABLE IF NOT EXISTS "public"."sync_automation_state" (
    "shop_domain" "text" NOT NULL,
    "last_reconciliation_started_at" timestamp with time zone,
    "last_reconciliation_succeeded_at" timestamp with time zone,
    "next_reconciliation_due_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


CREATE TABLE IF NOT EXISTS "public"."sync_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "job_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "current_step" "text",
    "progress" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "details" "jsonb",
    "started_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sync_jobs_job_type_check" CHECK (("job_type" = ANY (ARRAY['locations'::"text", 'products'::"text", 'inventory'::"text", 'orders'::"text", 'orders_reconciliation_48h'::"text", 'financial_backfill_30d'::"text", 'full'::"text", 'full_refresh'::"text"]))),
    CONSTRAINT "sync_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'success'::"text", 'error'::"text", 'cancelled'::"text"])))
);


CREATE TABLE IF NOT EXISTS "public"."sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "sync_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "error_message" "text",
    "source" "text",
    "details" "jsonb"
);


CREATE TABLE IF NOT EXISTS "public"."user_location_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "user_email" "text",
    "shopify_user_id" "text",
    "shopify_location_id" "text",
    "location_name" "text",
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "can_view" boolean DEFAULT true NOT NULL,
    "can_manage" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "access_label" "text",
    "person_id" "uuid",
    "membership_id" "uuid"
);


CREATE TABLE IF NOT EXISTS "public"."variants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shop_domain" "text" NOT NULL,
    "shopify_variant_id" "text" NOT NULL,
    "shopify_product_id" "text",
    "inventory_item_id" "text",
    "title" "text",
    "sku" "text",
    "price" numeric,
    "unit_cost" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE ONLY "public"."compliance_webhook_events"
    ADD CONSTRAINT "compliance_webhook_events_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."dashboard_memberships"
    ADD CONSTRAINT "dashboard_memberships_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."fixed_expenses"
    ADD CONSTRAINT "fixed_expenses_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."inventory_items"
    ADD CONSTRAINT "inventory_items_shop_domain_inventory_item_id_key" UNIQUE ("shop_domain", "inventory_item_id");


ALTER TABLE ONLY "public"."inventory_levels"
    ADD CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."inventory_levels"
    ADD CONSTRAINT "inventory_levels_shop_domain_shopify_location_id_inventory__key" UNIQUE ("shop_domain", "shopify_location_id", "inventory_item_id");


ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_shop_domain_shopify_location_id_key" UNIQUE ("shop_domain", "shopify_location_id");


ALTER TABLE ONLY "public"."maintenance_tick_state"
    ADD CONSTRAINT "maintenance_tick_state_pkey" PRIMARY KEY ("singleton");


ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."order_lines"
    ADD CONSTRAINT "order_lines_shop_domain_shopify_line_item_id_key" UNIQUE ("shop_domain", "shopify_line_item_id");


ALTER TABLE ONLY "public"."order_transactions"
    ADD CONSTRAINT "order_transactions_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."order_transactions"
    ADD CONSTRAINT "order_transactions_shop_transaction_key" UNIQUE ("shop_domain", "shopify_transaction_id");


ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_shop_domain_shopify_order_id_key" UNIQUE ("shop_domain", "shopify_order_id");


ALTER TABLE ONLY "public"."pos_attribution_setup"
    ADD CONSTRAINT "pos_attribution_setup_pkey" PRIMARY KEY ("shop_domain");


ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_shop_domain_shopify_product_id_key" UNIQUE ("shop_domain", "shopify_product_id");


ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_shop_domain_key" UNIQUE ("shop_domain");


ALTER TABLE ONLY "public"."staff_identity_aliases"
    ADD CONSTRAINT "staff_identity_aliases_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."staff_members"
    ADD CONSTRAINT "staff_members_shop_domain_shopify_staff_id_key" UNIQUE ("shop_domain", "shopify_staff_id");


ALTER TABLE ONLY "public"."staff_people"
    ADD CONSTRAINT "staff_people_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."sync_automation_state"
    ADD CONSTRAINT "sync_automation_state_pkey" PRIMARY KEY ("shop_domain");


ALTER TABLE ONLY "public"."sync_jobs"
    ADD CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."sync_runs"
    ADD CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."user_location_access"
    ADD CONSTRAINT "user_location_access_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."variants"
    ADD CONSTRAINT "variants_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."variants"
    ADD CONSTRAINT "variants_shop_domain_shopify_variant_id_key" UNIQUE ("shop_domain", "shopify_variant_id");


ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id");


CREATE INDEX "compliance_webhook_events_shop_received_idx" ON "public"."compliance_webhook_events" USING "btree" ("shop_domain", "received_at" DESC);


CREATE INDEX "compliance_webhook_events_topic_status_idx" ON "public"."compliance_webhook_events" USING "btree" ("topic", "status", "received_at" DESC);


CREATE UNIQUE INDEX "dashboard_memberships_one_owner_per_shop_uidx" ON "public"."dashboard_memberships" USING "btree" ("shop_domain") WHERE ("is_owner" = true);


CREATE UNIQUE INDEX "dashboard_memberships_shop_email_uidx" ON "public"."dashboard_memberships" USING "btree" ("shop_domain", "lower"("btrim"("normalized_email"))) WHERE ("normalized_email" IS NOT NULL);


CREATE UNIQUE INDEX "dashboard_memberships_shop_person_uidx" ON "public"."dashboard_memberships" USING "btree" ("shop_domain", "person_id") WHERE ("person_id" IS NOT NULL);


CREATE INDEX "dashboard_memberships_shop_status_role_idx" ON "public"."dashboard_memberships" USING "btree" ("shop_domain", "status", "role");


CREATE UNIQUE INDEX "dashboard_memberships_shop_user_id_uidx" ON "public"."dashboard_memberships" USING "btree" ("shop_domain", "btrim"("shopify_user_id")) WHERE ("shopify_user_id" IS NOT NULL);


CREATE UNIQUE INDEX "inventory_items_shop_inventory_item_uidx" ON "public"."inventory_items" USING "btree" ("shop_domain", "inventory_item_id");


CREATE UNIQUE INDEX "inventory_levels_shop_location_item_uidx" ON "public"."inventory_levels" USING "btree" ("shop_domain", "shopify_location_id", "inventory_item_id");


CREATE UNIQUE INDEX "locations_shop_location_uidx" ON "public"."locations" USING "btree" ("shop_domain", "shopify_location_id");


CREATE INDEX "locations_shop_reporting_enabled_idx" ON "public"."locations" USING "btree" ("shop_domain", "reporting_enabled", "name");


CREATE INDEX "locations_shop_shopify_active_idx" ON "public"."locations" USING "btree" ("shop_domain", "shopify_is_active", "name");


CREATE INDEX "order_lines_shop_attribution_effective_staff_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopops_attribution_source", "shopops_effective_staff_id", "created_at_shopify" DESC) WHERE ("shopops_effective_staff_id" IS NOT NULL);


CREATE UNIQUE INDEX "order_lines_shop_line_item_uidx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopify_line_item_id");


CREATE INDEX "order_lines_shop_pos_attributed_staff_member_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopops_attributed_staff_member_id");


CREATE INDEX "order_lines_shop_pos_attributed_user_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopops_attributed_user_id");


CREATE INDEX "order_lines_shop_pos_attribution_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopops_attribution_source");


CREATE INDEX "order_lines_shop_pos_effective_staff_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopops_effective_staff_id");


CREATE INDEX "order_lines_shop_pos_staff_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopops_staff_member_id");


CREATE INDEX "order_lines_shop_pos_staff_label_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopops_staff_label");


CREATE INDEX "order_lines_shop_variant_idx" ON "public"."order_lines" USING "btree" ("shop_domain", "shopify_variant_id");


CREATE INDEX "order_transactions_shop_order_idx" ON "public"."order_transactions" USING "btree" ("shop_domain", "shopify_order_id");


CREATE INDEX "order_transactions_shop_processed_idx" ON "public"."order_transactions" USING "btree" ("shop_domain", "processed_at");


CREATE UNIQUE INDEX "orders_shop_order_uidx" ON "public"."orders" USING "btree" ("shop_domain", "shopify_order_id");


CREATE UNIQUE INDEX "products_shop_product_uidx" ON "public"."products" USING "btree" ("shop_domain", "shopify_product_id");


CREATE INDEX "staff_identity_aliases_shop_person_idx" ON "public"."staff_identity_aliases" USING "btree" ("shop_domain", "person_id");


CREATE UNIQUE INDEX "staff_identity_aliases_shop_type_value_uidx" ON "public"."staff_identity_aliases" USING "btree" ("shop_domain", "alias_type", "alias_value");


CREATE INDEX "staff_members_shop_domain_active_idx" ON "public"."staff_members" USING "btree" ("shop_domain", "is_active");


CREATE INDEX "staff_members_shop_domain_idx" ON "public"."staff_members" USING "btree" ("shop_domain");


CREATE INDEX "staff_people_shop_domain_idx" ON "public"."staff_people" USING "btree" ("shop_domain");


CREATE UNIQUE INDEX "staff_people_shop_email_uidx" ON "public"."staff_people" USING "btree" ("shop_domain", "lower"("email")) WHERE ("email" IS NOT NULL);


CREATE UNIQUE INDEX "sync_jobs_one_active_full_operation_per_shop_idx" ON "public"."sync_jobs" USING "btree" ("shop_domain") WHERE (("status" = ANY (ARRAY['pending'::"text", 'running'::"text"])) AND ("job_type" = ANY (ARRAY['full'::"text", 'full_refresh'::"text"])));


CREATE UNIQUE INDEX "sync_jobs_one_active_per_shop_type_idx" ON "public"."sync_jobs" USING "btree" ("shop_domain", "job_type") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));


CREATE INDEX "sync_jobs_shop_status_idx" ON "public"."sync_jobs" USING "btree" ("shop_domain", "status", "updated_at" DESC);


CREATE INDEX "sync_jobs_shop_type_status_idx" ON "public"."sync_jobs" USING "btree" ("shop_domain", "job_type", "status", "updated_at" DESC);


CREATE INDEX "sync_jobs_terminal_finished_idx" ON "public"."sync_jobs" USING "btree" ("status", "finished_at") WHERE ("status" = ANY (ARRAY['success'::"text", 'error'::"text", 'cancelled'::"text"]));


CREATE INDEX "sync_runs_status_finished_idx" ON "public"."sync_runs" USING "btree" ("status", "finished_at");


CREATE UNIQUE INDEX "user_location_access_shop_email_user_location_uidx" ON "public"."user_location_access" USING "btree" ("shop_domain", "lower"("btrim"("user_email")), COALESCE("btrim"("shopify_user_id"), ''::"text"), COALESCE("btrim"("shopify_location_id"), ''::"text")) WHERE ("user_email" IS NOT NULL);


CREATE INDEX "user_location_access_shop_membership_idx" ON "public"."user_location_access" USING "btree" ("shop_domain", "membership_id");


CREATE INDEX "user_location_access_shop_person_idx" ON "public"."user_location_access" USING "btree" ("shop_domain", "person_id");


CREATE UNIQUE INDEX "user_location_access_shop_user_id_location_uidx" ON "public"."user_location_access" USING "btree" ("shop_domain", "shopify_user_id", "shopify_location_id") WHERE ("shopify_user_id" IS NOT NULL);


CREATE UNIQUE INDEX "user_location_access_shop_user_location_strict_uidx" ON "public"."user_location_access" USING "btree" ("shop_domain", "btrim"("shopify_user_id"), COALESCE("btrim"("shopify_location_id"), ''::"text")) WHERE ("shopify_user_id" IS NOT NULL);


CREATE INDEX "variants_shop_inventory_item_idx" ON "public"."variants" USING "btree" ("shop_domain", "inventory_item_id");


CREATE UNIQUE INDEX "variants_shop_variant_uidx" ON "public"."variants" USING "btree" ("shop_domain", "shopify_variant_id");


CREATE INDEX "webhook_events_shop_topic_received_idx" ON "public"."webhook_events" USING "btree" ("shop_domain", "topic", "received_at" DESC);


CREATE UNIQUE INDEX "webhook_events_shop_webhook_id_uidx" ON "public"."webhook_events" USING "btree" ("shop_domain", "shopify_webhook_id") WHERE ("shopify_webhook_id" IS NOT NULL);


CREATE INDEX "webhook_events_status_available_received_idx" ON "public"."webhook_events" USING "btree" ("status", "available_at", "received_at");


ALTER TABLE ONLY "public"."dashboard_memberships"
    ADD CONSTRAINT "dashboard_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."staff_people"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."staff_identity_aliases"
    ADD CONSTRAINT "staff_identity_aliases_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."staff_people"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."user_location_access"
    ADD CONSTRAINT "user_location_access_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "public"."dashboard_memberships"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."user_location_access"
    ADD CONSTRAINT "user_location_access_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "public"."staff_people"("id") ON DELETE SET NULL;


ALTER TABLE "public"."dashboard_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_tick_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pos_attribution_setup" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sync_automation_state" ENABLE ROW LEVEL SECURITY;


REVOKE USAGE ON SCHEMA "public" FROM PUBLIC;
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


REVOKE ALL ON FUNCTION "public"."archive_staff_with_dashboard_protection"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_person_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_staff_with_dashboard_protection"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_person_id" "uuid") TO "service_role";


GRANT ALL ON TABLE "public"."webhook_events" TO "service_role";


GRANT ALL ON FUNCTION "public"."claim_webhook_events"("p_batch_size" integer, "p_max_attempts" integer, "p_stale_after" interval) TO "service_role";


REVOKE ALL ON FUNCTION "public"."cleanup_operational_sync_history"("p_batch_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_operational_sync_history"("p_batch_size" integer) TO "service_role";


REVOKE ALL ON FUNCTION "public"."disable_dashboard_membership"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_target_membership_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."disable_dashboard_membership"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_target_membership_id" "uuid") TO "service_role";


GRANT ALL ON FUNCTION "public"."get_data_quality_report"("p_shop_domain" "text", "p_location_ids" "text"[]) TO "service_role";


REVOKE ALL ON FUNCTION "public"."get_missing_product_costs_page"("p_shop_domain" "text", "p_search" "text", "p_limit" integer, "p_offset" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_missing_product_costs_page"("p_shop_domain" "text", "p_search" "text", "p_limit" integer, "p_offset" integer) TO "service_role";


REVOKE ALL ON FUNCTION "public"."get_product_cost_coverage_summary"("p_shop_domain" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_product_cost_coverage_summary"("p_shop_domain" "text") TO "service_role";


REVOKE ALL ON FUNCTION "public"."materialize_dashboard_owner"("p_shop_domain" "text", "p_shopify_user_id" "text", "p_normalized_email" "text", "p_display_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."materialize_dashboard_owner"("p_shop_domain" "text", "p_shopify_user_id" "text", "p_normalized_email" "text", "p_display_name" "text") TO "service_role";


GRANT ALL ON FUNCTION "public"."recompute_order_line_cogs_for_inventory_items"("p_shop_domain" "text", "p_inventory_item_ids" "text"[]) TO "service_role";


REVOKE ALL ON FUNCTION "public"."recompute_order_line_cogs_for_shop"("p_shop_domain" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_order_line_cogs_for_shop"("p_shop_domain" "text") TO "service_role";


REVOKE ALL ON FUNCTION "public"."recompute_order_line_cogs_for_variants"("p_shop_domain" "text", "p_variant_ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recompute_order_line_cogs_for_variants"("p_shop_domain" "text", "p_variant_ids" "text"[]) TO "service_role";


REVOKE ALL ON FUNCTION "public"."remove_or_archive_staff"("p_shop_domain" "text", "p_person_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_or_archive_staff"("p_shop_domain" "text", "p_person_id" "uuid") TO "service_role";


REVOKE ALL ON FUNCTION "public"."remove_staff_dashboard_access"("p_shop_domain" "text", "p_person_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_staff_dashboard_access"("p_shop_domain" "text", "p_person_id" "uuid") TO "service_role";


REVOKE ALL ON FUNCTION "public"."replace_dashboard_membership_access"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_person_id" "uuid", "p_canonical_email" "text", "p_role" "text", "p_location_ids" "text"[], "p_shopify_user_ids" "text"[], "p_dashboard_user_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_dashboard_membership_access"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_person_id" "uuid", "p_canonical_email" "text", "p_role" "text", "p_location_ids" "text"[], "p_shopify_user_ids" "text"[], "p_dashboard_user_limit" integer) TO "service_role";


REVOKE ALL ON FUNCTION "public"."replace_staff_dashboard_access"("p_shop_domain" "text", "p_person_id" "uuid", "p_canonical_email" "text", "p_role" "text", "p_location_ids" "text"[], "p_shopify_user_ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_staff_dashboard_access"("p_shop_domain" "text", "p_person_id" "uuid", "p_canonical_email" "text", "p_role" "text", "p_location_ids" "text"[], "p_shopify_user_ids" "text"[]) TO "service_role";


REVOKE ALL ON FUNCTION "public"."restore_archived_staff"("p_shop_domain" "text", "p_person_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_archived_staff"("p_shop_domain" "text", "p_person_id" "uuid") TO "service_role";


REVOKE ALL ON FUNCTION "public"."select_active_dashboard_memberships"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_membership_ids" "uuid"[], "p_dashboard_user_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."select_active_dashboard_memberships"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_membership_ids" "uuid"[], "p_dashboard_user_limit" integer) TO "service_role";


REVOKE ALL ON FUNCTION "public"."select_reporting_locations"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_location_ids" "text"[], "p_location_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."select_reporting_locations"("p_shop_domain" "text", "p_actor_membership_id" "uuid", "p_location_ids" "text"[], "p_location_limit" integer) TO "service_role";


REVOKE ALL ON FUNCTION "public"."update_shop_cogs_estimate_settings"("p_shop_domain" "text", "p_enabled" boolean, "p_percent" numeric, "p_estimate_custom_sales" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_shop_cogs_estimate_settings"("p_shop_domain" "text", "p_enabled" boolean, "p_percent" numeric, "p_estimate_custom_sales" boolean) TO "service_role";


GRANT ALL ON FUNCTION "public"."update_variant_costs_from_inventory_items"("p_shop_domain" "text", "p_inventory_item_ids" "text"[]) TO "service_role";


GRANT ALL ON FUNCTION "public"."update_variant_costs_from_inventory_items_for_shop"("p_shop_domain" "text") TO "service_role";


GRANT ALL ON TABLE "public"."compliance_webhook_events" TO "service_role";


GRANT ALL ON TABLE "public"."dashboard_memberships" TO "service_role";


GRANT ALL ON TABLE "public"."fixed_expenses" TO "service_role";


GRANT ALL ON TABLE "public"."inventory_items" TO "service_role";


GRANT ALL ON TABLE "public"."inventory_levels" TO "service_role";


GRANT ALL ON TABLE "public"."locations" TO "service_role";


GRANT ALL ON TABLE "public"."maintenance_tick_state" TO "service_role";


GRANT ALL ON TABLE "public"."order_lines" TO "service_role";


GRANT ALL ON TABLE "public"."order_transactions" TO "service_role";


GRANT ALL ON TABLE "public"."orders" TO "service_role";


GRANT ALL ON TABLE "public"."pos_attribution_setup" TO "service_role";


GRANT ALL ON TABLE "public"."products" TO "service_role";


GRANT ALL ON TABLE "public"."shops" TO "service_role";


GRANT ALL ON TABLE "public"."staff_identity_aliases" TO "service_role";


GRANT ALL ON TABLE "public"."staff_members" TO "service_role";


GRANT ALL ON TABLE "public"."staff_people" TO "service_role";


GRANT ALL ON TABLE "public"."staff_pos_seller_metrics" TO "service_role";


GRANT ALL ON TABLE "public"."sync_automation_state" TO "service_role";


GRANT ALL ON TABLE "public"."sync_jobs" TO "service_role";


GRANT ALL ON TABLE "public"."sync_runs" TO "service_role";


GRANT ALL ON TABLE "public"."user_location_access" TO "service_role";


GRANT ALL ON TABLE "public"."variants" TO "service_role";


-- Neutralize Supabase bootstrap defaults so a clean local project recreates
-- the reviewed remote privilege state instead of inheriting environment-only
-- privileges for API roles.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
