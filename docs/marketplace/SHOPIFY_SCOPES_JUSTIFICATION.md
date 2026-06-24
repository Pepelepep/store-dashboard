# Shopify Scopes Justification

Draft status: marketplace preparation draft.

Current scopes:

`read_orders, read_all_orders, read_products, read_inventory, read_locations, read_users`

## `read_orders`

Feature using the scope:

- Dashboard sales reporting.
- Order line reporting.
- Refunds/returns reporting.
- Financial QA.
- Webhook-based order updates.
- Order reconciliation jobs.

Why it is needed:

- ShopOps Studio's core reporting depends on orders and order line financial data.

Data stored:

- Order IDs, order display names, created timestamps, financial status, gross sales, discounts, returns, net sales, refunds, taxes, shipping, total sales, transaction totals, order line IDs, products, variants, quantities, prices, COGS, gross profit, staff attribution fields, and location fields.

Protected/customer/staff data risk:

- Order history and transaction data may be considered sensitive or protected. The app does not intentionally store direct customer profiles, addresses, phones, or customer emails in business reporting tables.

Can it be removed:

- No. Removing it removes the primary app value.

Fallback if removed:

- App could only show inventory/product/location setup data and would not be marketplace-useful as an operations dashboard.

## `read_all_orders`

Feature using the scope:

- Historical analytics beyond the default Shopify order access window.
- Historical backfills.
- Long-range COGS and financial QA.

Why it is needed:

- Merchants need historical location, product, staff, refund, return, and margin reporting, not only recent orders.

Data stored:

- Same order/order-line/reporting data as `read_orders`, extended across historical periods.

Protected/customer/staff data risk:

- High review risk because it expands access to historical order data. Even with customer data minimization, Shopify may require strong justification and protected customer data review.

Can it be removed:

- Yes, if MVP accepts limited historical reporting.

Fallback if removed:

- Limit reporting and backfill to Shopify's default order window.
- Present in-app copy explaining that historical reporting begins from install date or recent accessible order history.
- Offer historical analytics later after scope approval.

Option A: request scope for historical analytics.

- Pros: full product value, useful historical comparisons, better financial QA.
- Cons: higher review burden and possible approval delay.

Option B: remove for MVP and limit historical reporting.

- Pros: simpler review and lower protected data surface.
- Cons: weaker merchant value, less useful onboarding, less accurate historical trends.

Recommended draft decision:

- Decide based on launch strategy. If marketplace review speed is the priority, consider Option B for MVP. If full historical reporting is required for app value, prepare a strong Option A justification.

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

- Product, variant, SKU, vendor, and status data are required to interpret sales and inventory.

Data stored:

- Product IDs, titles, vendors, product type/status where available, variant IDs, variant titles, SKUs, inventory item IDs, and related metadata.

Protected/customer/staff data risk:

- Low customer-data risk. This is product catalog data.

Can it be removed:

- No, unless product/vendor/inventory/margin features are removed.

Fallback if removed:

- Order reporting would lose product names, vendor grouping, SKU context, and inventory/COGS joins.

## `read_inventory`

Feature using the scope:

- Inventory sync.
- Inventory item cost snapshots.
- Stock alerts.
- COGS and margin reporting.

Why it is needed:

- The app needs available inventory, tracked status, inventory item IDs, and costs to support operations reporting.

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

- Multi-location reporting is central to ShopOps Studio.

Data stored:

- Shopify location IDs, names, active status, and basic metadata.

Protected/customer/staff data risk:

- Low customer-data risk. Location data is merchant operational data.

Can it be removed:

- No, unless the app becomes a single-store aggregate dashboard.

Fallback if removed:

- Remove location breakdowns, location permissions, and location expense allocation.

## `read_users`

Feature using the scope:

- Staff member sync.
- Sales by Staff.
- Staff attribution.
- Permissions staff dropdown.
- Current-user permission matching.

Why it is needed:

- The app uses staff/user metadata to attribute sales and manage location-level access.

Data stored:

- Shopify staff/user IDs, names, email addresses where available, active status, and related attribution fields.

Protected/customer/staff data risk:

- Not direct customer data, but staff/user metadata is personal data and should be minimized, disclosed, and protected.

Can it be removed:

- Possibly, if staff attribution and staff-based permission ergonomics are reduced.

Fallback if unavailable:

- Use manual email entry for permissions.
- Hide or degrade Sales by Staff.
- Use Shopify user ID from current session where available, without full staff directory sync.
- Explain that staff attribution requires additional approval.

Recommended draft decision:

- Keep if staff reporting is central to the app positioning.
- Prepare App Store explanation focused on access control and staff attribution.
