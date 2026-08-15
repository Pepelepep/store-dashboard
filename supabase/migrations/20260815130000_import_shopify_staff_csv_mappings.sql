CREATE OR REPLACE FUNCTION public.import_shopify_staff_csv_mappings(
  p_shop_domain text,
  p_mappings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mapping jsonb;
  v_seller_id text;
  v_action text;
  v_display_name text;
  v_person_id uuid;
  v_created_person_id uuid;
  v_alias_id uuid;
  v_alias_person_id uuid;
  v_seen_seller_ids text[] := ARRAY[]::text[];
  v_applied integer := 0;
  v_skipped integer := 0;
BEGIN
  IF p_shop_domain IS NULL OR btrim(p_shop_domain) = '' THEN
    RAISE EXCEPTION 'shop_domain_required';
  END IF;
  IF jsonb_typeof(p_mappings) <> 'array' OR jsonb_array_length(p_mappings) = 0 THEN
    RAISE EXCEPTION 'staff_csv_mappings_required';
  END IF;
  IF jsonb_array_length(p_mappings) > 1000 THEN
    RAISE EXCEPTION 'staff_csv_mapping_limit';
  END IF;

  FOR v_mapping IN SELECT value FROM jsonb_array_elements(p_mappings)
  LOOP
    v_seller_id := btrim(COALESCE(v_mapping ->> 'sellerId', ''));
    v_action := btrim(COALESCE(v_mapping ->> 'action', ''));
    v_display_name := btrim(COALESCE(v_mapping ->> 'displayName', ''));
    v_person_id := NULL;
    v_created_person_id := NULL;
    v_alias_id := NULL;
    v_alias_person_id := NULL;

    IF v_seller_id = '' OR length(v_seller_id) > 200 OR
       v_action NOT IN ('create', 'link') OR
       v_seller_id = ANY(v_seen_seller_ids) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_seen_seller_ids := array_append(v_seen_seller_ids, v_seller_id);

    SELECT id, person_id
    INTO v_alias_id, v_alias_person_id
    FROM public.staff_identity_aliases
    WHERE shop_domain = p_shop_domain
      AND alias_type = 'pos_attributed_user_id'
      AND alias_value = v_seller_id
    FOR UPDATE;

    IF v_alias_person_id IS NOT NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_action = 'link' THEN
      BEGIN
        v_person_id := (v_mapping ->> 'personId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END;
      SELECT id INTO v_person_id
      FROM public.staff_people
      WHERE shop_domain = p_shop_domain
        AND id = v_person_id;
      IF NOT FOUND THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    ELSE
      IF v_display_name = '' OR length(v_display_name) > 200 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      INSERT INTO public.staff_people (
        shop_domain,
        display_name,
        email
      ) VALUES (
        p_shop_domain,
        v_display_name,
        NULL
      )
      RETURNING id INTO v_person_id;
      v_created_person_id := v_person_id;
    END IF;

    IF v_alias_id IS NOT NULL THEN
      UPDATE public.staff_identity_aliases
      SET person_id = v_person_id,
          review_status = 'mapped',
          updated_at = now()
      WHERE id = v_alias_id
        AND shop_domain = p_shop_domain
        AND person_id IS NULL;
    ELSE
      INSERT INTO public.staff_identity_aliases (
        shop_domain,
        person_id,
        alias_type,
        alias_value,
        source,
        review_status,
        updated_at
      ) VALUES (
        p_shop_domain,
        v_person_id,
        'pos_attributed_user_id',
        v_seller_id,
        'shopify_analytics_csv',
        'mapped',
        now()
      )
      ON CONFLICT (shop_domain, alias_type, alias_value)
      DO NOTHING
      RETURNING id INTO v_alias_id;

      IF v_alias_id IS NULL THEN
        UPDATE public.staff_identity_aliases
        SET person_id = v_person_id,
            review_status = 'mapped',
            updated_at = now()
        WHERE shop_domain = p_shop_domain
          AND alias_type = 'pos_attributed_user_id'
          AND alias_value = v_seller_id
          AND person_id IS NULL
        RETURNING id INTO v_alias_id;
      END IF;
    END IF;

    IF v_alias_id IS NULL THEN
      IF v_created_person_id IS NOT NULL THEN
        DELETE FROM public.staff_people
        WHERE id = v_created_person_id
          AND shop_domain = p_shop_domain;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.import_shopify_staff_csv_mappings(text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_shopify_staff_csv_mappings(text, jsonb)
  TO service_role;
