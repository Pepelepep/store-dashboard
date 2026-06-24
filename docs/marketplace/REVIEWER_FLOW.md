# Reviewer Flow

Draft status: marketplace preparation draft. Update with final test shop and credentials/process before submission.

## Test Shop Requirements

Reviewer test shop: `[test shop domain placeholder]`

Required demo data:

- At least 2 active Shopify locations.
- Products with vendors, variants, and SKUs.
- Inventory levels across locations.
- Orders with discounts.
- Orders with refunds.
- Orders with returns.
- Orders attributed to staff where available.
- App-configured fixed expenses.
- At least one successful sync run.
- Optional: one failed sync run for Data Health visibility.

Demo seed reference:

- `supabase/seeds/001_staging_demo_data.sql` contains fake/demo reporting data for staging UI testing.

## Install App

1. Install ShopOps Studio from the Shopify App Store or test installation link.
2. Approve requested scopes.
3. Complete Shopify OAuth.

Expected outcome:

- App opens embedded in Shopify admin.
- Merchant lands in ShopOps Studio.
- If no synced data exists, the app should show first-run guidance and sync expectations.

## Open Embedded App

1. From Shopify admin, open Apps.
2. Select ShopOps Studio.

Expected outcome:

- Embedded app frame loads successfully.
- Main navigation is visible.
- Dashboard is the default app experience.

## First-Run / Onboarding Expectation

Current implementation note:

- The app currently redirects to `/app/db-dashboard`; a marketplace-grade first-run onboarding state is still recommended.

Expected future outcome:

- New shops see a clear empty state explaining that data must sync before reports are complete.
- App explains approximate sync timing and what data is required.
- Admin users can see where to verify sync health.

## Run or Verify Sync

Reviewer-safe path:

1. Open `/app/admin/sync` as an admin user.
2. Review database record counts.
3. Review last successful sync timestamps.
4. Review recent sync jobs.

Expected outcome:

- Sync Center shows sync freshness and recent runs.
- No manual production full-refresh action is required from the reviewer.

Operational note:

- Full refresh is currently an operator command, not a reviewer-facing UI flow.

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

## Verify Permissions

Route: `/app/admin/permissions`

Steps:

1. Open Permissions as admin.
2. Confirm staff list is available if `read_users` data exists.
3. Review location assignment UI.
4. Create or inspect a viewer/manager permission in a test shop only.

Expected outcome:

- Admin can assign staff to locations.
- Non-admin users see only permitted dashboard locations.

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

- Explain that ShopOps Studio is a reporting app, not accounting/tax/legal advice.
- Explain that the app does not intentionally store direct customer profiles, customer addresses, customer phone numbers, or customer emails in business reporting tables.
- Explain why historical order access is requested if `read_all_orders` remains in scope.
- Explain why staff/user access is requested if `read_users` remains in scope.
- Provide support contact and emergency contact.
