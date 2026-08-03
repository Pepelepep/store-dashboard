CREATE TABLE IF NOT EXISTS public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_domain text NOT NULL,
    inventory_item_id text NOT NULL,
    sku text,
    tracked boolean,
    unit_cost numeric,
    cost_source text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inventory_items_pkey PRIMARY KEY (id),
    CONSTRAINT inventory_items_shop_domain_inventory_item_id_key UNIQUE (shop_domain, inventory_item_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_shop_inventory_item_uidx
    ON public.inventory_items USING btree (shop_domain, inventory_item_id);

CREATE INDEX IF NOT EXISTS variants_shop_inventory_item_idx
    ON public.variants USING btree (shop_domain, inventory_item_id);
