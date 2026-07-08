ALTER TABLE public.order_lines
    ADD COLUMN IF NOT EXISTS shopops_staff_label text,
    ADD COLUMN IF NOT EXISTS shopops_attributed_user_id text;

CREATE INDEX IF NOT EXISTS order_lines_shop_pos_staff_label_idx
    ON public.order_lines USING btree (shop_domain, shopops_staff_label);

CREATE INDEX IF NOT EXISTS order_lines_shop_pos_attributed_user_idx
    ON public.order_lines USING btree (shop_domain, shopops_attributed_user_id);
