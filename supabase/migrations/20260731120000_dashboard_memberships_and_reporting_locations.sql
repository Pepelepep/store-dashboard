-- ShopOps dashboard seats are memberships, not location-assignment rows.
-- Shopify operational location state is independent from ShopOps reporting state.

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS shopify_is_active boolean,
  ADD COLUMN IF NOT EXISTS reporting_enabled boolean;

UPDATE public.locations
SET
  shopify_is_active = coalesce(shopify_is_active, is_active, true),
  reporting_enabled = coalesce(reporting_enabled, is_active, true)
WHERE shopify_is_active IS NULL OR reporting_enabled IS NULL;

ALTER TABLE public.locations
  ALTER COLUMN shopify_is_active SET DEFAULT true,
  ALTER COLUMN shopify_is_active SET NOT NULL,
  ALTER COLUMN reporting_enabled SET DEFAULT false,
  ALTER COLUMN reporting_enabled SET NOT NULL;

CREATE INDEX IF NOT EXISTS locations_shop_reporting_enabled_idx
  ON public.locations (shop_domain, reporting_enabled, name);

CREATE INDEX IF NOT EXISTS locations_shop_shopify_active_idx
  ON public.locations (shop_domain, shopify_is_active, name);

-- Staff-page sales metrics are reporting, so their source rows must obey the
-- same selected-location boundary as the dashboards.
CREATE OR REPLACE VIEW public.staff_pos_seller_metrics AS
WITH reporting_lines AS (
  SELECT lines.*
  FROM public.order_lines lines
  JOIN public.locations location
    ON location.shop_domain = lines.shop_domain
   AND location.shopify_location_id = lines.retail_location_id
   AND location.shopify_is_active = true
   AND location.reporting_enabled = true
), totals AS (
  SELECT
    lines.shop_domain,
    lines.shopops_attribution_source AS attribution_source,
    lines.shopops_effective_staff_id AS effective_staff_id,
    count(DISTINCT coalesce(lines.shopify_order_id, lines.order_name)) AS order_count,
    coalesce(sum(lines.net_sales), 0) AS net_sales
  FROM reporting_lines lines
  WHERE lines.shopops_effective_staff_id IS NOT NULL
    AND nullif(btrim(lines.shopops_effective_staff_id), '') IS NOT NULL
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
  FROM reporting_lines lines
  WHERE lines.shopops_effective_staff_id IS NOT NULL
    AND nullif(btrim(lines.shopops_effective_staff_id), '') IS NOT NULL
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

CREATE TABLE IF NOT EXISTS public.dashboard_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain text NOT NULL,
  person_id uuid REFERENCES public.staff_people(id) ON DELETE SET NULL,
  shopify_user_id text,
  normalized_email text,
  display_name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_memberships_role_check
    CHECK (role IN ('owner', 'admin', 'manager', 'viewer')),
  CONSTRAINT dashboard_memberships_status_check
    CHECK (status IN ('active', 'disabled')),
  CONSTRAINT dashboard_memberships_owner_shape_check
    CHECK (
      (is_owner = true AND role = 'owner' AND status = 'active')
      OR (is_owner = false AND role <> 'owner')
    ),
  CONSTRAINT dashboard_memberships_identity_check
    CHECK (
      person_id IS NOT NULL
      OR nullif(btrim(shopify_user_id), '') IS NOT NULL
      OR nullif(btrim(normalized_email), '') IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_memberships_one_owner_per_shop_uidx
  ON public.dashboard_memberships (shop_domain)
  WHERE is_owner = true;

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_memberships_shop_person_uidx
  ON public.dashboard_memberships (shop_domain, person_id)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_memberships_shop_email_uidx
  ON public.dashboard_memberships (shop_domain, lower(btrim(normalized_email)))
  WHERE normalized_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_memberships_shop_user_id_uidx
  ON public.dashboard_memberships (shop_domain, btrim(shopify_user_id))
  WHERE shopify_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dashboard_memberships_shop_status_role_idx
  ON public.dashboard_memberships (shop_domain, status, role);

ALTER TABLE public.dashboard_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dashboard_memberships TO service_role;

ALTER TABLE public.user_location_access
  ADD COLUMN IF NOT EXISTS membership_id uuid
  REFERENCES public.dashboard_memberships(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS user_location_access_shop_membership_idx
  ON public.user_location_access (shop_domain, membership_id);

-- Backfill deterministic person-linked access first. Legacy rows without a
-- person are then folded by normalized email, followed by Shopify user ID.
WITH person_access AS (
  SELECT
    access.shop_domain,
    access.person_id,
    min(nullif(btrim(access.access_label), '')) AS access_label,
    min(lower(nullif(btrim(access.user_email), ''))) AS normalized_email,
    min(nullif(btrim(access.shopify_user_id), '')) AS shopify_user_id,
    CASE
      WHEN bool_or(access.role = 'admin') THEN 'admin'
      WHEN bool_or(access.role = 'manager') THEN 'manager'
      ELSE 'viewer'
    END AS role
  FROM public.user_location_access access
  WHERE access.person_id IS NOT NULL
  GROUP BY access.shop_domain, access.person_id
)
INSERT INTO public.dashboard_memberships (
  shop_domain,
  person_id,
  shopify_user_id,
  normalized_email,
  display_name,
  role,
  status,
  is_owner
)
SELECT
  grouped.shop_domain,
  grouped.person_id,
  CASE WHEN NOT EXISTS (
    SELECT 1
    FROM person_access duplicate
    WHERE duplicate.shop_domain = grouped.shop_domain
      AND duplicate.person_id <> grouped.person_id
      AND duplicate.shopify_user_id = grouped.shopify_user_id
  ) THEN grouped.shopify_user_id END,
  CASE WHEN NOT EXISTS (
    SELECT 1
    FROM person_access duplicate
    WHERE duplicate.shop_domain = grouped.shop_domain
      AND duplicate.person_id <> grouped.person_id
      AND duplicate.normalized_email = grouped.normalized_email
  ) THEN grouped.normalized_email END,
  coalesce(grouped.access_label, people.display_name, grouped.normalized_email, grouped.shopify_user_id, 'Dashboard user'),
  grouped.role,
  'active',
  false
FROM person_access grouped
LEFT JOIN public.staff_people people
  ON people.shop_domain = grouped.shop_domain
 AND people.id = grouped.person_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.dashboard_memberships existing
  WHERE existing.shop_domain = grouped.shop_domain
    AND existing.person_id = grouped.person_id
);

WITH email_access AS (
  SELECT
    access.shop_domain,
    lower(btrim(access.user_email)) AS normalized_email,
    min(nullif(btrim(access.access_label), '')) AS access_label,
    min(nullif(btrim(access.shopify_user_id), '')) AS shopify_user_id,
    CASE
      WHEN bool_or(access.role = 'admin') THEN 'admin'
      WHEN bool_or(access.role = 'manager') THEN 'manager'
      ELSE 'viewer'
    END AS role
  FROM public.user_location_access access
  WHERE access.membership_id IS NULL
    AND access.person_id IS NULL
    AND nullif(btrim(access.user_email), '') IS NOT NULL
  GROUP BY access.shop_domain, lower(btrim(access.user_email))
)
INSERT INTO public.dashboard_memberships (
  shop_domain, shopify_user_id, normalized_email, display_name,
  role, status, is_owner
)
SELECT
  grouped.shop_domain,
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships existing
    WHERE existing.shop_domain = grouped.shop_domain
      AND existing.shopify_user_id = grouped.shopify_user_id
  ) THEN grouped.shopify_user_id END,
  grouped.normalized_email,
  coalesce(grouped.access_label, grouped.normalized_email),
  grouped.role,
  'active',
  false
FROM email_access grouped
WHERE NOT EXISTS (
  SELECT 1 FROM public.dashboard_memberships existing
  WHERE existing.shop_domain = grouped.shop_domain
    AND lower(existing.normalized_email) = grouped.normalized_email
);

WITH user_id_access AS (
  SELECT
    access.shop_domain,
    btrim(access.shopify_user_id) AS shopify_user_id,
    min(nullif(btrim(access.access_label), '')) AS access_label,
    CASE
      WHEN bool_or(access.role = 'admin') THEN 'admin'
      WHEN bool_or(access.role = 'manager') THEN 'manager'
      ELSE 'viewer'
    END AS role
  FROM public.user_location_access access
  WHERE access.membership_id IS NULL
    AND access.person_id IS NULL
    AND nullif(btrim(access.user_email), '') IS NULL
    AND nullif(btrim(access.shopify_user_id), '') IS NOT NULL
  GROUP BY access.shop_domain, btrim(access.shopify_user_id)
)
INSERT INTO public.dashboard_memberships (
  shop_domain, shopify_user_id, display_name, role, status, is_owner
)
SELECT
  grouped.shop_domain,
  grouped.shopify_user_id,
  coalesce(grouped.access_label, grouped.shopify_user_id),
  grouped.role,
  'active',
  false
FROM user_id_access grouped
WHERE NOT EXISTS (
  SELECT 1 FROM public.dashboard_memberships existing
  WHERE existing.shop_domain = grouped.shop_domain
    AND existing.shopify_user_id = grouped.shopify_user_id
);

UPDATE public.user_location_access access
SET membership_id = membership.id
FROM public.dashboard_memberships membership
WHERE access.membership_id IS NULL
  AND access.person_id IS NOT NULL
  AND membership.shop_domain = access.shop_domain
  AND membership.person_id = access.person_id;

UPDATE public.user_location_access access
SET membership_id = membership.id
FROM public.dashboard_memberships membership
WHERE access.membership_id IS NULL
  AND access.user_email IS NOT NULL
  AND membership.shop_domain = access.shop_domain
  AND lower(btrim(membership.normalized_email)) = lower(btrim(access.user_email));

UPDATE public.user_location_access access
SET membership_id = membership.id
FROM public.dashboard_memberships membership
WHERE access.membership_id IS NULL
  AND access.shopify_user_id IS NOT NULL
  AND membership.shop_domain = access.shop_domain
  AND btrim(membership.shopify_user_id) = btrim(access.shopify_user_id);

CREATE OR REPLACE FUNCTION public.materialize_dashboard_owner(
  p_shop_domain text,
  p_shopify_user_id text,
  p_normalized_email text,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.replace_dashboard_membership_access(
  p_shop_domain text,
  p_actor_membership_id uuid,
  p_person_id uuid,
  p_canonical_email text,
  p_role text,
  p_location_ids text[],
  p_shopify_user_ids text[],
  p_dashboard_user_limit integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.disable_dashboard_membership(
  p_shop_domain text,
  p_actor_membership_id uuid,
  p_target_membership_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.select_active_dashboard_memberships(
  p_shop_domain text,
  p_actor_membership_id uuid,
  p_membership_ids uuid[],
  p_dashboard_user_limit integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.select_reporting_locations(
  p_shop_domain text,
  p_actor_membership_id uuid,
  p_location_ids text[],
  p_location_limit integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.archive_staff_with_dashboard_protection(
  p_shop_domain text,
  p_actor_membership_id uuid,
  p_person_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.materialize_dashboard_owner(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_dashboard_membership_access(text, uuid, uuid, text, text, text[], text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_dashboard_membership(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.select_active_dashboard_memberships(text, uuid, uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.select_reporting_locations(text, uuid, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_staff_with_dashboard_protection(text, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.materialize_dashboard_owner(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_dashboard_membership_access(text, uuid, uuid, text, text, text[], text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.disable_dashboard_membership(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.select_active_dashboard_memberships(text, uuid, uuid[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.select_reporting_locations(text, uuid, text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_staff_with_dashboard_protection(text, uuid, uuid) TO service_role;

-- Legacy functions remain temporarily callable by service_role so this
-- expand migration can be applied safely before the application rollout. The
-- merchant-facing legacy route no longer invokes them; revoke them in a later
-- contract migration after the new application version is established.
