-- Lets the shop's sole active owner rebind their own stale Shopify identity
-- (POS vs. embedded-admin mismatch, reinstall, device change) without a
-- separate approver, which the existing duplicate-access flow cannot provide
-- when the conflicted membership is itself the only owner. Guarded to the
-- owner's own row and refuses any id already claimed elsewhere.

CREATE OR REPLACE FUNCTION public.reclaim_owner_shopops_identity(
  p_shop_domain text,
  p_membership_id uuid,
  p_person_id uuid,
  p_verified_email text,
  p_new_shopify_user_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop text := lower(nullif(btrim(p_shop_domain), ''));
  v_new_user_id text := nullif(btrim(p_new_shopify_user_id), '');
  v_email text := lower(nullif(btrim(p_verified_email), ''));
  v_old_user_id text;
BEGIN
  IF v_shop IS NULL OR p_membership_id IS NULL OR p_person_id IS NULL
    OR v_new_user_id IS NULL OR v_email IS NULL THEN
    RAISE EXCEPTION 'invalid_owner_reclaim_identity';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('shopops-memberships:' || v_shop, 0)
  );

  SELECT btrim(membership.shopify_user_id)
  INTO v_old_user_id
  FROM public.dashboard_memberships membership
  WHERE membership.shop_domain = v_shop
    AND membership.id = p_membership_id
    AND membership.person_id = p_person_id
    AND membership.is_owner = true
    AND membership.status = 'active'
    AND lower(btrim(membership.normalized_email)) = v_email
  FOR UPDATE;
  IF v_old_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_reclaim_not_eligible';
  END IF;
  IF v_old_user_id = v_new_user_id THEN
    RAISE EXCEPTION 'owner_reclaim_not_needed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dashboard_memberships membership
    WHERE membership.shop_domain = v_shop
      AND membership.id <> p_membership_id
      AND btrim(membership.shopify_user_id) = v_new_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.staff_identity_aliases alias
    WHERE alias.shop_domain = v_shop
      AND alias.alias_type = 'shopify_admin_user_id'
      AND alias.alias_value = v_new_user_id
      AND alias.person_id IS DISTINCT FROM p_person_id
  ) THEN
    RAISE EXCEPTION 'owner_identity_in_use';
  END IF;

  UPDATE public.dashboard_memberships
  SET shopify_user_id = v_new_user_id, updated_at = now()
  WHERE shop_domain = v_shop AND id = p_membership_id;

  UPDATE public.user_location_access
  SET shopify_user_id = v_new_user_id
  WHERE shop_domain = v_shop AND membership_id = p_membership_id;

  INSERT INTO public.staff_identity_aliases (
    shop_domain, person_id, alias_type, alias_value, source,
    review_status, first_seen_at, last_seen_at, updated_at
  ) VALUES (
    v_shop, p_person_id, 'shopify_admin_user_id', v_new_user_id,
    'owner_self_reclaim', 'mapped', now(), now(), now()
  )
  ON CONFLICT (shop_domain, alias_type, alias_value)
  DO UPDATE SET
    person_id = EXCLUDED.person_id,
    source = 'owner_self_reclaim',
    review_status = 'mapped',
    last_seen_at = now(),
    updated_at = now();

  INSERT INTO public.staff_identity_aliases (
    shop_domain, person_id, alias_type, alias_value, source,
    review_status, first_seen_at, last_seen_at, updated_at
  ) VALUES (
    v_shop, p_person_id, 'shopify_admin_user_id', v_old_user_id,
    'owner_self_reclaim_superseded', 'pending', now(), now(), now()
  )
  ON CONFLICT (shop_domain, alias_type, alias_value)
  DO UPDATE SET
    source = 'owner_self_reclaim_superseded',
    review_status = 'pending',
    last_seen_at = now(),
    updated_at = now();

  RETURN p_membership_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reclaim_owner_shopops_identity(
  text, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_owner_shopops_identity(
  text, uuid, uuid, text, text
) TO service_role;
