ALTER TABLE public.user_location_access
  ALTER COLUMN user_email DROP NOT NULL;

ALTER TABLE public.user_location_access
  DROP CONSTRAINT IF EXISTS user_location_access_shop_domain_user_email_shopify_locatio_key;

DROP INDEX IF EXISTS public.user_location_access_shop_user_location_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS user_location_access_shop_email_location_uidx
  ON public.user_location_access (shop_domain, lower(user_email), shopify_location_id)
  WHERE user_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_location_access_shop_user_id_location_uidx
  ON public.user_location_access (shop_domain, shopify_user_id, shopify_location_id)
  WHERE shopify_user_id IS NOT NULL;
