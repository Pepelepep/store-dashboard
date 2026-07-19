-- Prevent exact permission identities from being duplicated by concurrent
-- saves without collapsing legitimate multi-location or multi-login grants.
-- If existing duplicates are present, index creation fails for investigation;
-- this migration intentionally does not delete or rewrite permission rows.
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS marketplace_initialized_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS user_location_access_shop_email_user_location_uidx
  ON public.user_location_access (
    shop_domain,
    lower(btrim(user_email)),
    coalesce(btrim(shopify_user_id), ''),
    coalesce(btrim(shopify_location_id), '')
  )
  WHERE user_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_location_access_shop_user_location_strict_uidx
  ON public.user_location_access (
    shop_domain,
    btrim(shopify_user_id),
    coalesce(btrim(shopify_location_id), '')
  )
  WHERE shopify_user_id IS NOT NULL;
