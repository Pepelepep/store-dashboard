-- A POS session id (whoever is logged into the register) is not a stable
-- per-person identity the way a real staff PIN or admin user id is — the
-- same register can ring up sales made by different real staff. It must
-- never be resolvable to a person through the same alias types used for a
-- genuine explicit "Sold by" attribution.
--
-- This re-creates the two reporting functions with the
-- attribution_source -> alias_type CASE no longer routing
-- 'pos_session_staff_member'/'pos_session_user'/'pos_session' into the
-- trusted 'pos_staff_member_id'/'pos_user_id' buckets — they fall through
-- to the existing 'pos_effective_staff_id' catch-all instead, which no
-- session-sourced alias row has ever been written under. This is a
-- query-time change: already-synced historical order_lines rows stop being
-- resolvable via the trusted alias types immediately, with no data rewrite.

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

-- Read-only audit, not executed by this migration: quantifies how many
-- staff_identity_aliases rows are provably session-only pollution, i.e.
-- already mapped to a person but whose alias_value only ever appears on
-- order_lines under a session attribution_source (never a genuine explicit
-- one). Run manually per shop to decide on a cleanup separately — this
-- query changes nothing by itself.
--
-- SELECT
--   alias.shop_domain,
--   alias.alias_type,
--   alias.alias_value,
--   alias.person_id,
--   person.display_name
-- FROM public.staff_identity_aliases AS alias
-- JOIN public.staff_people AS person
--   ON person.shop_domain = alias.shop_domain
--   AND person.id = alias.person_id
-- WHERE alias.alias_type IN ('pos_staff_member_id', 'pos_user_id')
--   AND alias.person_id IS NOT NULL
--   AND EXISTS (
--     SELECT 1 FROM public.order_lines AS line
--     WHERE line.shop_domain = alias.shop_domain
--       AND line.shopops_effective_staff_id = alias.alias_value
--       AND line.shopops_attribution_source IN (
--         'pos_session_staff_member', 'pos_session_user', 'pos_session'
--       )
--   )
--   AND NOT EXISTS (
--     SELECT 1 FROM public.order_lines AS line
--     WHERE line.shop_domain = alias.shop_domain
--       AND line.shopops_effective_staff_id = alias.alias_value
--       AND line.shopops_attribution_source IN (
--         'attributed_user_id', 'attributed_staff_member_id'
--       )
--   )
-- ORDER BY alias.shop_domain, alias.alias_value;
