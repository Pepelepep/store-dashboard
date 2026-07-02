# ShopOps Studio Discount Test Plan

## Goal

Validate that Shopify discounts are captured as merchant-facing, informational reporting data. ShopOps Studio reports gross sales before discounts, allocated discounts, net sales after discounts, refunds/returns separately, and margin as net sales minus COGS. It does not provide accounting, tax, legal, or financial advice.

## Current Mapping

- Order discount total: `currentTotalDiscountsSet.shopMoney.amount` when available, otherwise `totalDiscountsSet.shopMoney.amount`.
- Line gross sales: `lineItems.originalTotalSet.shopMoney.amount`, falling back to original unit price times quantity.
- Line discount total: sum of `lineItems.discountAllocations[].allocatedAmountSet.shopMoney.amount`, falling back to `totalDiscountSet` or gross minus discounted total.
- Line net sales: `lineItems.discountedTotalSet.shopMoney.amount`, falling back to gross minus line discounts, then returns are subtracted separately.
- Discount evidence: order `discountApplications` and line `discountAllocations` are stored as JSON for QA and support review.
- Shipping discount: tracked separately when Shopify shipping totals indicate a shipping reduction; it is not mixed into product margin.
- Financial QA warns when line discounts plus shipping discounts differ from the order discount total by more than $0.02.

## Shopify Scenarios

1. Discount code, fixed amount
   - Create an order with a product discount code for a fixed dollar amount.
   - Expected: order discount total matches Shopify, line allocation stores the code application, line net sales equals discounted total.

2. Discount code, percentage
   - Create an order with a percentage discount code.
   - Expected: percentage application is stored, allocated line discounts sum to the order discount total within $0.02.

3. Automatic product discount
   - Create an automatic product-level discount.
   - Expected: automatic application title is stored and product line margin uses net sales after the allocation.

4. Cart-wide discount
   - Create a cart-wide fixed or percentage discount across multiple products.
   - Expected: Shopify line allocations are preserved per line and the dashboard does not double-subtract discounts.

5. Manual/POS custom discount
   - Create a draft/POS/manual discount if available in the test shop.
   - Expected: manual discount title/description is stored when Shopify returns it; reporting remains informational.

6. Buy X Get Y or free item
   - Create a free/discounted item promotion.
   - Expected: allocated discount appears on the affected line, gross sales remains before discount, net sales reflects Shopify discounted total.

7. Shipping discount
   - Create an order with discounted shipping.
   - Expected: shipping discount is tracked separately and is not included in product COGS or product margin.

8. Refund or return after discount
   - Refund or return a discounted order.
   - Expected: discounts remain separate from refunds/returns; net sales subtracts discounts and returns once.

## Backfill Validation

1. Queue an orders sync from Sync Center.
2. Run `/internal/cron/process-sync-jobs`.
3. Confirm existing orders are updated with:
   - `orders.discounts`
   - `orders.total_discount_amount`
   - `orders.current_total_discount_amount`
   - `orders.line_discount_amount`
   - `orders.shipping_discount_amount`
   - `orders.discount_applications`
   - `order_lines.discounts`
   - `order_lines.discount_amount`
   - `order_lines.discount_allocations`
4. Open Financial QA and confirm any mismatch above $0.02 is flagged as `discount_mismatch`.
