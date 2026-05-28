# COGS webhook validation

Use this checklist after deploying the inventory item cost sync changes and running the new Supabase migration.

## 1. Pick a variant

Replace the shop domain with the production shop.

```sql
select
  v.shopify_variant_id,
  v.inventory_item_id,
  v.sku,
  v.unit_cost as variant_unit_cost,
  ii.unit_cost as inventory_item_unit_cost,
  ii.cost_source,
  ii.synced_at
from public.variants v
left join public.inventory_items ii
  on ii.shop_domain = v.shop_domain
 and ii.inventory_item_id = v.inventory_item_id
where v.shop_domain = 'fh1z1f-5i.myshopify.com'
  and v.inventory_item_id is not null
order by v.updated_at desc
limit 20;
```

Record one `shopify_variant_id`, `inventory_item_id`, SKU, and current unit cost.

## 2. Record matching order lines

```sql
select
  shopify_line_item_id,
  order_name,
  created_at_shopify,
  sku,
  quantity,
  revenue,
  unit_cost,
  cogs,
  gross_profit,
  cost_source
from public.order_lines
where shop_domain = 'fh1z1f-5i.myshopify.com'
  and (
    shopify_variant_id = '<SHOPIFY_VARIANT_GID>'
    or inventory_item_id = '<INVENTORY_ITEM_GID>'
    or sku = '<SKU>'
  )
order by created_at_shopify desc
limit 20;
```

## 3. Change cost in Shopify

In Shopify Admin, edit the variant's Cost per item. Save the product or inventory item.

## 4. Confirm webhook processing

Check Render logs for `inventory_items/update`, then confirm a successful sync run:

```sql
select
  sync_type,
  status,
  source,
  started_at,
  finished_at,
  error_message,
  details
from public.sync_runs
where shop_domain = 'fh1z1f-5i.myshopify.com'
  and source = 'webhook'
  and sync_type = 'inventory'
order by started_at desc
limit 10;
```

Expected:

- `status = success`
- `details->>'webhookPayloadCostExplicit'` is `true` when Shopify sent `cost`
- `variantsUnitCostUpdated` is at least `1` for a known variant
- `orderLinesCogsRecomputed` increases when matching order lines exist

## 5. Confirm DB cost changed

Run the query from step 1 again. Expected:

- `inventory_items.unit_cost` equals the Shopify Cost per item
- `variants.unit_cost` equals the same value
- `inventory_items.cost_source` is `WEBHOOK_PAYLOAD_COST` when the webhook payload included cost, otherwise an inventory/product sync source

## 6. Confirm dashboard math changed

Run the query from step 2 again. Expected:

- `order_lines.unit_cost` equals the new cost for matching lines
- `cogs = quantity * unit_cost`
- `gross_profit = revenue - cogs`
- `cost_source = recomputed_from_current_variant_cost`

Open `/app/db-dashboard` for the same date/location filters and confirm COGS, gross profit, and gross margin reflect the new values.

## 7. Confirm fallback behavior

Find a custom/manual sale with no Shopify variant:

```sql
select
  order_name,
  shopify_line_item_id,
  revenue,
  unit_cost,
  cogs,
  gross_profit,
  cost_source
from public.order_lines
where shop_domain = 'fh1z1f-5i.myshopify.com'
  and shopify_variant_id is null
order by created_at_shopify desc
limit 20;
```

Expected:

- Custom/manual lines with revenue and no real cost keep `cost_source = FALLBACK_50_PERCENT_CUSTOM_SALE`
- Product/variant lines with no real cost use `MISSING_COST`, not the 50% fallback

## 8. Null-cost safety check

If Shopify sends no cost field, existing non-null DB cost should be preserved. If Shopify explicitly sends `"cost": null`, the matching `inventory_items`, `variants`, and `order_lines` costs should clear to null and matching order lines should show `MISSING_COST`.
