# Shopify Scopes Justification

Status: Phase 7B public App Store scope package.

Public marketplace scopes:

`read_orders, read_all_orders, read_products, read_inventory, read_locations`

ShopOps Studio does not request `read_users` for the public App Store app. Shopify Partner Support confirmed `read_users` is not available for public apps and has no public-app approval path.

## `read_orders`

Feature using the scope:

- Dashboard sales reporting.
- Order line reporting.
- Discounts, refunds, and returns reporting.
- COGS, gross profit, and margin reporting.
- Location performance reporting.
- Best-effort staff attribution when Shopify order data includes staff fields.
- Financial QA and order reconciliation jobs.
- Webhook-based order updates.

Why it is needed:

- ShopOps Studio's core value depends on merchant-facing reporting from orders, order lines, discounts, refunds, returns, product sales, locations, and margin inputs.

Data stored:

- Order IDs, order display names, created timestamps, financial status, gross sales, discounts, returns, net sales, refunds, taxes, shipping amount, total sales, transaction totals, order line IDs, products, variants, quantities, prices, COGS, gross profit, staff attribution fields where available, and location fields.

Protected/customer/staff data risk:

- Order history and transaction data may be sensitive or protected. ShopOps Studio does not display or store customer name, customer address, customer email, or customer phone in reporting tables.
- `orders.shipping` is a shipping amount, not a customer shipping address.
- `orders.staff_member_email` and `order_lines.staff_member_email` are staff attribution fields, not customer email fields.

Can it be removed:

- No. Removing it removes the primary reporting value.

Fallback if removed:

- The app could only show product, inventory, and location setup data and would not be marketplace-useful as a reporting app.

## `read_all_orders`

Feature using the scope:

- Historical reporting beyond Shopify's standard recent order access window.
- Historical backfills after install.
- Long-range location, product, margin, refund, return, discount, and COGS comparisons.
- Financial QA across historical reporting periods.

Why it is needed:

- Merchants need historical trends and prior-period comparisons, not only order-forward reporting after install. Shopify Partner Support confirmed the `read_all_orders` justification is acceptable for review.

Data stored:

- Same reporting data as `read_orders`, extended across historical periods.

Protected/customer/staff data risk:

- High review risk because it expands access to historical order data. ShopOps Studio minimizes direct customer fields and does not display or store customer name, address, email, or phone in reporting tables.

Can it be removed:

- Technically yes, but doing so would limit historical analytics and weaken first-install reporting.

Fallback if removed:

- Limit reporting and backfill to Shopify's standard accessible order window and explain historical limitations in-app.

Decision:

- Keep for first submission with the historical reporting justification above.

## `read_products`

Feature using the scope:

- Product sync.
- Variant sync.
- Vendor reporting.
- Best sellers.
- Stock alerts.
- Product webhook processing.
- COGS joins.

Why it is needed:

- Product, variant, SKU, vendor, and status data are required to interpret sales, inventory, and margin reporting.

Data stored:

- Product IDs, titles, vendors, product type/status where available, variant IDs, variant titles, SKUs, inventory item IDs, and related metadata.

Protected/customer/staff data risk:

- Low customer-data risk. This is product catalog data.

Can it be removed:

- No, unless product, vendor, inventory, and margin features are removed.

Fallback if removed:

- Order reporting would lose product names, vendor grouping, SKU context, and inventory/COGS joins.

## `read_inventory`

Feature using the scope:

- Inventory sync.
- Inventory item cost snapshots.
- Stock alerts.
- COGS and margin reporting.

Why it is needed:

- The app needs available inventory, tracked status, inventory item IDs, and costs to support operational reporting.

Data stored:

- Inventory item IDs, location IDs, available quantity, tracked status, SKU, variant linkage, unit cost, and sync timestamp.

Protected/customer/staff data risk:

- Low customer-data risk. Inventory and cost may be commercially sensitive merchant data.

Can it be removed:

- No, unless stock alerts and cost/margin features are removed.

Fallback if removed:

- Disable stock alerts and COGS/margin features or require manual cost uploads in a future product.

## `read_locations`

Feature using the scope:

- Location-level dashboard.
- Location analytics.
- Expense assignment by location.
- Permission assignment by location.
- Location filters.

Why it is needed:

- Multi-location reporting and location-aware permissions are central to ShopOps Studio.

Data stored:

- Shopify location IDs, names, active status, and basic metadata.

Protected/customer/staff data risk:

- Low customer-data risk. Location data is merchant operational data.

Can it be removed:

- No, unless the app becomes a single-store aggregate dashboard.

Fallback if removed:

- Remove location breakdowns, location permissions, and location expense allocation.

## `read_users` Not Requested

Decision:

- Public App Store builds do not request `read_users`.

Reason:

- Shopify Partner Support confirmed `read_users` is unavailable to public App Store apps and has no approval path.

Permissions flow:

- ShopOps Studio uses the currently logged-in Shopify staff identity from the embedded app session where available.
- Merchant admins manage role and location assignments by manually entering staff emails in ShopOps Studio.
- Assignments are stored in `user_location_access`.
- `user_location_access.user_email` is an app permission identity field, not a customer email field.
- Shopify user IDs from the current session may be stored when available to support identity matching.

Staff attribution flow:

- Staff sales attribution remains best-effort.
- If Shopify order data includes staff attribution without `read_users`, ShopOps Studio may store nullable `staff_member_id`, `staff_member_name`, and `staff_member_email` values.
- If staff names/emails are unavailable, reporting should display safe fallbacks such as `Unknown staff` or `Unassigned`.
- `orders.staff_member_email` and `order_lines.staff_member_email` are staff attribution fields, not customer email fields.

Future/custom support:

- `staff_members` remains in the schema for future custom, Plus, or Advanced implementations.
- Advanced Shopify staff directory sync is future-only and optional. It is not required for public marketplace permissions or dashboard rendering.
