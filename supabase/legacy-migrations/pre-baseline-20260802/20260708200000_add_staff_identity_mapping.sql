CREATE TABLE IF NOT EXISTS public.staff_people (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    shop_domain text NOT NULL,
    display_name text NOT NULL,
    email text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.staff_identity_aliases (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    shop_domain text NOT NULL,
    person_id uuid REFERENCES public.staff_people(id) ON DELETE SET NULL,
    alias_type text NOT NULL,
    alias_value text NOT NULL,
    source text,
    first_seen_at timestamptz,
    last_seen_at timestamptz,
    last_location_id text,
    last_device_id text,
    last_device_name text,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT staff_identity_aliases_type_check CHECK (
        alias_type IN (
            'email',
            'shopify_admin_user_id',
            'pos_staff_member_id',
            'pos_user_id',
            'pos_attributed_user_id',
            'pos_effective_staff_id'
        )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_identity_aliases_shop_type_value_uidx
    ON public.staff_identity_aliases (shop_domain, alias_type, alias_value);

CREATE INDEX IF NOT EXISTS staff_people_shop_domain_idx
    ON public.staff_people USING btree (shop_domain);

CREATE UNIQUE INDEX IF NOT EXISTS staff_people_shop_email_uidx
    ON public.staff_people (shop_domain, lower(email))
    WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS staff_identity_aliases_shop_person_idx
    ON public.staff_identity_aliases USING btree (shop_domain, person_id);

WITH permission_people AS (
    SELECT DISTINCT ON (shop_domain, lower(user_email))
        shop_domain,
        NULLIF(trim(user_email), '') AS email,
        COALESCE(NULLIF(trim(access_label), ''), NULLIF(trim(user_email), '')) AS display_name
    FROM public.user_location_access
    WHERE user_email IS NOT NULL AND NULLIF(trim(user_email), '') IS NOT NULL
    ORDER BY shop_domain, lower(user_email), created_at ASC
)
UPDATE public.staff_people people
SET
    display_name = COALESCE(NULLIF(permission_people.display_name, ''), people.display_name),
    updated_at = now()
FROM permission_people
WHERE people.shop_domain = permission_people.shop_domain
  AND lower(people.email) = lower(permission_people.email);

WITH permission_people AS (
    SELECT DISTINCT ON (shop_domain, lower(user_email))
        shop_domain,
        NULLIF(trim(user_email), '') AS email,
        COALESCE(NULLIF(trim(access_label), ''), NULLIF(trim(user_email), '')) AS display_name
    FROM public.user_location_access
    WHERE user_email IS NOT NULL AND NULLIF(trim(user_email), '') IS NOT NULL
    ORDER BY shop_domain, lower(user_email), created_at ASC
)
INSERT INTO public.staff_people (shop_domain, display_name, email)
SELECT shop_domain, display_name, lower(email)
FROM permission_people
WHERE display_name IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.staff_people people
      WHERE people.shop_domain = permission_people.shop_domain
        AND lower(people.email) = lower(permission_people.email)
  );

WITH email_aliases AS (
    SELECT DISTINCT
        people.shop_domain,
        people.id AS person_id,
        lower(access.user_email) AS alias_value
    FROM public.user_location_access access
    JOIN public.staff_people people
      ON people.shop_domain = access.shop_domain
     AND lower(people.email) = lower(access.user_email)
    WHERE access.user_email IS NOT NULL AND NULLIF(trim(access.user_email), '') IS NOT NULL
)
INSERT INTO public.staff_identity_aliases (
    shop_domain,
    person_id,
    alias_type,
    alias_value,
    source,
    first_seen_at,
    last_seen_at
)
SELECT
    shop_domain,
    person_id,
    'email',
    alias_value,
    'user_location_access',
    now(),
    now()
FROM email_aliases
ON CONFLICT (shop_domain, alias_type, alias_value)
DO UPDATE SET
    person_id = COALESCE(public.staff_identity_aliases.person_id, EXCLUDED.person_id),
    source = COALESCE(public.staff_identity_aliases.source, EXCLUDED.source),
    updated_at = now();

WITH shopify_user_aliases AS (
    SELECT DISTINCT
        access.shop_domain,
        people.id AS person_id,
        trim(access.shopify_user_id) AS alias_value
    FROM public.user_location_access access
    LEFT JOIN public.staff_people people
      ON people.shop_domain = access.shop_domain
     AND access.user_email IS NOT NULL
     AND lower(people.email) = lower(access.user_email)
    WHERE access.shopify_user_id IS NOT NULL
      AND NULLIF(trim(access.shopify_user_id), '') IS NOT NULL
)
INSERT INTO public.staff_identity_aliases (
    shop_domain,
    person_id,
    alias_type,
    alias_value,
    source,
    first_seen_at,
    last_seen_at
)
SELECT
    shop_domain,
    person_id,
    'shopify_admin_user_id',
    alias_value,
    'user_location_access',
    now(),
    now()
FROM shopify_user_aliases
ON CONFLICT (shop_domain, alias_type, alias_value)
DO UPDATE SET
    person_id = COALESCE(public.staff_identity_aliases.person_id, EXCLUDED.person_id),
    source = COALESCE(public.staff_identity_aliases.source, EXCLUDED.source),
    updated_at = now();
