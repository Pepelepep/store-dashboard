-- Phase 7X: make dashboard_memberships the only ShopOps access authority.
--
-- This is an expand migration. NOT VALID constraints protect every new write
-- without pretending that legacy rows have already been repaired. Run the
-- preflight/audit command, repair scoped stores, then validate the constraints
-- in the contract step described in the accompanying runbook.

CREATE UNIQUE INDEX IF NOT EXISTS staff_people_shop_id_uidx
  ON public.staff_people (shop_domain, id);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_memberships_shop_id_uidx
  ON public.dashboard_memberships (shop_domain, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dashboard_memberships_person_required_check'
      AND conrelid = 'public.dashboard_memberships'::regclass
  ) THEN
    ALTER TABLE public.dashboard_memberships
      ADD CONSTRAINT dashboard_memberships_person_required_check
      CHECK (person_id IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_location_access_membership_required_check'
      AND conrelid = 'public.user_location_access'::regclass
  ) THEN
    ALTER TABLE public.user_location_access
      ADD CONSTRAINT user_location_access_membership_required_check
      CHECK (membership_id IS NOT NULL) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dashboard_memberships_shop_person_fkey'
      AND conrelid = 'public.dashboard_memberships'::regclass
  ) THEN
    ALTER TABLE public.dashboard_memberships
      ADD CONSTRAINT dashboard_memberships_shop_person_fkey
      FOREIGN KEY (shop_domain, person_id)
      REFERENCES public.staff_people (shop_domain, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_identity_aliases_shop_person_fkey'
      AND conrelid = 'public.staff_identity_aliases'::regclass
  ) THEN
    ALTER TABLE public.staff_identity_aliases
      ADD CONSTRAINT staff_identity_aliases_shop_person_fkey
      FOREIGN KEY (shop_domain, person_id)
      REFERENCES public.staff_people (shop_domain, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_location_access_shop_membership_fkey'
      AND conrelid = 'public.user_location_access'::regclass
  ) THEN
    ALTER TABLE public.user_location_access
      ADD CONSTRAINT user_location_access_shop_membership_fkey
      FOREIGN KEY (shop_domain, membership_id)
      REFERENCES public.dashboard_memberships (shop_domain, id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_location_access_shop_person_fkey'
      AND conrelid = 'public.user_location_access'::regclass
  ) THEN
    ALTER TABLE public.user_location_access
      ADD CONSTRAINT user_location_access_shop_person_fkey
      FOREIGN KEY (shop_domain, person_id)
      REFERENCES public.staff_people (shop_domain, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$$;

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
  v_display_name text := coalesce(
    nullif(btrim(p_display_name), ''), v_email, 'Store owner'
  );
  v_owner_id uuid;
  v_identity_membership_id uuid;
  v_person_id uuid;
  v_email_person_id uuid;
BEGIN
  IF v_shop IS NULL OR (v_user_id IS NULL AND v_email IS NULL) THEN
    RAISE EXCEPTION 'invalid_owner_identity';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  SELECT membership.id, membership.person_id
  INTO v_owner_id, v_person_id
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop AND membership.is_owner = true
  FOR UPDATE;

  SELECT membership.id
  INTO v_identity_membership_id
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND (
      (v_user_id IS NOT NULL AND btrim(membership.shopify_user_id) = v_user_id)
      OR (
        v_email IS NOT NULL
        AND lower(btrim(membership.normalized_email)) = v_email
      )
    )
  ORDER BY membership.is_owner DESC, membership.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_owner_id IS NULL THEN
    v_owner_id := v_identity_membership_id;
    IF v_owner_id IS NOT NULL THEN
      SELECT person_id INTO v_person_id
      FROM public.dashboard_memberships
      WHERE id = v_owner_id;
    END IF;
  ELSIF v_identity_membership_id IS NOT NULL
    AND v_identity_membership_id <> v_owner_id THEN
    RAISE EXCEPTION 'owner_identity_conflict';
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT person.id INTO v_email_person_id
    FROM public.staff_people person
    WHERE person.shop_domain = v_shop
      AND lower(btrim(person.email)) = v_email
    FOR UPDATE;
    IF v_person_id IS NOT NULL AND v_email_person_id IS NOT NULL
      AND v_person_id <> v_email_person_id THEN
      RAISE EXCEPTION 'owner_identity_conflict';
    END IF;
    v_person_id := coalesce(v_person_id, v_email_person_id);
  END IF;

  IF v_person_id IS NULL AND v_user_id IS NOT NULL THEN
    SELECT alias.person_id INTO v_person_id
    FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'shopify_admin_user_id'
      AND alias.alias_value = v_user_id
      AND alias.person_id IS NOT NULL
    FOR UPDATE;
  END IF;

  IF v_person_id IS NULL THEN
    INSERT INTO public.staff_people (
      shop_domain, display_name, email, is_active
    ) VALUES (
      v_shop, v_display_name, v_email, true
    ) RETURNING id INTO v_person_id;
  ELSE
    UPDATE public.staff_people
    SET
      display_name = v_display_name,
      email = coalesce(v_email, email),
      is_active = true,
      updated_at = now()
    WHERE shop_domain = v_shop AND id = v_person_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner_identity_conflict'; END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'email'
      AND v_email IS NOT NULL
      AND lower(btrim(alias.alias_value)) = v_email
      AND alias.person_id IS DISTINCT FROM v_person_id
  ) OR EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'shopify_admin_user_id'
      AND v_user_id IS NOT NULL
      AND alias.alias_value = v_user_id
      AND alias.person_id IS DISTINCT FROM v_person_id
  ) THEN
    RAISE EXCEPTION 'owner_identity_conflict';
  END IF;

  IF v_owner_id IS NULL THEN
    INSERT INTO public.dashboard_memberships (
      shop_domain, person_id, shopify_user_id, normalized_email,
      display_name, role, status, is_owner
    ) VALUES (
      v_shop, v_person_id, v_user_id, v_email,
      v_display_name, 'owner', 'active', true
    ) RETURNING id INTO v_owner_id;
  ELSE
    UPDATE public.dashboard_memberships
    SET
      person_id = v_person_id,
      shopify_user_id = coalesce(v_user_id, shopify_user_id),
      normalized_email = coalesce(v_email, normalized_email),
      display_name = v_display_name,
      role = 'owner',
      status = 'active',
      is_owner = true,
      updated_at = now()
    WHERE id = v_owner_id AND shop_domain = v_shop;
  END IF;

  IF v_email IS NOT NULL THEN
    INSERT INTO public.staff_identity_aliases (
      shop_domain, person_id, alias_type, alias_value, source,
      review_status, first_seen_at, last_seen_at, updated_at
    ) VALUES (
      v_shop, v_person_id, 'email', v_email, 'owner_materialization',
      'mapped', now(), now(), now()
    )
    ON CONFLICT (shop_domain, alias_type, alias_value)
    DO UPDATE SET
      person_id = EXCLUDED.person_id,
      review_status = 'mapped',
      last_seen_at = now(),
      updated_at = now();
  END IF;

  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.staff_identity_aliases (
      shop_domain, person_id, alias_type, alias_value, source,
      review_status, first_seen_at, last_seen_at, updated_at
    ) VALUES (
      v_shop, v_person_id, 'shopify_admin_user_id', v_user_id,
      'owner_materialization', 'mapped', now(), now(), now()
    )
    ON CONFLICT (shop_domain, alias_type, alias_value)
    DO UPDATE SET
      person_id = EXCLUDED.person_id,
      review_status = 'mapped',
      last_seen_at = now(),
      updated_at = now();
  END IF;

  DELETE FROM public.user_location_access access
  WHERE access.shop_domain = v_shop
    AND (
      access.membership_id = v_owner_id
      OR access.person_id = v_person_id
      OR (v_email IS NOT NULL AND lower(btrim(access.user_email)) = v_email)
      OR (v_user_id IS NOT NULL AND btrim(access.shopify_user_id) = v_user_id)
    );

  INSERT INTO public.user_location_access (
    shop_domain, membership_id, person_id, access_label, user_email,
    shopify_user_id, shopify_location_id, location_name,
    role, can_view, can_manage
  ) VALUES (
    v_shop, v_owner_id, v_person_id, v_display_name, v_email,
    v_user_id, '*', 'All reporting locations',
    'admin', true, true
  );

  RETURN v_owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_or_update_shopops_access(
  p_shop_domain text,
  p_actor_membership_id uuid,
  p_person_id uuid,
  p_canonical_email text,
  p_display_name text,
  p_role text,
  p_location_ids text[],
  p_dashboard_user_limit integer,
  p_restore_archived boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_email text := lower(nullif(btrim(p_canonical_email), ''));
  v_display_name text := nullif(btrim(p_display_name), '');
  v_person_id uuid := p_person_id;
  v_person_active boolean;
  v_existing_display_name text;
  v_membership_ids uuid[];
  v_membership_id uuid;
  v_existing_role text;
  v_existing_status text;
  v_existing_owner boolean;
  v_hidden_user_id text;
  v_location_ids text[];
  v_active_count integer;
BEGIN
  IF v_shop IS NULL OR v_email IS NULL
    OR v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_access_identity';
  END IF;
  IF p_role NOT IN ('admin', 'manager', 'viewer') THEN
    RAISE EXCEPTION 'invalid_access_role';
  END IF;
  IF p_dashboard_user_limit IS NOT NULL AND p_dashboard_user_limit < 1 THEN
    RAISE EXCEPTION 'invalid_plan_limit';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  IF v_person_id IS NOT NULL THEN
    SELECT person.is_active, person.display_name
    INTO v_person_active, v_existing_display_name
    FROM public.staff_people person
    WHERE person.shop_domain = v_shop AND person.id = v_person_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'staff_member_not_found'; END IF;

    IF EXISTS (
      SELECT 1 FROM public.staff_people person
      WHERE person.shop_domain = v_shop
        AND lower(btrim(person.email)) = v_email
        AND person.id <> v_person_id
    ) THEN
      RAISE EXCEPTION 'login_email_in_use';
    END IF;
  ELSE
    SELECT person.id, person.is_active, person.display_name
    INTO v_person_id, v_person_active, v_existing_display_name
    FROM public.staff_people person
    WHERE person.shop_domain = v_shop
      AND lower(btrim(person.email)) = v_email
    FOR UPDATE;

    IF v_person_id IS NULL THEN
      INSERT INTO public.staff_people (
        shop_domain, display_name, email, is_active
      ) VALUES (
        v_shop, coalesce(v_display_name, v_email), v_email, true
      ) RETURNING id, is_active, display_name
      INTO v_person_id, v_person_active, v_existing_display_name;
    END IF;
  END IF;

  IF NOT v_person_active AND NOT coalesce(p_restore_archived, false) THEN
    RAISE EXCEPTION 'active_staff_member_required';
  END IF;
  v_display_name := coalesce(v_display_name, v_existing_display_name, v_email);

  IF EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'email'
      AND lower(btrim(alias.alias_value)) = v_email
      AND alias.person_id IS DISTINCT FROM v_person_id
  ) THEN
    RAISE EXCEPTION 'login_email_in_use';
  END IF;

  PERFORM 1
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND (
      membership.person_id = v_person_id
      OR lower(btrim(membership.normalized_email)) = v_email
    )
  FOR UPDATE;

  SELECT array_agg(membership.id ORDER BY
    (membership.person_id = v_person_id) DESC,
    membership.created_at ASC
  )
  INTO v_membership_ids
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND (
      membership.person_id = v_person_id
      OR lower(btrim(membership.normalized_email)) = v_email
    );

  IF cardinality(coalesce(v_membership_ids, ARRAY[]::uuid[])) > 1 THEN
    RAISE EXCEPTION 'dashboard_identity_ambiguous';
  END IF;
  v_membership_id := v_membership_ids[1];

  IF v_membership_id IS NOT NULL THEN
    SELECT role, status, is_owner, nullif(btrim(shopify_user_id), '')
    INTO v_existing_role, v_existing_status, v_existing_owner, v_hidden_user_id
    FROM public.dashboard_memberships
    WHERE id = v_membership_id AND shop_domain = v_shop;
    IF v_existing_owner THEN RAISE EXCEPTION 'owner_membership_locked'; END IF;
  END IF;

  IF p_role = 'admin' THEN
    v_location_ids := ARRAY['*']::text[];
  ELSE
    SELECT coalesce(
      array_agg(DISTINCT location.shopify_location_id), ARRAY[]::text[]
    )
    INTO v_location_ids
    FROM public.locations location
    WHERE location.shop_domain = v_shop
      AND location.shopify_is_active = true
      AND location.reporting_enabled = true
      AND location.shopify_location_id = ANY(
        coalesce(p_location_ids, ARRAY[]::text[])
      );

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
    SELECT count(*)::integer INTO v_active_count
    FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop AND membership.status = 'active';
    IF p_dashboard_user_limit IS NOT NULL
      AND v_active_count >= p_dashboard_user_limit THEN
      RAISE EXCEPTION 'dashboard_plan_capacity';
    END IF;
  END IF;

  UPDATE public.staff_people
  SET
    display_name = v_display_name,
    email = v_email,
    is_active = true,
    updated_at = now()
  WHERE shop_domain = v_shop AND id = v_person_id;

  INSERT INTO public.staff_identity_aliases (
    shop_domain, person_id, alias_type, alias_value, source,
    review_status, first_seen_at, last_seen_at, updated_at
  ) VALUES (
    v_shop, v_person_id, 'email', v_email, 'staff_manager',
    'mapped', now(), now(), now()
  )
  ON CONFLICT (shop_domain, alias_type, alias_value)
  DO UPDATE SET
    person_id = EXCLUDED.person_id,
    review_status = 'mapped',
    last_seen_at = now(),
    updated_at = now();

  IF v_membership_id IS NULL THEN
    INSERT INTO public.dashboard_memberships (
      shop_domain, person_id, normalized_email, display_name,
      role, status, is_owner
    ) VALUES (
      v_shop, v_person_id, v_email, v_display_name,
      p_role, 'active', false
    ) RETURNING id INTO v_membership_id;
  ELSE
    UPDATE public.dashboard_memberships
    SET
      person_id = v_person_id,
      normalized_email = v_email,
      display_name = v_display_name,
      role = p_role,
      status = 'active',
      updated_at = now()
    WHERE id = v_membership_id AND shop_domain = v_shop;
  END IF;

  DELETE FROM public.user_location_access access
  WHERE access.shop_domain = v_shop
    AND (
      access.membership_id = v_membership_id
      OR access.person_id = v_person_id
      OR lower(btrim(access.user_email)) = v_email
      OR (
        v_hidden_user_id IS NOT NULL
        AND btrim(access.shopify_user_id) = v_hidden_user_id
      )
    );

  INSERT INTO public.user_location_access (
    shop_domain, membership_id, person_id, access_label, user_email,
    shopify_user_id, shopify_location_id, location_name,
    role, can_view, can_manage
  )
  SELECT
    v_shop,
    v_membership_id,
    v_person_id,
    v_display_name,
    v_email,
    v_hidden_user_id,
    location_id,
    CASE
      WHEN location_id = '*' THEN 'All reporting locations'
      ELSE location.name
    END,
    p_role,
    true,
    p_role IN ('manager', 'admin')
  FROM unnest(v_location_ids) location_id
  LEFT JOIN public.locations location
    ON location.shop_domain = v_shop
   AND location.shopify_location_id = location_id;

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
  IF v_shop IS NULL OR p_actor_membership_id IS NULL
    OR p_target_membership_id IS NULL THEN
    RAISE EXCEPTION 'invalid_membership';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

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

  -- Location configuration is deliberately preserved for safe re-enable.
  UPDATE public.dashboard_memberships
  SET status = 'disabled', updated_at = now()
  WHERE id = p_target_membership_id AND shop_domain = v_shop;
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
  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  PERFORM 1 FROM public.staff_people person
  WHERE person.shop_domain = v_shop AND person.id = p_person_id
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
    WHERE id = v_membership_id AND shop_domain = v_shop;
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

CREATE OR REPLACE FUNCTION public.bind_verified_shopops_identity(
  p_shop_domain text,
  p_membership_id uuid,
  p_person_id uuid,
  p_shopify_user_id text,
  p_verified_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_user_id text := nullif(btrim(p_shopify_user_id), '');
  v_email text := lower(nullif(btrim(p_verified_email), ''));
BEGIN
  IF v_shop IS NULL OR p_membership_id IS NULL OR p_person_id IS NULL
    OR v_user_id IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'invalid_access_identity';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  PERFORM 1 FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND membership.id = p_membership_id
    AND membership.person_id = p_person_id
    AND membership.status = 'active'
    AND (
      membership.shopify_user_id IS NULL
      OR btrim(membership.shopify_user_id) = v_user_id
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'membership_not_bindable'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop
      AND membership.id <> p_membership_id
      AND (
        btrim(membership.shopify_user_id) = v_user_id
        OR lower(btrim(membership.normalized_email)) = v_email
      )
  ) OR EXISTS (
    SELECT 1 FROM public.staff_people person
    WHERE person.shop_domain = v_shop
      AND person.id <> p_person_id
      AND lower(btrim(person.email)) = v_email
  ) OR EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'shopify_admin_user_id'
      AND alias.alias_value = v_user_id
      AND alias.person_id IS DISTINCT FROM p_person_id
  ) OR EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'email'
      AND lower(btrim(alias.alias_value)) = v_email
      AND alias.person_id IS DISTINCT FROM p_person_id
  ) THEN
    RAISE EXCEPTION 'dashboard_identity_in_use';
  END IF;

  UPDATE public.staff_people
  SET email = v_email, is_active = true, updated_at = now()
  WHERE shop_domain = v_shop AND id = p_person_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_member_not_found'; END IF;

  INSERT INTO public.staff_identity_aliases (
    shop_domain, person_id, alias_type, alias_value, source,
    review_status, first_seen_at, last_seen_at, updated_at
  ) VALUES
    (
      v_shop, p_person_id, 'email', v_email, 'authenticated_session',
      'mapped', now(), now(), now()
    ),
    (
      v_shop, p_person_id, 'shopify_admin_user_id', v_user_id,
      'authenticated_session', 'mapped', now(), now(), now()
    )
  ON CONFLICT (shop_domain, alias_type, alias_value)
  DO UPDATE SET
    person_id = EXCLUDED.person_id,
    review_status = 'mapped',
    last_seen_at = now(),
    updated_at = now();

  UPDATE public.dashboard_memberships
  SET
    shopify_user_id = v_user_id,
    normalized_email = v_email,
    updated_at = now()
  WHERE shop_domain = v_shop AND id = p_membership_id;

  UPDATE public.user_location_access
  SET
    person_id = p_person_id,
    user_email = v_email,
    shopify_user_id = v_user_id
  WHERE shop_domain = v_shop AND membership_id = p_membership_id;

  RETURN p_membership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_duplicate_shopops_access(
  p_shop_domain text,
  p_owner_membership_id uuid,
  p_revoked_membership_id uuid,
  p_waiting_membership_id uuid,
  p_shopify_user_id text,
  p_verified_email text,
  p_allow_attributed_merge boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_user_id text := nullif(btrim(p_shopify_user_id), '');
  v_email text := lower(nullif(btrim(p_verified_email), ''));
  v_bound_person_id uuid;
  v_waiting_person_id uuid;
  v_waiting_role text;
  v_waiting_display_name text;
  v_location_ids text[];
BEGIN
  IF v_shop IS NULL OR v_user_id IS NULL OR v_email IS NULL
    OR p_owner_membership_id IS NULL
    OR p_revoked_membership_id IS NULL
    OR p_waiting_membership_id IS NULL
    OR p_revoked_membership_id = p_waiting_membership_id THEN
    RAISE EXCEPTION 'duplicate_access_ambiguous';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships owner
    WHERE owner.shop_domain = v_shop
      AND owner.id = p_owner_membership_id
      AND owner.is_owner = true
      AND owner.status = 'active'
  ) THEN
    RAISE EXCEPTION 'owner_membership_required';
  END IF;

  SELECT membership.person_id
  INTO v_bound_person_id
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND membership.id = p_revoked_membership_id
    AND membership.status = 'disabled'
    AND membership.is_owner = false
    AND btrim(membership.shopify_user_id) = v_user_id
  FOR UPDATE;
  IF v_bound_person_id IS NULL THEN
    RAISE EXCEPTION 'duplicate_access_ambiguous';
  END IF;

  SELECT membership.person_id, membership.role, membership.display_name
  INTO v_waiting_person_id, v_waiting_role, v_waiting_display_name
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND membership.id = p_waiting_membership_id
    AND membership.status = 'active'
    AND membership.is_owner = false
    AND membership.shopify_user_id IS NULL
    AND lower(btrim(membership.normalized_email)) = v_email
  FOR UPDATE;
  IF v_waiting_person_id IS NULL OR v_waiting_person_id = v_bound_person_id THEN
    RAISE EXCEPTION 'duplicate_access_ambiguous';
  END IF;

  IF (SELECT count(*) FROM public.dashboard_memberships membership
      WHERE membership.shop_domain = v_shop
        AND btrim(membership.shopify_user_id) = v_user_id) <> 1
    OR (SELECT count(*) FROM public.dashboard_memberships membership
        WHERE membership.shop_domain = v_shop
          AND lower(btrim(membership.normalized_email)) = v_email) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.staff_identity_aliases alias
      WHERE alias.shop_domain = v_shop
        AND alias.person_id = v_bound_person_id
        AND alias.alias_type = 'shopify_admin_user_id'
        AND alias.alias_value = v_user_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.staff_identity_aliases alias
      WHERE alias.shop_domain = v_shop
        AND alias.person_id = v_waiting_person_id
        AND alias.alias_type = 'email'
        AND lower(btrim(alias.alias_value)) = v_email
    ) THEN
    RAISE EXCEPTION 'duplicate_access_ambiguous';
  END IF;

  IF NOT coalesce(p_allow_attributed_merge, false) AND EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.person_id = v_waiting_person_id
      AND NOT (
        alias.alias_type = 'email'
        AND lower(btrim(alias.alias_value)) = v_email
      )
  ) THEN
    RAISE EXCEPTION 'duplicate_access_attribution_conflict';
  END IF;

  IF v_waiting_role = 'admin' THEN
    v_location_ids := ARRAY['*']::text[];
  ELSE
    SELECT coalesce(
      array_agg(DISTINCT access.shopify_location_id) FILTER (
        WHERE access.shopify_location_id IS NOT NULL
          AND access.shopify_location_id <> '*'
          AND (access.can_view OR access.can_manage)
      ),
      ARRAY[]::text[]
    )
    INTO v_location_ids
    FROM public.user_location_access access
    WHERE access.shop_domain = v_shop
      AND access.membership_id = p_waiting_membership_id;
    IF cardinality(v_location_ids) = 0 THEN
      RAISE EXCEPTION 'invalid_access_locations';
    END IF;
  END IF;

  UPDATE public.dashboard_memberships
  SET normalized_email = NULL, status = 'disabled', updated_at = now()
  WHERE shop_domain = v_shop AND id = p_waiting_membership_id;

  UPDATE public.staff_people
  SET email = NULL, updated_at = now()
  WHERE shop_domain = v_shop AND id = v_waiting_person_id;

  UPDATE public.staff_identity_aliases
  SET person_id = v_bound_person_id, review_status = 'mapped', updated_at = now()
  WHERE shop_domain = v_shop AND person_id = v_waiting_person_id;

  UPDATE public.staff_people
  SET
    display_name = coalesce(nullif(btrim(v_waiting_display_name), ''), display_name),
    email = v_email,
    is_active = true,
    updated_at = now()
  WHERE shop_domain = v_shop AND id = v_bound_person_id;

  UPDATE public.dashboard_memberships
  SET
    person_id = v_bound_person_id,
    normalized_email = v_email,
    display_name = coalesce(nullif(btrim(v_waiting_display_name), ''), display_name),
    role = v_waiting_role,
    status = 'active',
    updated_at = now()
  WHERE shop_domain = v_shop AND id = p_revoked_membership_id;

  DELETE FROM public.user_location_access access
  WHERE access.shop_domain = v_shop
    AND access.membership_id IN (
      p_revoked_membership_id, p_waiting_membership_id
    );

  INSERT INTO public.user_location_access (
    shop_domain, membership_id, person_id, access_label, user_email,
    shopify_user_id, shopify_location_id, location_name,
    role, can_view, can_manage
  )
  SELECT
    v_shop,
    p_revoked_membership_id,
    v_bound_person_id,
    v_waiting_display_name,
    v_email,
    v_user_id,
    location_id,
    CASE
      WHEN location_id = '*' THEN 'All reporting locations'
      ELSE location.name
    END,
    v_waiting_role,
    true,
    v_waiting_role IN ('manager', 'admin')
  FROM unnest(v_location_ids) location_id
  LEFT JOIN public.locations location
    ON location.shop_domain = v_shop
   AND location.shopify_location_id = location_id;

  DELETE FROM public.dashboard_memberships
  WHERE shop_domain = v_shop AND id = p_waiting_membership_id;

  IF EXISTS (
    SELECT 1 FROM public.staff_identity_aliases
    WHERE shop_domain = v_shop AND person_id = v_waiting_person_id
  ) OR EXISTS (
    SELECT 1 FROM public.dashboard_memberships
    WHERE shop_domain = v_shop AND person_id = v_waiting_person_id
  ) THEN
    RAISE EXCEPTION 'duplicate_access_consolidation_failed';
  END IF;

  DELETE FROM public.staff_people
  WHERE shop_domain = v_shop AND id = v_waiting_person_id;

  RETURN p_revoked_membership_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_shopops_person_profile(
  p_shop_domain text,
  p_actor_membership_id uuid,
  p_person_id uuid,
  p_display_name text,
  p_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_display_name text := nullif(btrim(p_display_name), '');
  v_email text := lower(nullif(btrim(p_email), ''));
  v_membership_id uuid;
  v_membership_email text;
BEGIN
  IF v_shop IS NULL OR p_person_id IS NULL OR v_display_name IS NULL THEN
    RAISE EXCEPTION 'staff_member_not_found';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.dashboard_memberships actor
    WHERE actor.id = p_actor_membership_id
      AND actor.shop_domain = v_shop
      AND actor.status = 'active'
      AND actor.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'dashboard_admin_required';
  END IF;

  PERFORM 1 FROM public.staff_people person
  WHERE person.shop_domain = v_shop AND person.id = p_person_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_member_not_found'; END IF;

  SELECT membership.id, lower(nullif(btrim(membership.normalized_email), ''))
  INTO v_membership_id, v_membership_email
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop AND membership.person_id = p_person_id
  FOR UPDATE;

  IF v_membership_id IS NOT NULL
    AND v_membership_email IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'dashboard_email_edit_required';
  END IF;

  UPDATE public.staff_people
  SET display_name = v_display_name, email = v_email, updated_at = now()
  WHERE shop_domain = v_shop AND id = p_person_id;

  IF v_membership_id IS NOT NULL THEN
    UPDATE public.dashboard_memberships
    SET display_name = v_display_name, updated_at = now()
    WHERE shop_domain = v_shop AND id = v_membership_id;
    UPDATE public.user_location_access
    SET access_label = v_display_name
    WHERE shop_domain = v_shop AND membership_id = v_membership_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.repair_shopops_access_integrity(
  p_shop_domain text,
  p_target_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_target_email text := lower(nullif(btrim(p_target_email), ''));
  v_owner_id uuid;
  v_owner_user_id text;
  v_owner_email text;
  v_owner_name text;
  v_owner_candidates integer;
  v_repaired integer := 0;
  candidate record;
BEGIN
  IF v_shop IS NULL THEN RAISE EXCEPTION 'invalid_shop_domain'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  SELECT
    membership.shopify_user_id,
    membership.normalized_email,
    membership.display_name
  INTO v_owner_user_id, v_owner_email, v_owner_name
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop AND membership.is_owner = true
  FOR UPDATE;

  IF v_owner_user_id IS NULL AND v_owner_email IS NULL THEN
    SELECT count(DISTINCT btrim(access.shopify_user_id))::integer
    INTO v_owner_candidates
    FROM public.user_location_access access
    WHERE access.shop_domain = v_shop
      AND access.role = 'admin'
      AND access.shopify_location_id = '*'
      AND nullif(btrim(access.shopify_user_id), '') IS NOT NULL;
    IF v_owner_candidates <> 1 THEN
      RAISE EXCEPTION 'owner_repair_identity_ambiguous';
    END IF;

    SELECT
      btrim(access.shopify_user_id),
      lower(nullif(btrim(access.user_email), '')),
      coalesce(nullif(btrim(access.access_label), ''), 'Store owner')
    INTO v_owner_user_id, v_owner_email, v_owner_name
    FROM public.user_location_access access
    WHERE access.shop_domain = v_shop
      AND access.role = 'admin'
      AND access.shopify_location_id = '*'
      AND nullif(btrim(access.shopify_user_id), '') IS NOT NULL
    ORDER BY access.created_at ASC
    LIMIT 1;
  END IF;

  v_owner_id := public.materialize_dashboard_owner(
    v_shop, v_owner_user_id, v_owner_email, v_owner_name
  );

  FOR candidate IN
    SELECT
      lower(btrim(access.user_email)) AS email,
      min(access.person_id::text)::uuid AS person_id,
      coalesce(
        min(nullif(btrim(access.access_label), '')),
        min(lower(btrim(access.user_email)))
      ) AS display_name,
      CASE
        WHEN bool_or(access.role = 'admin') THEN 'admin'
        WHEN bool_or(access.role = 'manager') THEN 'manager'
        ELSE 'viewer'
      END AS role,
      coalesce(
        array_agg(DISTINCT access.shopify_location_id) FILTER (
          WHERE access.shopify_location_id IS NOT NULL
            AND access.shopify_location_id <> '*'
        ),
        ARRAY[]::text[]
      ) AS location_ids,
      count(DISTINCT access.person_id) AS person_count
    FROM public.user_location_access access
    WHERE access.shop_domain = v_shop
      AND nullif(btrim(access.user_email), '') IS NOT NULL
      AND (v_target_email IS NULL
        OR lower(btrim(access.user_email)) = v_target_email)
      AND NOT (
        access.membership_id = v_owner_id
        OR (v_owner_email IS NOT NULL
          AND lower(btrim(access.user_email)) = lower(btrim(v_owner_email)))
      )
    GROUP BY lower(btrim(access.user_email))
  LOOP
    IF candidate.person_count > 1 THEN
      RAISE EXCEPTION 'repair_person_ambiguous';
    END IF;
    PERFORM public.grant_or_update_shopops_access(
      v_shop,
      v_owner_id,
      candidate.person_id,
      candidate.email,
      candidate.display_name,
      candidate.role,
      candidate.location_ids,
      NULL,
      true
    );
    v_repaired := v_repaired + 1;
  END LOOP;

  IF v_target_email IS NOT NULL AND v_repaired = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.dashboard_memberships membership
      WHERE membership.shop_domain = v_shop
        AND lower(btrim(membership.normalized_email)) = v_target_email
    ) THEN
    RAISE EXCEPTION 'repair_target_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_location_access access
    LEFT JOIN public.dashboard_memberships membership
      ON membership.shop_domain = access.shop_domain
     AND membership.id = access.membership_id
    WHERE access.shop_domain = v_shop
      AND membership.id IS NULL
      AND (
        v_target_email IS NULL
        OR lower(btrim(access.user_email)) = v_target_email
        OR access.shopify_location_id = '*'
      )
  ) THEN
    RAISE EXCEPTION 'repair_invariant_failed';
  END IF;

  IF (SELECT count(*) FROM public.dashboard_memberships membership
      WHERE membership.shop_domain = v_shop
        AND membership.is_owner = true
        AND membership.role = 'owner'
        AND membership.status = 'active'
        AND membership.person_id IS NOT NULL) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.dashboard_memberships membership
      JOIN public.user_location_access access
        ON access.shop_domain = membership.shop_domain
       AND access.membership_id = membership.id
       AND access.person_id = membership.person_id
      WHERE membership.shop_domain = v_shop
        AND membership.is_owner = true
        AND access.shopify_location_id = '*'
        AND access.can_view = true
        AND access.can_manage = true
    ) THEN
    RAISE EXCEPTION 'repair_owner_invariant_failed';
  END IF;

  IF v_target_email IS NOT NULL AND (
    (SELECT count(*) FROM public.staff_people person
     WHERE person.shop_domain = v_shop
       AND lower(btrim(person.email)) = v_target_email) <> 1
    OR (SELECT count(*) FROM public.dashboard_memberships membership
        WHERE membership.shop_domain = v_shop
          AND lower(btrim(membership.normalized_email)) = v_target_email) <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.dashboard_memberships membership
      JOIN public.staff_people person
        ON person.shop_domain = membership.shop_domain
       AND person.id = membership.person_id
      WHERE membership.shop_domain = v_shop
        AND lower(btrim(membership.normalized_email)) = v_target_email
        AND lower(btrim(person.email)) = v_target_email
        AND person.is_active = true
        AND membership.status = 'active'
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_location_access access
      JOIN public.dashboard_memberships membership
        ON membership.shop_domain = access.shop_domain
       AND membership.id = access.membership_id
      WHERE access.shop_domain = v_shop
        AND lower(btrim(access.user_email)) = v_target_email
        AND (
          access.person_id IS DISTINCT FROM membership.person_id
          OR lower(btrim(access.user_email)) IS DISTINCT FROM
            lower(btrim(membership.normalized_email))
        )
    )
  ) THEN
    RAISE EXCEPTION 'repair_target_invariant_failed';
  END IF;

  RETURN jsonb_build_object(
    'owner_memberships', (
      SELECT count(*) FROM public.dashboard_memberships
      WHERE shop_domain = v_shop AND is_owner = true AND status = 'active'
    ),
    'target_memberships', (
      SELECT count(*) FROM public.dashboard_memberships
      WHERE shop_domain = v_shop
        AND (v_target_email IS NULL
          OR lower(btrim(normalized_email)) = v_target_email)
    ),
    'repaired_accesses', v_repaired,
    'integrity_issues', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_dashboard_owner(text, text, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_or_update_shopops_access(
  text, uuid, uuid, text, text, text, text[], integer, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.disable_dashboard_membership(text, uuid, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_staff_with_dashboard_protection(
  text, uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_verified_shopops_identity(
  text, uuid, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_duplicate_shopops_access(
  text, uuid, uuid, uuid, text, text, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_shopops_person_profile(
  text, uuid, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_shopops_access_integrity(text, text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.materialize_dashboard_owner(
  text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_or_update_shopops_access(
  text, uuid, uuid, text, text, text, text[], integer, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.disable_dashboard_membership(text, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_staff_with_dashboard_protection(
  text, uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.bind_verified_shopops_identity(
  text, uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_duplicate_shopops_access(
  text, uuid, uuid, uuid, text, text, boolean
) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_shopops_person_profile(
  text, uuid, uuid, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.repair_shopops_access_integrity(text, text)
  TO service_role;
