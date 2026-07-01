# Reviewer Flow

Status: Phase 7B aligned with public App Store scope package. Update with final test shop and credentials/process before submission.

## Test Shop Requirements

Reviewer test shop: provide the assigned Shopify review shop domain in the App Store submission notes.

Required demo data:

- At least 2 active Shopify locations.
- Products with vendors, variants, and SKUs.
- Inventory levels across locations.
- Orders with discounts.
- Orders with refunds.
- Orders with returns.
- Orders attributed to staff where Shopify order/session data provides staff context.
- App-configured fixed expenses.
- At least one successful sync run.
- Optional: one failed sync run for Data Health visibility.
- Costs populated for enough products to demonstrate COGS, gross profit, and margin reporting.

Demo seed reference:

- `supabase/seeds/001_staging_demo_data.sql` contains fake/demo reporting data for staging UI testing.

## Public Marketplace Pages

These pages are publicly accessible without Shopify authentication, an installed shop, or session context:

- Privacy: `https://shopops-marketplace-preview.onrender.com/privacy`
- Terms: `https://shopops-marketplace-preview.onrender.com/terms`
- Support: `https://shopops-marketplace-preview.onrender.com/support`

Expected outcome:

- Each page loads directly in a browser.
- The pages do not redirect to Shopify OAuth.
- The pages link to each other for reviewer navigation.

## Install App

1. Install ShopOps Studio from the Shopify App Store or test installation link.
2. Approve requested scopes.
3. Complete Shopify OAuth.

Expected outcome:

- App opens embedded in Shopify admin.
- Merchant lands in ShopOps Studio.
- Requested scopes are `read_orders`, `read_all_orders`, `read_products`, `read_inventory`, and `read_locations`.
- Public App Store builds do not request `read_users`.
- If `BILLING_ENABLED=true` and the shop has no active Shopify managed subscription, the app shows the billing-required state for the ShopOps Studio plan at `$59.99/month` with a 14-day free trial.
- For first submission, billing code is prepared but disabled by default with `BILLING_ENABLED=false` unless billing review is intentionally enabled.
- If no synced data exists, the app should show first-run guidance and sync expectations.

## Open Embedded App

1. From Shopify admin, open Apps.
2. Select ShopOps Studio.

Expected outcome:

- Embedded app frame loads successfully.
- Main navigation is visible.
- Dashboard is the default app experience.

## First-Run / Onboarding Expectation

Current onboarding copy:

- Connect your store
- Sync your data
- Trust your reporting

Expected future outcome:

- New shops see a clear empty state explaining that data must sync before reports are complete.
- App explains approximate sync timing and what data is required.
- Admin users can see where to verify sync health.
- Onboarding and reporting copy should remain merchant-facing and informational.

## Run or Verify Sync

Reviewer-safe path:

1. Open `/app/admin/sync` as an admin user.
2. Review database record counts.
3. Review last successful sync timestamps.
4. Review recent sync jobs.

Expected outcome:

- Sync Center shows sync freshness and recent runs.
- Staff directory sync is labeled optional/future/custom-only when `read_users` is absent.
- Manual sync requests are queued and processed by the background sync worker.
- Webhooks are for future Shopify changes and are not required to process historical/manual sync data.

Operational note:

- Render Cron must call `/internal/cron/process-sync-jobs` every 5 minutes with `Authorization: Bearer <cron secret>`.
- Existing webhook processing remains separate at `/internal/cron/process-webhook-events`.

## Open Dashboard

Route: `/app/db-dashboard`

Steps:

1. Confirm dashboard loads.
2. Select a location.
3. Adjust date range.
4. Review KPI cards.
5. Review best sellers, stock alerts, sales by vendor, sales by staff, and recent order lines.

Expected outcome:

- Metrics populate from synced data.
- Location selector respects the current user's permissions.
- Order links point to Shopify admin order pages.
- Empty states are clear if data is unavailable.
- Reporting is presented as operational information, not accounting, tax, legal, payroll, or financial advice.
- Staff sales attribution is best-effort. If staff names/emails are unavailable, reporting uses safe fallbacks such as `Unknown staff` or `Unassigned`.

## Open Locations

Route: `/app/locations`

Current implementation note:

- This route is admin-only today.

Steps:

1. Open Locations as an admin user.
2. Select multiple locations.
3. Review sales, margin, expenses, and trend tables.

Expected outcome:

- Location data is scoped to the installed shop.
- Admin can compare accessible locations.
- Discounts/refunds/returns are reflected in financial metrics where available.

## Verify Discounts, Refunds, and Returns

Steps:

1. Use demo orders with discounts.
2. Use demo orders with refund transactions.
3. Use demo orders with returned quantities or return amounts.
4. Check Dashboard and Locations metrics.
5. Check Recent Order Lines chips/columns.

Expected outcome:

- Discounts reduce net sales.
- Refunds and returns are visible where financial metrics v2 data is available.
- Reporting copy does not imply accounting/tax finality.
- The reviewer can see why order and historical order data are needed for reporting across current and prior periods.

## Verify Data Health

Route: `/app/data-quality`

Steps:

1. Open Data Health as admin.
2. Review sync freshness.
3. Review missing cost, missing product, missing location, and optional issue sections.
4. Open sample order links if present.

Expected outcome:

- Data Health loads without cross-shop data.
- Issues are grouped clearly.
- Failed sync indicators are visible when present.
- The page explains whether reports are ready to trust and links admins to Sync Center for support diagnostics.
- Data Health supports the App Store listing's positioning around reporting readiness and data completeness.

## Verify Sync Center

Route: `/app/admin/sync`

Steps:

1. Open Sync Center as admin.
2. Review record counts.
3. Review sync freshness cards.
4. Review recent sync jobs and runs.

Expected outcome:

- Sync status is understandable.
- The route is admin/support diagnostic and does not require reviewer-triggered production sync.
- Admins can queue manual sync jobs and, when needed for troubleshooting, process queued jobs now.

## Verify Permissions

Route: `/app/admin/permissions`

Steps:

1. Open Permissions as admin.
2. Enter a staff email manually.
3. Assign a role and one or more locations.
4. Review optional staff suggestions only if existing `staff_members` data is present.
5. Create or inspect a viewer/manager permission in a test shop only.

Expected outcome:

- Admin can assign staff email identities to locations without a synced Shopify staff list.
- Non-admin users see only permitted dashboard locations.
- Permissions use the currently logged-in Shopify staff identity from the embedded app session where available plus ShopOps Studio database assignments in `user_location_access`.
- `user_location_access.user_email` is an app permission identity field, not a customer email field.

## Verify Expenses

Route: `/app/admin/expenses`

Steps:

1. Open Expenses as admin.
2. Add or inspect a fixed monthly expense.
3. Assign it globally or to a location.
4. Return to Dashboard/Locations and confirm expense impact.

Expected outcome:

- Expenses save for the installed shop only.
- Expense calculations are reflected in net profit metrics.

## Reviewer Notes to Include in Submission

- Explain that ShopOps Studio is a merchant-facing reporting app, not accounting, tax, legal, payroll, or financial advice.
- Explain that the public app does not request `read_users` because Shopify Partner Support confirmed it is unavailable for public App Store apps.
- Explain that `read_orders` powers sales, line items, products sold, discounts, refunds, returns, transactions, location performance, staff attribution where available, and order-level reporting completeness.
- Explain that `read_all_orders` supports historical reporting, backfills after install, and period comparisons beyond the recent order access window.
- Explain that permissions use current embedded-session staff identity plus ShopOps Studio DB assignments, and merchant admins manage access by email.
- Explain that staff sales attribution is best-effort based on available order/session data.
- Explain that advanced Shopify staff directory sync is future-only for custom/Plus/Advanced implementations.
- Explain that protected customer/order data may be processed because Shopify order records can include customer/order information needed to calculate and validate sales, refund, return, discount, product, location, and margin reports.
- Explain that no individual protected customer field access is needed because customer name, address, email, and phone are not displayed or stored.
- Explain that `orders.shipping` is a shipping amount, not a customer shipping address.
- Explain that `orders.staff_member_email`, `order_lines.staff_member_email`, and `user_location_access.user_email` are staff/app permission fields, not customer email fields.
- Explain that data is isolated by shop and is not sold or shared for third-party marketing.
- Support, privacy, and security contact: `support@shopopsstudio.com`.
- Expected response time: within 2 business days. Security or privacy requests are prioritized.
