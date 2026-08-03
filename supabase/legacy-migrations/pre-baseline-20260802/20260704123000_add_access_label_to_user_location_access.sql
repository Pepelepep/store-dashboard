ALTER TABLE public.user_location_access
  ADD COLUMN IF NOT EXISTS access_label text;

DROP INDEX IF EXISTS public.user_location_access_shop_email_location_uidx;
