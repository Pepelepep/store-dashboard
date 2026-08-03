CREATE INDEX IF NOT EXISTS order_lines_shop_attribution_effective_staff_idx
  ON public.order_lines (
    shop_domain,
    shopops_attribution_source,
    shopops_effective_staff_id,
    created_at_shopify DESC
  )
  WHERE shopops_effective_staff_id IS NOT NULL;

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
    lines.shopops_pos_device_name AS last_device
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
  totals.net_sales
FROM totals
JOIN latest
  ON latest.shop_domain = totals.shop_domain
 AND latest.attribution_source IS NOT DISTINCT FROM totals.attribution_source
 AND latest.effective_staff_id = totals.effective_staff_id;

CREATE OR REPLACE FUNCTION public.replace_staff_dashboard_access(
  p_shop_domain text,
  p_person_id uuid,
  p_canonical_email text,
  p_role text,
  p_location_ids text[],
  p_shopify_user_ids text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.remove_staff_dashboard_access(
  p_shop_domain text,
  p_person_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.replace_staff_dashboard_access(text, uuid, text, text, text[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_staff_dashboard_access(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_staff_dashboard_access(text, uuid, text, text, text[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_staff_dashboard_access(text, uuid) TO service_role;
GRANT SELECT ON public.staff_pos_seller_metrics TO service_role;
