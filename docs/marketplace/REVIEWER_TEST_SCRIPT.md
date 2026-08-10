# Reviewer Test Script

Draft status: marketplace reviewer script. Replace placeholders before submission.

## Reviewer Context

App name: ShopOps Studio  
Demo shop: `shopops-demo.myshopify.com`  
Support contact: `support@shopopsstudio.com`  
Emergency contact: `Pierre-Paul Quilichini — support@shopopsstudio.com`

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

## Enable the Shopify POS Tile (Required for POS Staff Attribution)

ShopOps Studio includes a Shopify POS UI extension. Installing the app in
Shopify Admin makes the extension available, but the **ShopOps** tile must also
be added to the Smart Grid template used by the review POS location.

Prerequisites:

- Use a store with the Point of Sale sales channel and at least one active POS
  location.
- Sign in as the store owner, or use a staff account allowed to customize the
  POS Smart Grid.
- Use a released ShopOps Studio app version that includes the
  `shopops-pos-attribution` extension.

Admin setup:

1. In Shopify Admin, open **Point of Sale > Settings**.
2. Under **Customization**, open **POS app**.
3. Under **Smart Grid**, select the template assigned to the POS location used
   for review.
4. On the desired tile page, click **Add tile**.
5. Select **Embedded Apps**, then select **ShopOps Studio / ShopOps POS
   attribution**.
6. Add the **ShopOps** tile and click **Save**.
7. Confirm that this Smart Grid template is assigned to the intended review
   location. Repeat for any other template used by a POS location that should
   track staff attribution.

POS verification:

1. Open or refresh Shopify POS on a device signed in to the same store and POS
   location.
2. Confirm the **ShopOps** tile is visible on the Smart Grid.
3. Sign in as a POS staff member and add an eligible product to the cart.
4. Confirm the tile detects the staff session and cart line. Tap it to open the
   status modal.
5. Complete a clearly identified test sale.
6. Return to ShopOps Studio, allow the order sync to complete, then open
   **People > Sales attribution** and confirm the sale is available for staff
   attribution.

Expected result:

- The ShopOps tile is visible only on locations using a Smart Grid template to
  which it was added.
- The status modal states that staff attribution is active.
- Eligible new POS cart lines are stamped from the signed-in POS session.
- POS sellers do not need ShopOps dashboard access for attribution to work.
- Historical orders created before the tile was enabled are not retroactively
  attributed.

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

- A Viewer with active assigned locations lands directly on Overview and sees only that assigned scope.
- A Viewer has no Compare Locations, reporting-location management, People, Costs, Sync, Settings or Billing navigation.
- A Viewer with no valid assignment is denied safely and is told to contact the store owner/admin.

## Dashboard

Route: `/app/db-dashboard`

Steps:

1. As Manager/Admin/Owner, confirm the location selector reflects the role's allowed scope. As Viewer, confirm there is no global comparison or access-management UX.
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
- Staff attribution is best-effort. If staff names/emails are unavailable, safe fallbacks such as `Unassigned / unavailable`, location, and source where available are acceptable.

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

Role note:

- Manager can compare assigned locations.
- Admin and Owner can compare all reporting locations.
- Viewer cannot open this route and remains on scoped Overview.

Steps:

1. Open Compare Locations as Manager, Admin or Owner.
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

Route: `/app/people`

Steps:

1. Open People as Admin or Owner.
2. Confirm locations appear after location sync.
3. Enter a Shopify account email or Shopify user ID manually.
4. Assign a role and one or more locations.
5. Review optional staff suggestions only if existing `staff_members` data is present.
6. Review existing access rules or create a demo-only viewer/manager assignment.

Expected result:

- Admin can assign staff/location access without a synced Shopify staff list.
- Permissions use the current Shopify session identity where available plus ShopOps Studio DB assignments.
- Hints explain that email is the main identity and Shopify user IDs are aliases.
- Blocked users can send the Shopify user ID shown on the Access required page to an admin.
- Multiple Shopify user IDs can be linked to one person. Access label is display-only for recognizing ID-only access and is not used for authorization matching.
- `user_location_access.user_email` is a staff/app permission field, not a customer email field. `shopify_user_id` may be used for session identity matching.

## Expenses

Route: `/app/costs?tab=expenses`

Steps:

1. Open Costs > Operating expenses as Admin or Owner.
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
- Staff attribution is best-effort. If Shopify blocks `staffMember`, ShopOps Studio falls back to location/source reporting and financial totals remain accurate.
- Advanced Shopify staff sync is future-only for custom/Plus/Advanced implementations.
- Shopify POS is required to test the shipped POS staff-attribution feature.
- After installing ShopOps Studio, add the ShopOps tile to every Smart Grid
  template used by a POS location that should track staff sales. A template
  shared by several locations only needs to be configured once and assigned to
  those locations.
- The reviewer account must be the store owner or have permission to customize
  the POS Smart Grid.
- Compliance webhooks validate Shopify HMAC through Shopify webhook authentication. Valid requests return 200; invalid HMAC requests return 401.
- Render Cron should call `/internal/cron/process-sync-jobs` every 5 minutes with `Authorization: Bearer <cron secret>`.
- Existing webhook processing is separate at `/internal/cron/process-webhook-events`.
