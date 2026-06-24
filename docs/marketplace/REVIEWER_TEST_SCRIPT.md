# Reviewer Test Script

Draft status: marketplace reviewer script. Replace placeholders before submission.

## Reviewer Context

App name: ShopOps Studio  
Demo shop: `TODO_DEMO_SHOP.myshopify.com`  
Support contact: `TODO_SUPPORT_EMAIL`  
Emergency contact: `TODO_EMERGENCY_CONTACT`

ShopOps Studio provides operational reporting. It is not accounting, tax, payroll, legal, or financial advice. Merchants remain responsible for validating reports before business use.

## Install and Open App

1. Install ShopOps Studio using the marketplace/test install link.
2. Approve requested Shopify scopes.
3. Complete OAuth.
4. Open Shopify Admin > Apps > ShopOps Studio.

Expected result:

- App opens embedded in Shopify admin.
- Dashboard is the default experience.
- If the demo data has not synced yet, reviewer sees "Your data is being prepared."

## Expected Empty State

Use this path only if the reviewer sees an empty/new shop state.

Expected text:

- "Your data is being prepared"
- "Reports appear after Shopify data sync completes."
- "ShopOps Studio helps multi-location merchants understand sales, margins, inventory, staff attribution, expenses, refunds, returns, and sync health."

Admin expected result:

- Admin can open Sync Center.
- Sync Center explains it is for monitoring sync health.
- No reviewer-facing full sync trigger is shown.

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
7. Review Sales by Staff if staff data is enabled.
8. Review Recent Order Lines.

Expected result:

- Dashboard shows operational reporting for the selected location/date range.
- Discounts, refunds, returns, COGS, gross profit, and margin context appear where demo data supports them.
- Tables remain shop-scoped and permission-filtered.

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
5. Review location KPIs, trend, vendor/staff breakdowns, and location table.

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
4. Review product, variant, cost, order, inventory, staff, and expense checks.

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

- Sync Center is monitoring-only.
- It shows freshness, history, counts, and troubleshooting status.
- It does not expose a reviewer-facing full sync trigger.

## Permissions

Route: `/app/admin/permissions`

Steps:

1. Open Permissions as admin.
2. Confirm locations appear after location sync.
3. Confirm staff appears after Shopify staff sync if `read_users` is available.
4. Review existing access rules or create a demo-only viewer/manager assignment.

Expected result:

- Admin can assign staff/location access.
- Hints explain staff/location data may appear after sync.
- Sync Center link is available when staff/locations are missing.

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
- Order history and transaction data may still be sensitive/protected.
- `read_all_orders` is currently included for historical analytics unless removed before MVP.
- `read_users` is currently included for staff attribution and permissions unless degraded mode is approved.
