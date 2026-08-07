-- Adds 100 synthetic demo orders (spread over the last 30 days, with full
-- POS-session staff attribution, discounts, and partial refunds/returns) on
-- top of whatever real, already-synced Shopify data exists for demo_shop.
--
-- This script does NOT create locations, products, variants, inventory,
-- fixed expenses, sync_runs, or user_location_access/dashboard_memberships.
-- shopops-demo.myshopify.com is a real, actively-installed Shopify store with
-- its own real synced catalog, real order history, real sync jobs, and real
-- canonical access (owner + a Laval-scoped viewer) already correctly set up
-- via the app itself -- none of that should be fabricated or overwritten by
-- a seed script. Re-running this script is safe: it only ever deletes/
-- recreates the synthetic orders it created itself (identified by the
-- 'gid://shopify/Order/97501...' id prefix), never real data.

begin;

do $$
declare
  demo_shop text := 'shopops-demo.myshopify.com';
  v_location_count int;
  v_variant_count int;
  v_staff_names text[] := array[
    'Alex Tremblay', 'Jamie Roy', 'Sam Ouellet', 'Chloe Bernier',
    'Marc-Andre Gagnon', 'Priya Nair', 'Morgan Lee', 'Taylor Singh',
    'Robin Cote', 'Casey Fortin', 'Jordan Belanger', 'Avery Boucher'
  ];
  v_staff_emails text[] := array[
    'alex.tremblay@demo-shopops.test', 'jamie.roy@demo-shopops.test',
    'sam.ouellet@demo-shopops.test', 'chloe.bernier@demo-shopops.test',
    'marc-andre.gagnon@demo-shopops.test', 'priya.nair@demo-shopops.test',
    'morgan.lee@demo-shopops.test', 'taylor.singh@demo-shopops.test',
    'robin.cote@demo-shopops.test', 'casey.fortin@demo-shopops.test',
    'jordan.belanger@demo-shopops.test', 'avery.boucher@demo-shopops.test'
  ];
  v_name_idx int := 1;
  v_order_seq int;
  v_order_id text;
  v_order_name text;
  v_line_item_seq int := 0;
  v_loc record;
  v_staff record;
  v_order_ts timestamptz;
  v_line_count int;
  v_line_idx int;
  v_variant record;
  v_qty int;
  v_is_discounted boolean;
  v_is_refunded boolean;
  v_discount_pct numeric;
  v_line_gross numeric;
  v_line_discount numeric;
  v_returned_qty int;
  v_refund_amount numeric;
begin
  -- Only ever touch the synthetic orders this script created previously.
  delete from public.order_transactions
    where shop_domain = demo_shop and shopify_order_id like 'gid://shopify/Order/97501%';
  delete from public.order_lines
    where shop_domain = demo_shop and shopify_order_id like 'gid://shopify/Order/97501%';
  delete from public.orders
    where shop_domain = demo_shop and shopify_order_id like 'gid://shopify/Order/97501%';

  create temporary table tmp_locations (
    idx int primary key,
    location_id text,
    location_name text
  ) on commit drop;

  insert into tmp_locations (idx, location_id, location_name)
  select row_number() over (order by shopify_location_id)::int - 1, shopify_location_id, name
  from public.locations
  where shop_domain = demo_shop
    and shopify_is_active = true
    and reporting_enabled = true;

  select count(*) into v_location_count from tmp_locations;

  create temporary table tmp_variants (
    idx int primary key,
    variant_id text,
    inventory_item_id text,
    product_title text,
    variant_title text,
    sku text,
    vendor text,
    price numeric,
    unit_cost numeric,
    cost_source text
  ) on commit drop;

  insert into tmp_variants (idx, variant_id, inventory_item_id, product_title, variant_title, sku, vendor, price, unit_cost, cost_source)
  select
    row_number() over (order by v.shopify_variant_id)::int,
    v.shopify_variant_id, v.inventory_item_id, p.title, v.title, v.sku, p.vendor, v.price, v.unit_cost,
    case when v.unit_cost is null then 'MISSING_COST' else 'SHOPIFY_UNIT_COST' end
  from public.variants v
  join public.products p
    on p.shopify_product_id = v.shopify_product_id and p.shop_domain = v.shop_domain
  where v.shop_domain = demo_shop
    and v.price is not null
    and v.inventory_item_id is not null
  order by v.shopify_variant_id
  limit 30;

  select count(*) into v_variant_count from tmp_variants;

  if v_location_count = 0 or v_variant_count = 0 then
    raise exception 'No reporting-enabled locations (%) or priced variants (%) found for %; sync the shop before running this seed.',
      v_location_count, v_variant_count, demo_shop;
  end if;

  -- Two synthetic staff members per real location, standing in for
  -- POS-session attribution (staff never cross locations).
  create temporary table tmp_staff (
    location_idx int,
    staff_slot int,
    staff_name text,
    staff_email text,
    primary key (location_idx, staff_slot)
  ) on commit drop;

  for i in 0..(v_location_count - 1) loop
    for s in 0..1 loop
      insert into tmp_staff (location_idx, staff_slot, staff_name, staff_email)
      values (i, s, v_staff_names[v_name_idx], v_staff_emails[v_name_idx]);
      v_name_idx := v_name_idx + 1;
    end loop;
  end loop;

  -- Generate 100 orders spread over the last 30 days, each with full staff
  -- attribution, so Sales by Staff / by Location / by Vendor all have real
  -- volume instead of a couple of hand-written examples. ~1 in 7 orders gets
  -- a discount; ~1 in 11 gets a partial refund/return with a matching
  -- order_transactions row. Order-level financial totals are rolled up from
  -- the order_lines just inserted, so orders and order_lines always agree
  -- (avoids tripping the Financial QA order/line reconciliation checks).
  for v_order_seq in 1..100 loop
    v_order_id := 'gid://shopify/Order/97501' || lpad(v_order_seq::text, 5, '0');
    v_order_name := '#DM' || lpad(v_order_seq::text, 4, '0');

    select * into v_loc from tmp_locations where idx = (v_order_seq % v_location_count);
    select * into v_staff from tmp_staff
      where location_idx = (v_order_seq % v_location_count) and staff_slot = (v_order_seq % 2);

    v_order_ts := (current_date - (v_order_seq % 30))
      + time '09:00'
      + (((v_order_seq * 47) % 540) * interval '1 minute');

    v_line_count := least(3, 1 + (v_order_seq % 4));
    v_is_discounted := (v_order_seq % 7 = 0);
    v_is_refunded := (v_order_seq % 11 = 0);
    v_discount_pct := case when v_is_discounted then (10 + (v_order_seq % 3) * 5) else 0 end;

    for v_line_idx in 1..v_line_count loop
      v_line_item_seq := v_line_item_seq + 1;
      select * into v_variant from tmp_variants
        where idx = 1 + ((v_order_seq * 3 + v_line_idx) % v_variant_count);
      v_qty := 1 + ((v_order_seq + v_line_idx) % 3);
      v_line_gross := round(v_qty * v_variant.price, 2);
      v_line_discount := round(v_line_gross * v_discount_pct / 100.0, 2);
      v_returned_qty := case
        when v_is_refunded and v_line_idx = 1 then greatest(1, v_qty / 2)
        else null
      end;
      v_refund_amount := case
        when v_returned_qty is not null then round(v_variant.price * v_returned_qty, 2)
        else null
      end;

      insert into public.order_lines (
        shop_domain, shopify_order_id, shopify_line_item_id, order_name, created_at_shopify,
        retail_location_id, retail_location_name, shopify_variant_id, inventory_item_id,
        product_title, variant_title, sku, vendor, quantity, unit_price, revenue,
        unit_cost, cogs, gross_profit, cost_source,
        gross_sales, discounts, discount_amount, net_sales,
        returned_quantity, refunded_amount, returns,
        staff_member_name, staff_member_email, staff_source, created_at
      ) values (
        demo_shop, v_order_id, 'gid://shopify/LineItem/9865' || lpad(v_line_item_seq::text, 6, '0'),
        v_order_name, v_order_ts,
        v_loc.location_id, v_loc.location_name, v_variant.variant_id, v_variant.inventory_item_id,
        v_variant.product_title, v_variant.variant_title, v_variant.sku, v_variant.vendor,
        v_qty, v_variant.price, v_line_gross,
        v_variant.unit_cost,
        case when v_variant.unit_cost is null then null else v_qty * v_variant.unit_cost end,
        case when v_variant.unit_cost is null then null else v_line_gross - (v_qty * v_variant.unit_cost) end,
        v_variant.cost_source,
        v_line_gross, v_line_discount, v_line_discount,
        v_line_gross - v_line_discount - coalesce(v_refund_amount, 0),
        v_returned_qty, v_refund_amount, v_refund_amount,
        v_staff.staff_name, v_staff.staff_email, 'pos_session', now()
      );
    end loop;

    insert into public.orders (
      shop_domain, shopify_order_id, order_name, created_at_shopify, financial_status,
      retail_location_id, retail_location_name, total_price,
      gross_sales, discounts, returns, net_sales, refunds,
      total_discount_amount, discount_codes,
      staff_member_name, staff_member_email, staff_source,
      created_at, updated_at
    )
    select
      demo_shop, v_order_id, v_order_name, v_order_ts,
      case when v_is_refunded then 'PARTIALLY_REFUNDED' else 'PAID' end,
      v_loc.location_id, v_loc.location_name,
      sum(gross_sales) - sum(discounts),
      sum(gross_sales), sum(discounts), sum(returns), sum(net_sales), sum(refunded_amount),
      sum(discounts),
      case when v_is_discounted then ('["DEMO' || v_discount_pct::text || '"]')::jsonb else null end,
      v_staff.staff_name, v_staff.staff_email, 'pos_session',
      now(), now()
    from public.order_lines
    where shop_domain = demo_shop and shopify_order_id = v_order_id;

    if v_is_refunded then
      insert into public.order_transactions (
        shop_domain, shopify_order_id, shopify_transaction_id, kind, status, gateway,
        processed_at, amount, currency_code, created_at, updated_at
      )
      select
        demo_shop, v_order_id, 'gid://shopify/OrderTransaction/9755' || lpad(v_order_seq::text, 5, '0'),
        'refund', 'success', 'manual', v_order_ts + interval '1 day',
        sum(refunded_amount), 'CAD', now(), now()
      from public.order_lines
      where shop_domain = demo_shop and shopify_order_id = v_order_id
        and refunded_amount is not null;
    end if;
  end loop;
end $$;

commit;
