ALTER TABLE public.user_location_access
  ADD COLUMN IF NOT EXISTS person_id uuid
  REFERENCES public.staff_people(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_location_access_shop_person_idx
  ON public.user_location_access (shop_domain, person_id);

ALTER TABLE public.staff_identity_aliases
  ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'pending' NOT NULL;

ALTER TABLE public.staff_identity_aliases
  ADD COLUMN IF NOT EXISTS suggestion_dismissed_at timestamptz;

ALTER TABLE public.staff_identity_aliases
  DROP CONSTRAINT IF EXISTS staff_identity_aliases_review_status_check;

ALTER TABLE public.staff_identity_aliases
  ADD CONSTRAINT staff_identity_aliases_review_status_check
  CHECK (review_status IN ('pending', 'deferred', 'mapped'));

UPDATE public.staff_identity_aliases
SET review_status = 'mapped'
WHERE person_id IS NOT NULL
  AND review_status <> 'mapped';

-- Only deterministic authorization aliases are eligible for this backfill.
WITH safe_matches AS (
  SELECT
    access.id AS access_id,
    min(alias.person_id::text)::uuid AS person_id
  FROM public.user_location_access access
  JOIN public.staff_identity_aliases alias
    ON alias.shop_domain = access.shop_domain
    AND alias.person_id IS NOT NULL
    AND (
      (alias.alias_type = 'email' AND access.user_email IS NOT NULL
        AND lower(alias.alias_value) = lower(access.user_email))
      OR
      (alias.alias_type = 'shopify_admin_user_id' AND access.shopify_user_id IS NOT NULL
        AND alias.alias_value = access.shopify_user_id)
    )
  WHERE access.person_id IS NULL
  GROUP BY access.id
  HAVING count(DISTINCT alias.person_id) = 1
)
UPDATE public.user_location_access access
SET person_id = safe_matches.person_id
FROM safe_matches
WHERE access.id = safe_matches.access_id;
