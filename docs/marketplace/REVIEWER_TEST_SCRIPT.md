# Reviewer Test Script

Draft status: marketplace reviewer script. Replace placeholders before submission.

## Reviewer Context

App name: ShopOps Studio  
Demo shop: `TODO_DEMO_SHOP.myshopify.com`  
Support contact: `support@shopopsstudio.com`  
Emergency contact: `TODO_EMERGENCY_CONTACT`

ShopOps Studio provides operational reporting. It is not accounting, tax, payroll, legal, or financial advice. Merchants remain responsible for validating reports before business use.

Public App Store scopes are `read_orders`, `read_all_orders`, `read_products`, `read_inventory`, and `read_locations`. The public app does not request `read_users`.

## Install and Open App

1. Install ShopOps Studio using the marketplace/test install link.
2. Approve requested Shopify scopes.
3. Complete OAuth.
4. Open Shopify Admin > Apps > ShopOps Studio.

Expected result:

- App opens embedded in Shopify admin.
- Dashboard is the default experience.
- Requested scopes do not include `read_users`.
- If the demo data has not synced yet, reviewer sees "Your data is being prepared."

## Expected Empty State

Use this path only if the reviewer sees an empty/new shop state.

Expected text:

- "Your data is being prepared"
- "Reports appear after Shopify data sync completes."
- "ShopOps Studio helps multi-location merchants understand sales, margins, inventory, staff attribution, expenses, refunds, returns, and sync health."

Admin expected result:

- Admin can open Sync Center.
- Sync Center explains that manual sync requests are queued and processed automatically by the background sync worker.
- Sync Center can queue location, product, inventory, order, and full refresh jobs.

Viewer/no-access expected result:

- Viewer with no assigned locations sees "You do not have access to any locations yet."
- Viewer is told to ask an app admin to assign location access.

## Dashboard

Route: `/app/db-dashboard`

Steps:

1. Confirm location selector appears.
2. Select a date range with demo orders.
3. Review KPI cards.
4. Review Best sellers.
5. Review Soon out of stock.
6. Review Sales by Vendor.
7. Review Sales by Staff if Shopify order/session data includes staff attribution.
8. Review Recent Order Lines.

Expected result:

- Dashboard shows operational reporting for the selected location/date range.
- Discounts, refunds, returns, COGS, gross profit, and margin context appear where demo data supports them.
- Tables remain shop-scoped and permission-filtered.
- Staff attribution is best-effort. If staff names/emails are unavailable, safe fallbacks such as `Unknown staff` or `Unassigned` are acceptable.

## No Sales Date Range

Steps:

1. Select a date range with no demo orders.
2. Apply filters.

Expected result:

- Dashboard remains stable.
- Reviewer sees "No sales for this period."
- Reviewer is prompted to try another date range or confirm sync status.

## Locations

Route: `/app/locations`

Admin-only note:

- This route remains admin-only in Phase 3.

Steps:

1. Open Locations as an admin.
2. Select all locations.
3. Select one location.
4. Change date range.
5. Review location KPIs, trend, vendor/staff breakdowns where available, and location table.

Expected result:

- Locations page compares multiple demo locations.
- No synced locations state says data is being prepared.
- No sales date range state says no sales for the selected date range.

## Data Quality

Route: `/app/data-quality`

Steps:

1. Open Data Quality as admin.
2. Review Sync failures.
3. Review Sync freshness.
4. Review product, variant, cost, order, inventory, staff-attribution, and expense checks.

Expected result:

- Data Quality shows useful health checks after sync.
- On a new/empty shop, it says Data Quality becomes useful after sync.
- Admin can open Sync Center from first-run guidance.

## Sync Center

Route: `/app/admin/sync`

Steps:

1. Open Sync Center as admin.
2. Review First run status if shown.
3. Review Last successful sync.
4. Review Sync status cards.
5. Review Database records.
6. Review Recent sync jobs and recent sync history.

Expected result:

- Sync Center shows queued/manual sync jobs and background processing status.
- It shows freshness, history, counts, and troubleshooting status.
- Staff directory sync is hidden or labeled future/custom-only when `read_users` is absent.
- Admins may use "Process queued jobs now" for troubleshooting.
- Webhooks are for future Shopify changes and are not required for historical/manual sync data.

## Permissions

Route: `/app/admin/permissions`

Steps:

1. Open Permissions as admin.
2. Confirm locations appear after location sync.
3. Enter a staff email manually.
4. Assign a role and one or more locations.
5. Review optional staff suggestions only if existing `staff_members` data is present.
6. Review existing access rules or create a demo-only viewer/manager assignment.

Expected result:

- Admin can assign staff/location access without a synced Shopify staff list.
- Permissions use the current embedded Shopify staff identity where available plus ShopOps Studio DB assignments.
- Hints explain that manual email entry is the primary public app flow.
- `user_location_access.user_email` is a staff/app permission field, not a customer email field.

## Expenses

Route: `/app/admin/expenses`

Steps:

1. Open Expenses as admin.
2. Review existing demo expenses.
3. Add a demo expense if needed.
4. Assign expense globally or to a location.
5. Return to Dashboard/Locations.

Expected result:

- Expenses are scoped to demo shop.
- Expense data contributes to operational net profit reporting.

## Reviewer Notes

- ShopOps Studio is operational reporting, not accounting/tax/legal advice.
- The app does not intentionally store direct customer profiles, customer addresses, customer phone numbers, or customer emails in business reporting tables.
- No individual protected customer field access is needed because customer name, address, email, and phone are not displayed or stored.
- Order history and transaction data may still be sensitive/protected.
- `orders.shipping` is a shipping amount, not a customer shipping address.
- `orders.staff_member_email` and `order_lines.staff_member_email` are staff attribution fields, not customer email fields.
- `read_all_orders` is included for historical reporting and backfills.
- `read_users` is not requested for the public App Store app.
- Advanced Shopify staff sync is future-only for custom/Plus/Advanced implementations.
- Compliance webhooks validate Shopify HMAC through Shopify webhook authentication. Valid requests return 200; invalid HMAC requests return 401.
- Render Cron should call `/internal/cron/process-sync-jobs` every 5 minutes with `Authorization: Bearer <cron secret>`.
- Existing webhook processing is separate at `/internal/cron/process-webhook-events`.
