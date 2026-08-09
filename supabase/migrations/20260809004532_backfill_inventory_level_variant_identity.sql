-- Older inventory syncs stored '-' when Shopify did not return a variant id
-- alongside an inventory level. inventory_item_id is the stable relationship
-- used by the current sync, so repair those historical rows from variants.
UPDATE public.inventory_levels AS inventory_level
SET
  shopify_variant_id = variant.shopify_variant_id,
  sku = COALESCE(inventory_level.sku, variant.sku),
  synced_at = now()
FROM public.variants AS variant
WHERE variant.shop_domain = inventory_level.shop_domain
  AND variant.inventory_item_id = inventory_level.inventory_item_id
  AND NULLIF(BTRIM(variant.shopify_variant_id), '') IS NOT NULL
  AND (
    NULLIF(BTRIM(inventory_level.shopify_variant_id), '') IS NULL
    OR inventory_level.shopify_variant_id = '-'
  );
