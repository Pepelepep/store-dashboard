alter table public.orders
  add column if not exists total_discount_amount numeric(18, 4),
  add column if not exists current_total_discount_amount numeric(18, 4),
  add column if not exists line_discount_amount numeric(18, 4),
  add column if not exists shipping_discount_amount numeric(18, 4),
  add column if not exists discount_applications jsonb,
  add column if not exists discount_codes jsonb;

alter table public.order_lines
  add column if not exists discount_amount numeric(18, 4),
  add column if not exists discount_allocations jsonb;
