# Demo Store Setup

Draft status: marketplace reviewer/demo setup plan.

## Objective

Prepare a Shopify demo store and marketplace database state that shows ShopOps Studio's core value without exposing current client production data.

## Demo Shop Requirements

Demo shop domain:

- `TODO_DEMO_SHOP.myshopify.com`

Reviewer/admin account:

- `TODO_REVIEWER_ADMIN_EMAIL`

Optional viewer/manager account:

- `TODO_REVIEWER_VIEWER_EMAIL`

## Required Data Shape

Locations:

- At least 3 active locations.
- Example names: Downtown, Waterfront, Mall Store.
- Each location should have orders and inventory rows where possible.

Products, vendors, and SKUs:

- At least 8 products.
- At least 12 variants.
- At least 5 vendors.
- Meaningful SKUs for table screenshots.
- Mix of products with complete costs and products missing cost for Data Quality examples.

Inventory:

- Inventory levels across multiple locations.
- Include healthy stock, warning stock, and critical stock examples.
- Include tracked inventory where possible.
- Include unit costs for most variants to support margin reporting.

Orders:

- At least 25 demo orders.
- Orders spread across locations.
- Orders spread across several dates so date filters look useful.
- Include enough line items for best sellers, vendor reporting, and recent order lines.

Discounts:

- Include several discounted orders or lines.
- Confirm dashboard shows discounts in financial metrics v2.

Refunds:

- Include at least 3 refunded or partially refunded orders.
- Include successful refund transactions where possible.
- Confirm Dashboard and Locations display refund context.

Returns:

- Include at least 2 return examples.
- Confirm returned quantity/return metrics appear where v2 data supports them.

Staff attribution and permissions:

- Public App Store builds do not request `read_users`.
- Include orders attributed to staff only if Shopify order/session data supports it without staff directory sync.
- Sales by Staff may show best-effort attribution or safe fallbacks such as `Unknown staff` / `Unassigned`.
- Configure Permissions by manually entering fake staff emails and assigning locations.
- Existing `staff_members` data may be used only as optional suggestions; it is not required.
- Advanced Shopify staff sync is future-only for custom, Plus, or Advanced implementations.

Expenses:

- Add fixed expenses in ShopOps Studio after sync.
- Include both location-specific expenses and one global/unassigned expense if useful for explaining current behavior.
- Example categories: Rent, Payroll, Utilities, Software.

Sync jobs/runs:

- At least one successful sync run for locations.
- At least one successful sync run for products.
- At least one successful sync run for inventory.
- At least one successful sync run for orders.
- Optional: one controlled failed sync run for Data Quality/Sync Center screenshot if safe and non-confusing.

## Sync Expectations

Reviewer flow should not require the reviewer to trigger a full sync.

Before submission:

- Install app on demo shop.
- Complete OAuth.
- Queue manual sync jobs from Sync Center for locations, products, inventory, and orders.
- Confirm `/internal/cron/process-sync-jobs` is running through Render Cron every 5 minutes.
- Confirm Sync Center shows success/freshness.
- Confirm Dashboard is populated.
- Confirm Locations is populated.
- Confirm Data Quality is meaningful.

First-run/empty-state path:

- Also verify a separate empty test shop or cleared demo tenant shows "Your data is being prepared."
- This confirms marketplace onboarding behavior without requiring reviewer access to internal sync controls.

## Demo Data Safety

Do:

- Use fake customer/order/product/staff names where possible.
- Use fake staff emails for app permissions.
- Use fake expenses.
- Use a dedicated demo shop/domain.
- Keep screenshots free of current client production data.

Do not:

- Seed demo data into a current client production shop domain.
- Use real customer names, emails, addresses, or phone numbers.
- Use current client sales, cost, staff, or expense data.

Field safety notes:

- No individual protected customer field access is needed because customer name, address, email, and phone are not displayed or stored in reporting tables.
- `orders.shipping` is a shipping amount, not a customer shipping address.
- `orders.staff_member_email`, `order_lines.staff_member_email`, and `user_location_access.user_email` are staff/app permission fields, not customer email fields.

## Acceptance Checklist

- [ ] Dashboard KPIs show non-zero sales.
- [ ] Best sellers table has several rows.
- [ ] Stock alerts show healthy/warning/critical examples.
- [ ] Sales by Vendor has several vendors.
- [ ] Sales by Staff has best-effort staff examples or safe fallback labels.
- [ ] Recent Order Lines has demo orders.
- [ ] Locations page compares multiple locations.
- [ ] Data Quality has meaningful OK/warning examples.
- [ ] Sync Center shows successful runs and record counts.
- [ ] Render Cron processes queued `sync_jobs`.
- [ ] Permissions page shows manual email entry and location assignments.
- [ ] Expenses page has demo expenses.
- [ ] Empty/new-shop test confirms first-run notice.
