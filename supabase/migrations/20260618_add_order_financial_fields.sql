ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shopify_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS currency_code text,
  ADD COLUMN IF NOT EXISTS gross_sales numeric(18,4),
  ADD COLUMN IF NOT EXISTS discounts numeric(18,4),
  ADD COLUMN IF NOT EXISTS returns numeric(18,4),
  ADD COLUMN IF NOT EXISTS net_sales numeric(18,4),
  ADD COLUMN IF NOT EXISTS refunds numeric(18,4),
  ADD COLUMN IF NOT EXISTS taxes numeric(18,4),
  ADD COLUMN IF NOT EXISTS shipping numeric(18,4),
  ADD COLUMN IF NOT EXISTS total_sales numeric(18,4),
  ADD COLUMN IF NOT EXISTS transactions_total numeric(18,4),
  ADD COLUMN IF NOT EXISTS financial_data_complete boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS financial_incomplete_reason text,
  ADD COLUMN IF NOT EXISTS financial_payload jsonb;

ALTER TABLE public.order_lines
  ADD COLUMN IF NOT EXISTS gross_sales numeric(18,4),
  ADD COLUMN IF NOT EXISTS discounts numeric(18,4),
  ADD COLUMN IF NOT EXISTS returns numeric(18,4),
  ADD COLUMN IF NOT EXISTS net_sales numeric(18,4),
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(18,4),
  ADD COLUMN IF NOT EXISTS taxes numeric(18,4),
  ADD COLUMN IF NOT EXISTS returned_quantity integer,
  ADD COLUMN IF NOT EXISTS cost_at_sale numeric(18,4),
  ADD COLUMN IF NOT EXISTS cost_at_sale_source text,
  ADD COLUMN IF NOT EXISTS cost_at_sale_captured_at timestamptz;

CREATE TABLE IF NOT EXISTS public.order_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain text NOT NULL,
  shopify_order_id text NOT NULL,
  shopify_transaction_id text NOT NULL,
  kind text,
  status text,
  gateway text,
  processed_at timestamptz,
  amount numeric(18,4),
  currency_code text,
  parent_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_transactions_shop_transaction_key UNIQUE (
    shop_domain,
    shopify_transaction_id
  )
);

CREATE INDEX IF NOT EXISTS order_transactions_shop_order_idx
  ON public.order_transactions (shop_domain, shopify_order_id);

CREATE INDEX IF NOT EXISTS order_transactions_shop_processed_idx
  ON public.order_transactions (shop_domain, processed_at);
