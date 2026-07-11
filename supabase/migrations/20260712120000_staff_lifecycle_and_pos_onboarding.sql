CREATE TABLE IF NOT EXISTS public.pos_attribution_setup (
  shop_domain text PRIMARY KEY,
  tile_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_attribution_setup ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.pos_attribution_setup FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pos_attribution_setup TO service_role;

CREATE OR REPLACE FUNCTION public.remove_or_archive_staff(
  p_shop_domain text,
  p_person_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.restore_archived_staff(
  p_shop_domain text,
  p_person_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.remove_or_archive_staff(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_archived_staff(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_or_archive_staff(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_archived_staff(text, uuid) TO service_role;
