-- Additive indexes for the exact filter + ordering shapes used by the
-- Marketplace Overview and Compare Locations loaders. The existing database
-- is small today, but without these indexes query cost grows as a full tenant
-- scan plus sort when order history grows.

CREATE INDEX IF NOT EXISTS order_lines_shop_created_id_idx
  ON public.order_lines (shop_domain, created_at_shopify DESC, id ASC);

CREATE INDEX IF NOT EXISTS order_lines_shop_location_created_id_idx
  ON public.order_lines (
    shop_domain,
    retail_location_id,
    created_at_shopify DESC,
    id ASC
  );

CREATE INDEX IF NOT EXISTS order_transactions_shop_processed_id_idx
  ON public.order_transactions (shop_domain, processed_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS inventory_levels_shop_location_id_idx
  ON public.inventory_levels (shop_domain, shopify_location_id, id ASC);

CREATE INDEX IF NOT EXISTS variants_shop_id_idx
  ON public.variants (shop_domain, id ASC);

CREATE INDEX IF NOT EXISTS products_shop_id_idx
  ON public.products (shop_domain, id ASC);

CREATE INDEX IF NOT EXISTS sync_runs_shop_status_finished_idx
  ON public.sync_runs (shop_domain, status, finished_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS webhook_events_shop_status_processed_idx
  ON public.webhook_events (shop_domain, status, processed_at DESC, id ASC);

ANALYZE public.order_lines;
ANALYZE public.order_transactions;
ANALYZE public.inventory_levels;
ANALYZE public.variants;
ANALYZE public.products;
ANALYZE public.sync_runs;
ANALYZE public.webhook_events;
