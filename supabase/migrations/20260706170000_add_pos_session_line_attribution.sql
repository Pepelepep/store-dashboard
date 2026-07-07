ALTER TABLE public.order_lines
    ADD COLUMN IF NOT EXISTS shopops_staff_member_id text,
    ADD COLUMN IF NOT EXISTS shopops_user_id text,
    ADD COLUMN IF NOT EXISTS shopops_pos_location_id text,
    ADD COLUMN IF NOT EXISTS shopops_pos_device_id text,
    ADD COLUMN IF NOT EXISTS shopops_pos_device_name text,
    ADD COLUMN IF NOT EXISTS shopops_attribution_source text;

CREATE INDEX IF NOT EXISTS order_lines_shop_pos_attribution_idx
    ON public.order_lines USING btree (shop_domain, shopops_attribution_source);

CREATE INDEX IF NOT EXISTS order_lines_shop_pos_staff_idx
    ON public.order_lines USING btree (shop_domain, shopops_staff_member_id);
