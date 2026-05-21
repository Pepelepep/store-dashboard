CREATE TABLE IF NOT EXISTS public.staff_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    shopify_staff_id text NOT NULL,
    email text,
    name text,
    first_name text,
    last_name text,
    is_active boolean,
    is_owner boolean,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT staff_members_pkey PRIMARY KEY (id),
    CONSTRAINT staff_members_shop_domain_shopify_staff_id_key UNIQUE (shop_domain, shopify_staff_id)
);

CREATE INDEX IF NOT EXISTS staff_members_shop_domain_idx
    ON public.staff_members USING btree (shop_domain);

CREATE INDEX IF NOT EXISTS staff_members_shop_domain_active_idx
    ON public.staff_members USING btree (shop_domain, is_active);

ALTER TABLE public.order_lines
    ADD COLUMN IF NOT EXISTS staff_member_id text,
    ADD COLUMN IF NOT EXISTS staff_member_name text,
    ADD COLUMN IF NOT EXISTS staff_member_email text,
    ADD COLUMN IF NOT EXISTS staff_source text;

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS staff_member_id text,
    ADD COLUMN IF NOT EXISTS staff_member_name text,
    ADD COLUMN IF NOT EXISTS staff_member_email text,
    ADD COLUMN IF NOT EXISTS staff_source text;
