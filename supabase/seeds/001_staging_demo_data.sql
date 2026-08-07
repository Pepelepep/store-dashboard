-- Staging demo data for Shopify dashboard UI testing.
-- Uses only fake/demo data and does not touch Shopify Session rows.

begin;

do $$
declare
  demo_shop text := 'shopops-demo.myshopify.com';
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
  delete from public.user_location_access where shop_domain = demo_shop;
  delete from public.sync_runs where shop_domain = demo_shop;
  delete from public.fixed_expenses where shop_domain = demo_shop;
  delete from public.order_transactions where shop_domain = demo_shop;
  delete from public.order_lines where shop_domain = demo_shop;
  delete from public.orders where shop_domain = demo_shop;
  delete from public.inventory_levels where shop_domain = demo_shop;
  delete from public.variants where shop_domain = demo_shop;
  delete from public.products where shop_domain = demo_shop;
  delete from public.locations where shop_domain = demo_shop;

  insert into public.locations (
    shop_domain,
    shopify_location_id,
    name,
    is_active,
    city,
    province,
    country,
    created_at,
    updated_at
  )
  values
    (demo_shop, 'gid://shopify/Location/910100001', 'Downtown Montreal', true, 'Montreal', 'Quebec', 'Canada', now(), now()),
    (demo_shop, 'gid://shopify/Location/910100002', 'Vieux-Port', true, 'Montreal', 'Quebec', 'Canada', now(), now()),
    (demo_shop, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', true, 'Laval', 'Quebec', 'Canada', now(), now());

  insert into public.products (
    shop_domain,
    shopify_product_id,
    title,
    vendor,
    product_type,
    status,
    created_at,
    updated_at
  )
  values
    (demo_shop, 'gid://shopify/Product/920100001', 'Montreal Market Tote', 'Atelier Nord', 'Accessories', 'ACTIVE', now(), now()),
    (demo_shop, 'gid://shopify/Product/920100002', 'Maple Ceramic Mug', 'Studio Fleuve', 'Home', 'ACTIVE', now(), now()),
    (demo_shop, 'gid://shopify/Product/920100003', 'Wool Beanie', 'Laine Locale', 'Apparel', 'ACTIVE', now(), now()),
    (demo_shop, 'gid://shopify/Product/920100004', 'Soy Candle', 'Maison Lumiere', 'Home Fragrance', 'ACTIVE', now(), now()),
    (demo_shop, 'gid://shopify/Product/920100005', 'Linen Notebook', 'Papier Saint-Laurent', 'Stationery', 'ACTIVE', now(), now()),
    (demo_shop, 'gid://shopify/Product/920100006', 'Botanical Soap Bar', 'Savon du Port', 'Bath', 'ACTIVE', now(), now()),
    (demo_shop, 'gid://shopify/Product/920100007', 'Brass Key Ring', 'Atelier Nord', 'Accessories', 'ACTIVE', now(), now()),
    (demo_shop, 'gid://shopify/Product/920100008', 'Printed Tea Towel', 'Studio Fleuve', 'Kitchen', 'ACTIVE', now(), now());

  insert into public.variants (
    shop_domain,
    shopify_variant_id,
    shopify_product_id,
    inventory_item_id,
    title,
    sku,
    price,
    unit_cost,
    created_at,
    updated_at
  )
  values
    (demo_shop, 'gid://shopify/ProductVariant/930100001', 'gid://shopify/Product/920100001', 'gid://shopify/InventoryItem/940100001', 'Natural', 'TOTE-NAT', 38.00, 15.00, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100002', 'gid://shopify/Product/920100001', 'gid://shopify/InventoryItem/940100002', 'Black', 'TOTE-BLK', 38.00, 15.50, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100003', 'gid://shopify/Product/920100002', 'gid://shopify/InventoryItem/940100003', 'Cream', 'MUG-CRM', 24.00, 8.25, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100004', 'gid://shopify/Product/920100002', 'gid://shopify/InventoryItem/940100004', 'Blue', 'MUG-BLU', 24.00, null, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100005', 'gid://shopify/Product/920100003', 'gid://shopify/InventoryItem/940100005', 'Charcoal', 'BEAN-CHR', 42.00, 18.00, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100006', 'gid://shopify/Product/920100003', 'gid://shopify/InventoryItem/940100006', 'Forest', 'BEAN-FOR', 42.00, 18.00, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100007', 'gid://shopify/Product/920100004', 'gid://shopify/InventoryItem/940100007', 'Cedar', 'CND-CED', 32.00, 11.75, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100008', 'gid://shopify/Product/920100004', 'gid://shopify/InventoryItem/940100008', 'Lavender', 'CND-LAV', 32.00, 11.75, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100009', 'gid://shopify/Product/920100005', 'gid://shopify/InventoryItem/940100009', 'Dotted', 'NOTE-DOT', 18.00, 5.20, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100010', 'gid://shopify/Product/920100005', 'gid://shopify/InventoryItem/940100010', 'Plain', 'NOTE-PLN', 18.00, null, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100011', 'gid://shopify/Product/920100006', 'gid://shopify/InventoryItem/940100011', 'Rosemary', 'SOAP-ROS', 12.00, 3.80, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100012', 'gid://shopify/Product/920100006', 'gid://shopify/InventoryItem/940100012', 'Mint', 'SOAP-MNT', 12.00, 3.80, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100013', 'gid://shopify/Product/920100007', 'gid://shopify/InventoryItem/940100013', 'Brass', 'KEY-BRS', 22.00, 7.50, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100014', 'gid://shopify/Product/920100008', 'gid://shopify/InventoryItem/940100014', 'Tomato', 'TOWL-TOM', 28.00, null, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100015', 'gid://shopify/Product/920100008', 'gid://shopify/InventoryItem/940100015', 'Blueberry', 'TOWL-BLU', 28.00, 9.00, now(), now());

  insert into public.inventory_levels (
    shop_domain,
    shopify_location_id,
    shopify_variant_id,
    inventory_item_id,
    sku,
    available,
    tracked,
    synced_at
  )
  select
    demo_shop,
    location_id,
    variant_id,
    item_id,
    sku,
    available,
    true,
    now()
  from (
    values
      ('gid://shopify/Location/910100001', 'gid://shopify/ProductVariant/930100001', 'gid://shopify/InventoryItem/940100001', 'TOTE-NAT', 18),
      ('gid://shopify/Location/910100001', 'gid://shopify/ProductVariant/930100002', 'gid://shopify/InventoryItem/940100002', 'TOTE-BLK', 4),
      ('gid://shopify/Location/910100001', 'gid://shopify/ProductVariant/930100003', 'gid://shopify/InventoryItem/940100003', 'MUG-CRM', 2),
      ('gid://shopify/Location/910100001', 'gid://shopify/ProductVariant/930100004', 'gid://shopify/InventoryItem/940100004', 'MUG-BLU', 0),
      ('gid://shopify/Location/910100001', 'gid://shopify/ProductVariant/930100005', 'gid://shopify/InventoryItem/940100005', 'BEAN-CHR', 9),
      ('gid://shopify/Location/910100001', 'gid://shopify/ProductVariant/930100007', 'gid://shopify/InventoryItem/940100007', 'CND-CED', 1),
      ('gid://shopify/Location/910100002', 'gid://shopify/ProductVariant/930100001', 'gid://shopify/InventoryItem/940100001', 'TOTE-NAT', 7),
      ('gid://shopify/Location/910100002', 'gid://shopify/ProductVariant/930100006', 'gid://shopify/InventoryItem/940100006', 'BEAN-FOR', 3),
      ('gid://shopify/Location/910100002', 'gid://shopify/ProductVariant/930100008', 'gid://shopify/InventoryItem/940100008', 'CND-LAV', 14),
      ('gid://shopify/Location/910100002', 'gid://shopify/ProductVariant/930100009', 'gid://shopify/InventoryItem/940100009', 'NOTE-DOT', 21),
      ('gid://shopify/Location/910100002', 'gid://shopify/ProductVariant/930100010', 'gid://shopify/InventoryItem/940100010', 'NOTE-PLN', 0),
      ('gid://shopify/Location/910100002', 'gid://shopify/ProductVariant/930100011', 'gid://shopify/InventoryItem/940100011', 'SOAP-ROS', 5),
      ('gid://shopify/Location/910100003', 'gid://shopify/ProductVariant/930100002', 'gid://shopify/InventoryItem/940100002', 'TOTE-BLK', 11),
      ('gid://shopify/Location/910100003', 'gid://shopify/ProductVariant/930100003', 'gid://shopify/InventoryItem/940100003', 'MUG-CRM', 8),
      ('gid://shopify/Location/910100003', 'gid://shopify/ProductVariant/930100012', 'gid://shopify/InventoryItem/940100012', 'SOAP-MNT', 18),
      ('gid://shopify/Location/910100003', 'gid://shopify/ProductVariant/930100013', 'gid://shopify/InventoryItem/940100013', 'KEY-BRS', 2),
      ('gid://shopify/Location/910100003', 'gid://shopify/ProductVariant/930100014', 'gid://shopify/InventoryItem/940100014', 'TOWL-TOM', 0),
      ('gid://shopify/Location/910100003', 'gid://shopify/ProductVariant/930100015', 'gid://shopify/InventoryItem/940100015', 'TOWL-BLU', 6)
  ) as stock(location_id, variant_id, item_id, sku, available);

  -- Reference data for the generated order set below.
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
  values
    (1, 'gid://shopify/ProductVariant/930100001', 'gid://shopify/InventoryItem/940100001', 'Montreal Market Tote', 'Natural', 'TOTE-NAT', 'Atelier Nord', 38.00, 15.00, 'SHOPIFY_UNIT_COST'),
    (2, 'gid://shopify/ProductVariant/930100002', 'gid://shopify/InventoryItem/940100002', 'Montreal Market Tote', 'Black', 'TOTE-BLK', 'Atelier Nord', 38.00, 15.50, 'SHOPIFY_UNIT_COST'),
    (3, 'gid://shopify/ProductVariant/930100003', 'gid://shopify/InventoryItem/940100003', 'Maple Ceramic Mug', 'Cream', 'MUG-CRM', 'Studio Fleuve', 24.00, 8.25, 'SHOPIFY_UNIT_COST'),
    (4, 'gid://shopify/ProductVariant/930100004', 'gid://shopify/InventoryItem/940100004', 'Maple Ceramic Mug', 'Blue', 'MUG-BLU', 'Studio Fleuve', 24.00, null, 'MISSING_COST'),
    (5, 'gid://shopify/ProductVariant/930100005', 'gid://shopify/InventoryItem/940100005', 'Wool Beanie', 'Charcoal', 'BEAN-CHR', 'Laine Locale', 42.00, 18.00, 'SHOPIFY_UNIT_COST'),
    (6, 'gid://shopify/ProductVariant/930100006', 'gid://shopify/InventoryItem/940100006', 'Wool Beanie', 'Forest', 'BEAN-FOR', 'Laine Locale', 42.00, 18.00, 'SHOPIFY_UNIT_COST'),
    (7, 'gid://shopify/ProductVariant/930100007', 'gid://shopify/InventoryItem/940100007', 'Soy Candle', 'Cedar', 'CND-CED', 'Maison Lumiere', 32.00, 11.75, 'recomputed_from_current_variant_cost'),
    (8, 'gid://shopify/ProductVariant/930100008', 'gid://shopify/InventoryItem/940100008', 'Soy Candle', 'Lavender', 'CND-LAV', 'Maison Lumiere', 32.00, 11.75, 'recomputed_from_current_variant_cost'),
    (9, 'gid://shopify/ProductVariant/930100009', 'gid://shopify/InventoryItem/940100009', 'Linen Notebook', 'Dotted', 'NOTE-DOT', 'Papier Saint-Laurent', 18.00, 5.20, 'SHOPIFY_UNIT_COST'),
    (10, 'gid://shopify/ProductVariant/930100010', 'gid://shopify/InventoryItem/940100010', 'Linen Notebook', 'Plain', 'NOTE-PLN', 'Papier Saint-Laurent', 18.00, null, 'MISSING_COST'),
    (11, 'gid://shopify/ProductVariant/930100011', 'gid://shopify/InventoryItem/940100011', 'Botanical Soap Bar', 'Rosemary', 'SOAP-ROS', 'Savon du Port', 12.00, 3.80, 'SHOPIFY_UNIT_COST'),
    (12, 'gid://shopify/ProductVariant/930100012', 'gid://shopify/InventoryItem/940100012', 'Botanical Soap Bar', 'Mint', 'SOAP-MNT', 'Savon du Port', 12.00, 3.80, 'SHOPIFY_UNIT_COST'),
    (13, 'gid://shopify/ProductVariant/930100013', 'gid://shopify/InventoryItem/940100013', 'Brass Key Ring', 'Brass', 'KEY-BRS', 'Atelier Nord', 22.00, 7.50, 'recomputed_from_current_variant_cost'),
    (14, 'gid://shopify/ProductVariant/930100014', 'gid://shopify/InventoryItem/940100014', 'Printed Tea Towel', 'Tomato', 'TOWL-TOM', 'Studio Fleuve', 28.00, null, 'MISSING_COST'),
    (15, 'gid://shopify/ProductVariant/930100015', 'gid://shopify/InventoryItem/940100015', 'Printed Tea Towel', 'Blueberry', 'TOWL-BLU', 'Studio Fleuve', 28.00, 9.00, 'recomputed_from_current_variant_cost');

  create temporary table tmp_locations (
    idx int primary key,
    location_id text,
    location_name text
  ) on commit drop;

  insert into tmp_locations (idx, location_id, location_name)
  values
    (0, 'gid://shopify/Location/910100001', 'Downtown Montreal'),
    (1, 'gid://shopify/Location/910100002', 'Vieux-Port'),
    (2, 'gid://shopify/Location/910100003', 'CF Carrefour Laval');

  -- Two staff members per location, standing in for POS session attribution.
  create temporary table tmp_staff (
    location_idx int,
    staff_slot int,
    staff_name text,
    staff_email text,
    primary key (location_idx, staff_slot)
  ) on commit drop;

  insert into tmp_staff (location_idx, staff_slot, staff_name, staff_email)
  values
    (0, 0, 'Alex Tremblay', 'alex.tremblay@demo-shopops.test'),
    (0, 1, 'Jamie Roy', 'jamie.roy@demo-shopops.test'),
    (1, 0, 'Sam Ouellet', 'sam.ouellet@demo-shopops.test'),
    (1, 1, 'Chloe Bernier', 'chloe.bernier@demo-shopops.test'),
    (2, 0, 'Marc-Andre Gagnon', 'marc-andre.gagnon@demo-shopops.test'),
    (2, 1, 'Priya Nair', 'priya.nair@demo-shopops.test');

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

    select * into v_loc from tmp_locations where idx = (v_order_seq % 3);
    select * into v_staff from tmp_staff
      where location_idx = (v_order_seq % 3) and staff_slot = (v_order_seq % 2);

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
        where idx = 1 + ((v_order_seq * 3 + v_line_idx) % 15);
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

  insert into public.fixed_expenses (
    shop_domain,
    shopify_location_id,
    location_name,
    expense_name,
    expense_category,
    monthly_amount,
    start_month,
    end_month,
    is_active,
    created_at,
    updated_at
  )
  values
    (demo_shop, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'Rent', 'Occupancy', 6200.00, date_trunc('month', current_date)::date, null, true, now(), now()),
    (demo_shop, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'Local staff coverage', 'Payroll', 8400.00, date_trunc('month', current_date)::date, null, true, now(), now()),
    (demo_shop, 'gid://shopify/Location/910100002', 'Vieux-Port', 'Rent', 'Occupancy', 5100.00, date_trunc('month', current_date)::date, null, true, now(), now()),
    (demo_shop, 'gid://shopify/Location/910100002', 'Vieux-Port', 'Local staff coverage', 'Payroll', 6900.00, date_trunc('month', current_date)::date, null, true, now(), now()),
    (demo_shop, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'Rent', 'Occupancy', 7300.00, date_trunc('month', current_date)::date, null, true, now(), now()),
    (demo_shop, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'Local staff coverage', 'Payroll', 7600.00, date_trunc('month', current_date)::date, null, true, now(), now()),
    (demo_shop, null, null, 'Dashboard software', 'Software', 240.00, date_trunc('month', current_date)::date, null, true, now(), now());

  insert into public.sync_runs (
    shop_domain,
    sync_type,
    status,
    started_at,
    finished_at,
    error_message,
    source,
    details
  )
  values
    (demo_shop, 'locations', 'success', now() - interval '35 minutes', now() - interval '34 minutes', null, 'demo_seed', '{"syncedCount": 3}'::jsonb),
    (demo_shop, 'products', 'success', now() - interval '33 minutes', now() - interval '31 minutes', null, 'demo_seed', '{"productsSynced": 8, "variantsSynced": 15, "variantsWithUnitCostSynced": 11, "variantsWithMissingUnitCost": 3, "orderLinesCogsRecomputed": 12}'::jsonb),
    (demo_shop, 'inventory', 'success', now() - interval '30 minutes', now() - interval '29 minutes', null, 'demo_seed', '{"inventoryItemsProcessed": 15, "inventoryLevelsSynced": 18, "variantsUnitCostUpdated": 11, "orderLinesCogsRecomputed": 8}'::jsonb);

  insert into public.sync_runs (
    shop_domain,
    sync_type,
    status,
    started_at,
    finished_at,
    error_message,
    source,
    details
  )
  select
    demo_shop, 'orders', 'success', now() - interval '28 minutes', now() - interval '25 minutes', null, 'demo_seed',
    jsonb_build_object(
      'ordersSynced', (select count(*) from public.orders where shop_domain = demo_shop),
      'orderLinesSynced', (select count(*) from public.order_lines where shop_domain = demo_shop),
      'pagesProcessed', 1,
      'startDate', 'demo',
      'endDate', 'demo'
    );

  insert into public.user_location_access (
    shop_domain,
    user_email,
    shopify_user_id,
    shopify_location_id,
    location_name,
    role,
    can_view,
    can_manage,
    created_at
  )
  values
    (
      demo_shop,
      'pierre.paul.quilichini@gmail.com',
      '99775414464',
      '*',
      'All locations',
      'admin',
      true,
      true,
      now()
    ),
    (
      demo_shop,
      'pierre.paul.quilichini@outlook.fr',
      null,
      'gid://shopify/Location/910100003',
      'CF Carrefour Laval',
      'viewer',
      true,
      false,
      now()
    );
end $$;

commit;