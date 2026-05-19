-- Staging demo data for Shopify dashboard UI testing.
-- Uses only fake/demo data and does not touch Shopify Session rows.

begin;

do $$
declare
  demo_shop text := 'seulementlocaldev.myshopify.com';
begin
  delete from public.user_location_access where shop_domain = demo_shop;
  delete from public.sync_runs where shop_domain = demo_shop;
  delete from public.fixed_expenses where shop_domain = demo_shop;
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
    (demo_shop, 'gid://shopify/ProductVariant/930100007', 'gid://shopify/Product/920100004', 'Cedar', 'CND-CED', 32.00, 11.75, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100008', 'gid://shopify/Product/920100004', 'Lavender', 'CND-LAV', 32.00, 11.75, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100009', 'gid://shopify/Product/920100005', 'Dotted', 'NOTE-DOT', 18.00, 5.20, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100010', 'gid://shopify/Product/920100005', 'Plain', 'NOTE-PLN', 18.00, null, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100011', 'gid://shopify/Product/920100006', 'Rosemary', 'SOAP-ROS', 12.00, 3.80, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100012', 'gid://shopify/Product/920100006', 'Mint', 'SOAP-MNT', 12.00, 3.80, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100013', 'gid://shopify/Product/920100007', 'Brass', 'KEY-BRS', 22.00, 7.50, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100014', 'gid://shopify/Product/920100008', 'Tomato', 'TOWL-TOM', 28.00, null, now(), now()),
    (demo_shop, 'gid://shopify/ProductVariant/930100015', 'gid://shopify/Product/920100008', 'Blueberry', 'TOWL-BLU', 28.00, 9.00, now(), now());

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

  insert into public.orders (
    shop_domain,
    shopify_order_id,
    order_name,
    created_at_shopify,
    financial_status,
    retail_location_id,
    retail_location_name,
    total_price,
    created_at,
    updated_at
  )
  select
    demo_shop,
    'gid://shopify/Order/' || order_number,
    '#' || display_number,
    current_date - age_days + time '14:00',
    'PAID',
    location_id,
    location_name,
    total_price,
    now(),
    now()
  from (
    values
      ('950100001', 'D1001', 0, 'gid://shopify/Location/910100001', 'Downtown Montreal', 100.00),
      ('950100002', 'D1002', 0, 'gid://shopify/Location/910100002', 'Vieux-Port', 88.00),
      ('950100003', 'D1003', 1, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 118.00),
      ('950100004', 'D1004', 1, 'gid://shopify/Location/910100001', 'Downtown Montreal', 74.00),
      ('950100005', 'D1005', 2, 'gid://shopify/Location/910100002', 'Vieux-Port', 96.00),
      ('950100006', 'D1006', 3, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 62.00),
      ('950100007', 'D1007', 4, 'gid://shopify/Location/910100001', 'Downtown Montreal', 102.00),
      ('950100008', 'D1008', 5, 'gid://shopify/Location/910100002', 'Vieux-Port', 66.00),
      ('950100009', 'D1009', 6, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 84.00),
      ('950100010', 'D1010', 7, 'gid://shopify/Location/910100001', 'Downtown Montreal', 110.00),
      ('950100011', 'D1011', 8, 'gid://shopify/Location/910100002', 'Vieux-Port', 78.00),
      ('950100012', 'D1012', 9, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 90.00)
  ) as demo_orders(order_number, display_number, age_days, location_id, location_name, total_price);

  insert into public.order_lines (
    shop_domain,
    shopify_order_id,
    shopify_line_item_id,
    order_name,
    created_at_shopify,
    retail_location_id,
    retail_location_name,
    shopify_variant_id,
    inventory_item_id,
    product_title,
    variant_title,
    sku,
    vendor,
    quantity,
    unit_price,
    revenue,
    unit_cost,
    cogs,
    gross_profit,
    cost_source,
    created_at
  )
  select
    demo_shop,
    'gid://shopify/Order/' || order_number,
    'gid://shopify/LineItem/' || line_number,
    '#' || display_number,
    current_date - age_days + time '14:00',
    location_id,
    location_name,
    variant_id,
    inventory_item_id,
    product_title,
    variant_title,
    sku,
    vendor,
    quantity,
    unit_price,
    quantity * unit_price,
    unit_cost,
    case when unit_cost is null then null else quantity * unit_cost end,
    case when unit_cost is null then null else (quantity * unit_price) - (quantity * unit_cost) end,
    cost_source,
    now()
  from (
    values
      ('950100001', 'D1001', '960100001', 0, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100001', 'gid://shopify/InventoryItem/940100001', 'Montreal Market Tote', 'Natural', 'TOTE-NAT', 'Atelier Nord', 1, 38.00, 15.00, 'SHOPIFY_UNIT_COST'),
      ('950100001', 'D1001', '960100002', 0, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100003', 'gid://shopify/InventoryItem/940100003', 'Maple Ceramic Mug', 'Cream', 'MUG-CRM', 'Studio Fleuve', 2, 24.00, 8.25, 'recomputed_from_current_variant_cost'),
      ('950100001', 'D1001', '960100003', 0, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100011', 'gid://shopify/InventoryItem/940100011', 'Botanical Soap Bar', 'Rosemary', 'SOAP-ROS', 'Savon du Port', 1, 12.00, 3.80, 'SHOPIFY_UNIT_COST'),

      ('950100002', 'D1002', '960100004', 0, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100006', 'gid://shopify/InventoryItem/940100006', 'Wool Beanie', 'Forest', 'BEAN-FOR', 'Laine Locale', 1, 42.00, 18.00, 'SHOPIFY_UNIT_COST'),
      ('950100002', 'D1002', '960100005', 0, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100008', 'gid://shopify/InventoryItem/940100008', 'Soy Candle', 'Lavender', 'CND-LAV', 'Maison Lumiere', 1, 32.00, 11.75, 'recomputed_from_current_variant_cost'),
      ('950100002', 'D1002', '960100006', 0, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100014', 'gid://shopify/InventoryItem/940100014', 'Printed Tea Towel', 'Tomato', 'TOWL-TOM', 'Studio Fleuve', 1, 28.00, null, 'MISSING_COST'),

      ('950100003', 'D1003', '960100007', 1, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100002', 'gid://shopify/InventoryItem/940100002', 'Montreal Market Tote', 'Black', 'TOTE-BLK', 'Atelier Nord', 2, 38.00, 15.50, 'SHOPIFY_UNIT_COST'),
      ('950100003', 'D1003', '960100008', 1, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100012', 'gid://shopify/InventoryItem/940100012', 'Botanical Soap Bar', 'Mint', 'SOAP-MNT', 'Savon du Port', 1, 12.00, 3.80, 'SHOPIFY_UNIT_COST'),
      ('950100003', 'D1003', '960100009', 1, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100015', 'gid://shopify/InventoryItem/940100015', 'Printed Tea Towel', 'Blueberry', 'TOWL-BLU', 'Studio Fleuve', 1, 28.00, 9.00, 'recomputed_from_current_variant_cost'),

      ('950100004', 'D1004', '960100010', 1, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100005', 'gid://shopify/InventoryItem/940100005', 'Wool Beanie', 'Charcoal', 'BEAN-CHR', 'Laine Locale', 1, 42.00, 18.00, 'SHOPIFY_UNIT_COST'),
      ('950100004', 'D1004', '960100011', 1, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100004', 'gid://shopify/InventoryItem/940100004', 'Maple Ceramic Mug', 'Blue', 'MUG-BLU', 'Studio Fleuve', 1, 24.00, null, 'MISSING_COST'),
      ('950100004', 'D1004', '960100012', 1, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100009', 'gid://shopify/InventoryItem/940100009', 'Linen Notebook', 'Dotted', 'NOTE-DOT', 'Papier Saint-Laurent', 1, 18.00, 5.20, 'SHOPIFY_UNIT_COST'),

      ('950100005', 'D1005', '960100013', 2, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100007', 'gid://shopify/InventoryItem/940100007', 'Soy Candle', 'Cedar', 'CND-CED', 'Maison Lumiere', 3, 32.00, 11.75, 'recomputed_from_current_variant_cost'),
      ('950100005', 'D1005', '960100014', 2, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100010', 'gid://shopify/InventoryItem/940100010', 'Linen Notebook', 'Plain', 'NOTE-PLN', 'Papier Saint-Laurent', 1, 18.00, null, 'MISSING_COST'),
      ('950100005', 'D1005', '960100015', 2, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100011', 'gid://shopify/InventoryItem/940100011', 'Botanical Soap Bar', 'Rosemary', 'SOAP-ROS', 'Savon du Port', 1, 12.00, 3.80, 'SHOPIFY_UNIT_COST'),

      ('950100006', 'D1006', '960100016', 3, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100013', 'gid://shopify/InventoryItem/940100013', 'Brass Key Ring', 'Brass', 'KEY-BRS', 'Atelier Nord', 1, 22.00, 7.50, 'SHOPIFY_UNIT_COST'),
      ('950100006', 'D1006', '960100017', 3, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100003', 'gid://shopify/InventoryItem/940100003', 'Maple Ceramic Mug', 'Cream', 'MUG-CRM', 'Studio Fleuve', 1, 24.00, 8.25, 'recomputed_from_current_variant_cost'),
      ('950100006', 'D1006', '960100018', 3, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100012', 'gid://shopify/InventoryItem/940100012', 'Botanical Soap Bar', 'Mint', 'SOAP-MNT', 'Savon du Port', 2, 12.00, 3.80, 'SHOPIFY_UNIT_COST'),

      ('950100007', 'D1007', '960100019', 4, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100001', 'gid://shopify/InventoryItem/940100001', 'Montreal Market Tote', 'Natural', 'TOTE-NAT', 'Atelier Nord', 1, 38.00, 15.00, 'SHOPIFY_UNIT_COST'),
      ('950100007', 'D1007', '960100020', 4, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100005', 'gid://shopify/InventoryItem/940100005', 'Wool Beanie', 'Charcoal', 'BEAN-CHR', 'Laine Locale', 1, 42.00, 18.00, 'SHOPIFY_UNIT_COST'),
      ('950100007', 'D1007', '960100021', 4, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100013', 'gid://shopify/InventoryItem/940100013', 'Brass Key Ring', 'Brass', 'KEY-BRS', 'Atelier Nord', 1, 22.00, 7.50, 'recomputed_from_current_variant_cost'),

      ('950100008', 'D1008', '960100022', 5, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100008', 'gid://shopify/InventoryItem/940100008', 'Soy Candle', 'Lavender', 'CND-LAV', 'Maison Lumiere', 1, 32.00, 11.75, 'SHOPIFY_UNIT_COST'),
      ('950100008', 'D1008', '960100023', 5, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100009', 'gid://shopify/InventoryItem/940100009', 'Linen Notebook', 'Dotted', 'NOTE-DOT', 'Papier Saint-Laurent', 1, 18.00, 5.20, 'SHOPIFY_UNIT_COST'),
      ('950100008', 'D1008', '960100024', 5, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100014', 'gid://shopify/InventoryItem/940100014', 'Printed Tea Towel', 'Tomato', 'TOWL-TOM', 'Studio Fleuve', 1, 28.00, null, 'MISSING_COST'),

      ('950100009', 'D1009', '960100025', 6, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100002', 'gid://shopify/InventoryItem/940100002', 'Montreal Market Tote', 'Black', 'TOTE-BLK', 'Atelier Nord', 1, 38.00, 15.50, 'SHOPIFY_UNIT_COST'),
      ('950100009', 'D1009', '960100026', 6, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100015', 'gid://shopify/InventoryItem/940100015', 'Printed Tea Towel', 'Blueberry', 'TOWL-BLU', 'Studio Fleuve', 1, 28.00, 9.00, 'recomputed_from_current_variant_cost'),
      ('950100009', 'D1009', '960100027', 6, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100012', 'gid://shopify/InventoryItem/940100012', 'Botanical Soap Bar', 'Mint', 'SOAP-MNT', 'Savon du Port', 1, 12.00, 3.80, 'SHOPIFY_UNIT_COST'),

      ('950100010', 'D1010', '960100028', 7, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100001', 'gid://shopify/InventoryItem/940100001', 'Montreal Market Tote', 'Natural', 'TOTE-NAT', 'Atelier Nord', 2, 38.00, 15.00, 'SHOPIFY_UNIT_COST'),
      ('950100010', 'D1010', '960100029', 7, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100011', 'gid://shopify/InventoryItem/940100011', 'Botanical Soap Bar', 'Rosemary', 'SOAP-ROS', 'Savon du Port', 1, 12.00, 3.80, 'SHOPIFY_UNIT_COST'),
      ('950100010', 'D1010', '960100030', 7, 'gid://shopify/Location/910100001', 'Downtown Montreal', 'gid://shopify/ProductVariant/930100007', 'gid://shopify/InventoryItem/940100007', 'Soy Candle', 'Cedar', 'CND-CED', 'Maison Lumiere', 1, 32.00, 11.75, 'recomputed_from_current_variant_cost'),

      ('950100011', 'D1011', '960100031', 8, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100006', 'gid://shopify/InventoryItem/940100006', 'Wool Beanie', 'Forest', 'BEAN-FOR', 'Laine Locale', 1, 42.00, 18.00, 'SHOPIFY_UNIT_COST'),
      ('950100011', 'D1011', '960100032', 8, 'gid://shopify/Location/910100002', 'Vieux-Port', 'gid://shopify/ProductVariant/930100010', 'gid://shopify/InventoryItem/940100010', 'Linen Notebook', 'Plain', 'NOTE-PLN', 'Papier Saint-Laurent', 2, 18.00, null, 'MISSING_COST'),

      ('950100012', 'D1012', '960100033', 9, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100003', 'gid://shopify/InventoryItem/940100003', 'Maple Ceramic Mug', 'Cream', 'MUG-CRM', 'Studio Fleuve', 1, 24.00, 8.25, 'SHOPIFY_UNIT_COST'),
      ('950100012', 'D1012', '960100034', 9, 'gid://shopify/Location/910100003', 'CF Carrefour Laval', 'gid://shopify/ProductVariant/930100013', 'gid://shopify/InventoryItem/940100013', 'Brass Key Ring', 'Brass', 'KEY-BRS', 'Atelier Nord', 3, 22.00, 7.50, 'recomputed_from_current_variant_cost')
  ) as lines(
    order_number,
    display_number,
    line_number,
    age_days,
    location_id,
    location_name,
    variant_id,
    inventory_item_id,
    product_title,
    variant_title,
    sku,
    vendor,
    quantity,
    unit_price,
    unit_cost,
    cost_source
  );

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
    (demo_shop, 'products', 'success', now() - interval '33 minutes', now() - interval '31 minutes', null, 'demo_seed', '{"productsSynced": 8, "variantsSynced": 15, "variantsWithUnitCostSynced": 11, "variantsWithMissingUnitCost": 4, "orderLinesCogsRecomputed": 12}'::jsonb),
    (demo_shop, 'inventory', 'success', now() - interval '30 minutes', now() - interval '29 minutes', null, 'demo_seed', '{"inventoryItemsProcessed": 15, "inventoryLevelsSynced": 18, "variantsUnitCostUpdated": 11, "orderLinesCogsRecomputed": 8}'::jsonb),
    (demo_shop, 'orders', 'success', now() - interval '28 minutes', now() - interval '25 minutes', null, 'demo_seed', '{"ordersSynced": 12, "orderLinesSynced": 34, "pagesProcessed": 1, "startDate": "demo", "endDate": "demo"}'::jsonb);

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
  values (
    demo_shop,
    'pierre-paul.quilichini@gmail.com',
    '99775414464',
    '*',
    'All locations',
    'admin',
    true,
    true,
    now()
  );
end $$;

commit;