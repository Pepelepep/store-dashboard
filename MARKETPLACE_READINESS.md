# Marketplace Readiness Audit

Audit branch: `audit/marketplace-readiness`  
Base branch target: `marketplace/stable-prep`  
Audit date: 2026-06-24  
Scope: documentation-only audit for Shopify App Store / marketplace readiness. No app behavior, production config, Shopify production config, Render env vars, database schema, webhook behavior, billing, or marketplace-default behavior was changed.

## Executive Summary

ShopOps Studio is structurally close to marketplace-ready from a route/auth and shop-isolation perspective. Embedded app routes consistently authenticate with Shopify admin sessions, webhook routes use Shopify webhook authentication, and business tables are generally scoped by `shop_domain` or `session.shop`. The schema reinforces isolation with composite unique constraints for core synced records.

The main blockers are not broad code rewrites; they are marketplace readiness decisions and hardening:

- Public legal/support pages and listing assets are missing from this repository.
- Billing and pricing are not implemented and should stay disabled until a dedicated marketplace branch.
- `read_all_orders` and `read_users` require strong App Store justification and may trigger protected customer data review.
- Install/reinstall/uninstall behavior needs an explicit policy. `app/uninstalled` deletes only Shopify sessions, while `shop/redact` deletes shop-scoped Supabase data.
- First-install onboarding, no-data/sync states, and reviewer demo flow need a marketplace pass.
- Internal endpoints are secret-protected, but the operational rotation/deployment policy for `CRON_SECRET` should be documented before submission.

Recommended next branch: `marketplace/readiness-phase-1-docs-legal-onboarding`.

## Current Status

### Route Inventory

Public / auth / install routes:

- `/` -> `app/routes/_index/route.tsx`; redirects to `/app/db-dashboard` while preserving query string.
- `/auth/*` -> `app/routes/auth.$.tsx`; delegates to `authenticate.admin`, used by Shopify OAuth callback flow.
- `/auth/login` -> `app/routes/auth.login/route.tsx`; non-embedded login form using `login(request)`.

Embedded app shell and app routes:

- `/app` -> `app/routes/app.tsx`; authenticates Shopify admin session and renders embedded navigation.
- `/app` -> `app/routes/app._index.tsx`; redirects to `/app/db-dashboard`.
- `/app/db-dashboard` -> `app/routes/app.db-dashboard.tsx`; authenticated dashboard, admin or viewer with location permissions.
- `/app/live-dashboard` -> `app/routes/app.live-dashboard.tsx`; redirects to `/app/db-dashboard`.

Admin-only routes:

- `/app/locations` -> `app/routes/app.locations.tsx`; currently calls `assertAdminAccess`.
- `/app/data-quality` -> `app/routes/app.data-quality.tsx`; currently calls `assertAdminAccess`.
- `/app/admin/expenses` -> `app/routes/app.admin.expenses.tsx`; admin-only.
- `/app/admin/permissions` -> `app/routes/app.admin.permissions.tsx`; admin-only.
- `/app/admin/sync` -> `app/routes/app.admin.sync.tsx`; admin-only monitoring route.
- `/app/admin/financial-qa` -> `app/routes/app.admin.financial-qa.tsx`; admin-only, not linked in main nav.
- `/app/admin/sync-inventory`, `/app/admin/sync-locations`, `/app/admin/sync-orders`, `/app/admin/sync-products`; admin-only redirects to sync center.

Viewer-accessible routes:

- `/app/db-dashboard` is the only confirmed viewer-accessible page. It filters locations through `getPermissionContext`.
- `/app/locations` is not currently viewer-accessible, despite being a reporting page. It requires admin access.

Webhook routes:

- `/webhooks/app/uninstalled`
- `/webhooks/app/scopes_update`
- `/webhooks/orders/create`
- `/webhooks/orders/updated`
- `/webhooks/inventory-levels/update`
- `/webhooks/inventory-items/update`
- `/webhooks/products/create`
- `/webhooks/products/update`
- `/webhooks/products/delete`
- `/webhooks/customers/data_request`
- `/webhooks/customers/redact`
- `/webhooks/shop/redact`

Cron / internal routes:

- `/internal/cron/process-webhook-events`; requires `Authorization: Bearer ${CRON_SECRET}`.
- `/internal/financial-backfill-30d`; requires `Authorization: Bearer ${CRON_SECRET}`. GET returns 405 after auth; POST performs enqueue/process actions.

### Multi-Shop Isolation

Overall status: mostly good, with a few review items.

Confirmed scoped access patterns:

- Orders: dashboard and financial QA reads use `.eq("shop_domain", session.shop)`; sync upserts use `shop_domain: shop` and `onConflict: "shop_domain,shopify_order_id"`.
- Order lines: dashboard, locations, QA, compliance redaction, and sync paths scope by `shop_domain`; sync line upserts use `onConflict: "shop_domain,shopify_line_item_id"`.
- Order transactions: dashboard/location refund reads scope by `shop_domain`; sync inserts use `shop_domain: shop` and `onConflict: "shop_domain,shopify_transaction_id"`.
- Locations: app reads scope by `session.shop`; sync upserts use `onConflict: "shop_domain,shopify_location_id"`.
- Staff: permissions lookup and sync paths scope by `shop_domain`; staff upserts use `onConflict: "shop_domain,shopify_staff_id"`.
- Permissions: `user_location_access` reads/deletes/inserts scope by `session.shop`.
- Sync jobs/runs: app reads and job updates scope by `shop_domain`; job insertions write `shop_domain`.
- Webhook events: enqueue writes authenticated `shop`; processor works from claimed event rows and uses `event.shop_domain`.
- Expenses: reads, updates, toggles, and deletes scope by `session.shop`; inserts write `shop_domain: session.shop`.
- COGS/product data: products, variants, inventory items, inventory levels, and COGS recompute RPCs are keyed by `shop_domain`.
- Dashboard routes: `/app/db-dashboard`, `/app/locations`, `/app/data-quality`, and financial QA all use `session.shop` for data reads.
- Admin routes: expenses, permissions, sync, data quality, financial QA, and redirect routes authenticate admin access before data access.

Review items:

- `claim_webhook_events` claims globally across shops by design. This is acceptable for a central cron worker, but should be documented as an internal worker contract because it processes multiple tenants in one run.
- `markEventDone` and `markEventError` update `webhook_events` by event `id` only. Since event rows are claimed internally and IDs are UUID primary keys, this is likely safe, but adding `shop_domain` would make the tenant boundary more explicit.
- Compliance audit events are intentionally retained after `shop/redact`; confirm this retention is disclosed in privacy docs.

## Blockers Before App Store Submission

1. Legal and public support surface is missing.
   - Need privacy policy URL, terms of service URL, support email, and emergency developer contact.
   - No public `/privacy`, `/terms`, `/support`, or equivalent static links were found.

2. Billing/pricing flow is not implemented.
   - No billing route, subscription creation, pricing plan, trial handling, or charge confirmation was found.
   - Keep billing disabled until a dedicated branch implements and tests it.

3. Protected customer data justification is incomplete.
   - Current scopes include `read_all_orders` and `read_users`.
   - App stores order names, timestamps, financial fields, line items, staff attribution, and order transaction data.
   - App does not appear to store direct customer profiles, customer emails, phone numbers, or addresses in business tables, but Shopify may still classify order history and staff/user data as sensitive or protected.

4. Install/reinstall/uninstall data policy needs a product decision.
   - `webhooks.app.uninstalled.tsx` deletes Prisma sessions only.
   - `webhooks.shop.redact.tsx` deletes shop-scoped Supabase data and sessions.
   - Reinstall likely preserves old Supabase reporting data until Shopify sends `shop/redact`.
   - Marketplace docs should clearly state whether uninstall preserves analytics for reinstall, for how long, and when erasure happens.

5. Reviewer/demo flow is not defined.
   - There is a staging seed for demo data, but no reviewer instructions, demo store credentials/process, or first-run path that reliably shows a complete app experience.

6. App listing assets are absent.
   - Only `public/favicon.ico` was found. No marketplace icon, screenshots, feature images, or listing copy artifacts were found.

## High Priority Fixes

- Add marketplace documentation/legal pages or external URLs for privacy policy, terms, support, and data retention.
- Write a protected customer data matrix covering every Shopify scope and every stored field category.
- Decide and document uninstall/reinstall retention behavior before changing code.
- Add first-install onboarding that explains initial sync requirements and expected wait time.
- Add robust no-data, sync-in-progress, sync-failed, and empty dashboard states for `/app/db-dashboard` and `/app/locations`.
- Add a reviewer flow document with test shop, install steps, demo credentials/process, and expected screens.
- Validate App Store contact metadata: support email, emergency contact, developer website, privacy URL, terms URL.
- Document `CRON_SECRET` requirements and rotation policy for Render/staging/production.

## Medium Priority Improvements

- Consider making `/app/locations` viewer-accessible with location filtering if the product expects store managers/viewers to use location analytics.
- Add explicit `shop_domain` predicates to webhook event status updates, even when updating by UUID.
- Add route-level 403/unauthorized UX instead of bare thrown responses for admin-only and no-location-access states.
- Add a clear "no permissions configured" state for newly installed shops where only bootstrap env admins can access admin pages.
- Add listing-ready screenshots after onboarding and no-data states exist.
- Create a dedicated marketplace config file separate from the current client production Shopify app config.
- Add tests for route authorization, shop-scoped queries, webhook authentication, and internal endpoint secrets.

## Can Wait After Launch

- Advanced billing plan experiments, if initial launch is free/unlisted/manual.
- Self-serve admin bootstrap UI beyond the current `ADMIN_EMAILS` / `ADMIN_SHOPIFY_USER_IDS` bootstrap model.
- More detailed in-app data export for customer data requests, if privacy policy explicitly states no direct customer profile storage and compliance handling remains acceptable.
- Deep mobile UI polish beyond avoiding broken layouts and unreadable tables.
- Public marketing site, unless required for listing conversion or legal hosting.

## Recommended Implementation Phases

Phase 1: Documentation and policy

- Add `PRIVACY.md`, `TERMS.md`, support/contact documentation, reviewer flow, data retention policy, and scope justification.
- No production config changes.

Phase 2: Marketplace UX safety

- Add first-install onboarding and empty/sync states.
- Improve 403/unauthorized pages.
- Keep marketplace mode disabled by default unless explicitly enabled in staging.

Phase 3: App Store config and listing

- Create marketplace-specific Shopify config and listing asset package.
- Prepare screenshots from staging/demo store.
- Validate OAuth URLs, compliance webhook URLs, contacts, and scopes.

Phase 4: Billing

- Implement billing in a separate branch only after marketplace UX and legal docs are stable.
- Keep billing feature-flagged and off by default until review flow is ready.

Phase 5: Submission hardening

- Add automated tests and a manual reviewer checklist.
- Run staging install, uninstall, reinstall, webhook, and redaction drills.

## Exact Files / Routes That Need Work

Route/auth files:

- `app/routes/_index/route.tsx`
- `app/routes/auth.$.tsx`
- `app/routes/auth.login/route.tsx`
- `app/routes/app.tsx`
- `app/routes/app._index.tsx`
- `app/routes/app.db-dashboard.tsx`
- `app/routes/app.locations.tsx`
- `app/routes/app.data-quality.tsx`
- `app/routes/app.admin.expenses.tsx`
- `app/routes/app.admin.permissions.tsx`
- `app/routes/app.admin.sync.tsx`
- `app/routes/app.admin.financial-qa.tsx`

Webhook/internal files:

- `app/routes/webhooks.app.uninstalled.tsx`
- `app/routes/webhooks.app.scopes_update.tsx`
- `app/routes/webhooks.customers.data_request.tsx`
- `app/routes/webhooks.customers.redact.tsx`
- `app/routes/webhooks.shop.redact.tsx`
- `app/routes/internal.cron.process-webhook-events.tsx`
- `app/routes/internal.financial-backfill-30d.tsx`
- `app/lib/webhooks/webhook-events.server.ts`
- `app/lib/sync/webhook-events-processor.server.ts`
- `app/lib/compliance/compliance-webhooks.server.ts`

Data access / isolation files:

- `app/lib/sync/shopify-sync.server.ts`
- `app/lib/sync/sync-jobs.server.ts`
- `app/lib/auth/permissions.server.ts`
- `app/lib/db/supabase.server.ts`
- `supabase/migrations/001_initial_business_schema.sql`
- `supabase/migrations/20260616_add_operational_webhook_events.sql`
- `supabase/migrations/20260601_add_compliance_webhook_events.sql`
- `supabase/migrations/20260601_add_data_quality_report.sql`
- `supabase/migrations/20260531_add_bulk_cogs_recompute.sql`

Config/listing files:

- `shopify.app.store-dashboard.toml`
- `shopify.app.store-dashboard-staging.toml`
- `shopify.web.toml`
- `package.json`
- `README.md`
- `docs/current-status.md`
- `docs/operations/sync-and-backfill.md`
- `supabase/seeds/001_staging_demo_data.sql`

Needed new docs/assets:

- Privacy policy / URL source.
- Terms of service / URL source.
- Support and emergency contact doc.
- Reviewer flow doc.
- Scope justification doc.
- Listing copy and screenshots.
- Marketplace icon/assets.

## Shopify Scopes

Current scopes from `shopify.app.store-dashboard.toml` and staging config:

`read_all_orders,read_inventory,read_orders,read_products,read_locations,read_users`

### `read_orders`

Why needed:

- Core sales, order-line, refund/return, staff/vendor, and margin reporting.

Feature usage:

- Sync orders/order lines.
- Dashboard KPIs and recent order lines.
- Location analytics.
- Financial QA.
- Order reconciliation jobs and order webhooks.

Protected customer data:

- May involve protected customer data because order records can include customer/order history. Current code appears to minimize by storing order display name and financial/line item reporting fields, not direct customer profile contact fields.

Can it be removed:

- No, not without removing the core app value.

### `read_all_orders`

Why needed:

- Historical reporting beyond Shopify's default recent order access window.

Feature usage:

- Historical full refresh, long-range dashboards, COGS and financial QA over older orders.

Protected customer data:

- Yes, likely requires stronger review justification because it expands order history access.

Can it be removed:

- Possibly only if marketplace version limits historical reporting to the default order window or asks merchants to accept a reduced backfill.

### `read_products`

Why needed:

- Product, variant, vendor, SKU, status, and product delete/update webhook processing.

Feature usage:

- Best sellers, vendor reporting, stock alerts, COGS joins, product sync/webhooks.

Protected customer data:

- Generally product data, not customer data.

Can it be removed:

- No, unless product/vendor/stock/COGS features are removed.

### `read_inventory`

Why needed:

- Inventory level and inventory item cost data used for stock alerts and COGS.

Feature usage:

- Inventory sync, inventory item cost snapshots, stock alerts, product margin.

Protected customer data:

- Generally inventory/product operational data, not customer data.

Can it be removed:

- No, unless stock alerts and cost/margin reporting are removed or replaced.

### `read_locations`

Why needed:

- Location-level dashboard reporting and permission assignments.

Feature usage:

- Location sync, dashboard filters, location analytics, fixed expenses by location, permissions UI.

Protected customer data:

- Generally store/location operational data, not customer data.

Can it be removed:

- No, location reporting is central to the app.

### `read_users`

Why needed:

- Staff member sync and staff attribution/permissions.

Feature usage:

- `staff_members`, Sales by Staff, permission management staff dropdown, current-user permission matching.

Protected customer data:

- Not customer data, but it is personal data for shop staff/users. Requires minimization and disclosure.

Can it be removed:

- Maybe. If removed, staff reporting and staff-based permission ergonomics need to be reduced to email/manual entry or disabled.

## Install / Reinstall / Uninstall Flow

OAuth flow:

- `shopify.server.ts` uses `shopifyApp` with `authPathPrefix: "/auth"`, Prisma session storage, `AppDistribution.AppStore`, and future expiring offline tokens.
- `/auth/login` uses Shopify login helper.
- `/auth/*` authenticates admin requests and handles callback flow through the Shopify package.

Session creation:

- Sessions are stored in Prisma `Session`.
- Offline clients are created via `unauthenticated.admin(shop)` and depend on stored offline sessions.

Uninstall:

- `webhooks.app.uninstalled.tsx` authenticates the webhook and deletes Prisma sessions for the shop.
- It does not delete Supabase business data.

Shop redaction:

- `webhooks.shop.redact.tsx` authenticates the webhook, deletes shop-scoped Supabase rows, deletes Prisma sessions, and records a minimal compliance audit event.

Reinstall:

- Reinstall should create new sessions through OAuth.
- Existing Supabase analytics may remain if only `app/uninstalled` ran. This likely preserves historical reporting across reinstall, but must be an explicit policy.

Permissions reset/preservation:

- `user_location_access` is preserved on app uninstall.
- It is deleted only by `shop/redact`.
- Marketplace decision needed: preserve permissions for reinstall convenience or reset permissions on reinstall/uninstall for least surprise.

Old data handling:

- Old data remains until explicit shop redaction or manual shop-scoped deletion.
- This is compatible with reinstall continuity only if disclosed and time-bounded as needed.

## App Store Requirements Readiness

Compliance webhooks:

- Present and configured: `customers/data_request`, `customers/redact`, `shop/redact`.
- Operational webhooks are also configured for orders, inventory, and products.

Protected customer data minimization:

- Strong minimization posture for direct customer profile fields.
- Needs documentation for order history, order display names, transaction/refund data, and staff/user fields.

Privacy policy:

- Required. Not found.

Terms of service:

- Required. Not found.

Support email:

- Required for listing. Not found in repo.

Emergency contact:

- Required operationally. Not found in repo.

App icon/listing assets:

- Not found beyond `public/favicon.ico`.

Screenshots:

- Not found.

App listing copy:

- Not found.

Demo store / reviewer flow:

- Demo seed exists at `supabase/seeds/001_staging_demo_data.sql`, but no reviewer flow doc was found.

Billing / pricing flow:

- Not implemented. Should remain disabled until a dedicated implementation branch.

## UX Readiness

First install onboarding:

- Not found. Current `/app` path redirects directly to dashboard.

No data states:

- Partial handling through empty arrays and visible empty components, but no marketplace-grade first-run state was confirmed.

Sync in progress state:

- Sync Center shows active jobs. Dashboard has `lastSuccessfulSync`, but no strong first-run sync progress state was confirmed.

Sync failed state:

- Data Quality and Sync Center expose failed sync runs. Dashboard collects query errors, but user-facing recovery needs review.

Empty dashboard state:

- Needs a dedicated state for no locations, no order lines, no inventory, and no expenses.

Mobile/readability:

- Many routes use wide tables and inline styles. Needs screenshot QA on mobile before submission.

404/500 risks:

- Thrown `Response` errors are used for 403/500. App-level error boundaries exist through Shopify boundary in `app.tsx`, but route-specific marketplace-friendly error pages are limited.

Unauthorized states:

- Admin-only routes throw plain 403 responses. Need branded unauthorized state with next steps.

Admin-only access behavior:

- Navigation hides admin links for non-admins, but direct access throws 403. This is secure, but UX should be improved.

## Internal Routes Security

Current status:

- `/internal/cron/process-webhook-events` requires `Authorization: Bearer ${CRON_SECRET}`.
- `/internal/financial-backfill-30d` requires `Authorization: Bearer ${CRON_SECRET}`.
- If `CRON_SECRET` is unset, both endpoints deny access.

Risks:

- The endpoints are publicly routable URLs guarded by bearer secret only.
- Need documented secret length, storage, rotation, and Render cron/header configuration.
- No rate limiting was observed at the app layer.

## Risks

- Scope approval risk: `read_all_orders` and `read_users` may slow App Store review without a polished data-use explanation.
- Privacy risk: preserving Supabase data after uninstall may be acceptable, but it must be disclosed and reconciled with deletion requirements.
- Reviewer risk: without onboarding/demo data, reviewers may see an empty dashboard and reject for incomplete app experience.
- Billing risk: submission cannot proceed as a paid public app without a billing implementation.
- Operational risk: internal endpoints depend on `CRON_SECRET`; a missing secret disables processing, and a leaked secret permits internal processing calls.
- Production risk: current production Shopify config points at the client production Render app. Marketplace work should use a separate app/config until ready.

## Test Plan

Manual route/auth tests:

- Install on a staging/demo shop.
- Visit `/`, `/auth/login`, `/app`, `/app/db-dashboard`, `/app/locations`, `/app/data-quality`, `/app/admin/expenses`, `/app/admin/permissions`, `/app/admin/sync`, `/app/admin/financial-qa`.
- Verify admin can access admin routes.
- Verify viewer can access only intended viewer routes.
- Verify direct admin route access by viewer returns a clear 403 state after UX fix.

Shop isolation tests:

- Seed or sync two shops.
- Confirm dashboard, locations, expenses, permissions, sync monitor, data quality, and financial QA never show cross-shop records.
- Run order/product/inventory webhook processing for one shop and verify only that shop changes.

Install lifecycle tests:

- Fresh install creates sessions.
- First dashboard load with no data shows onboarding/empty state.
- Uninstall deletes Prisma sessions.
- Reinstall behavior matches documented retention policy.
- `shop/redact` deletes only the requested shop's Supabase data and sessions.

Webhook tests:

- Valid Shopify webhooks return 200 and enqueue/process expected events.
- Invalid webhook signatures are rejected by `authenticate.webhook`.
- Compliance webhooks record safe audit events and do not log raw customer contact data.

Internal endpoint tests:

- No `CRON_SECRET`: internal endpoints return 401.
- Missing/incorrect bearer token returns 401.
- Correct bearer token processes expected work.
- GET `/internal/financial-backfill-30d` returns 405 after auth.

Scope/data tests:

- Inventory/product/order/staff sync succeeds with current scopes.
- Remove or simulate missing `read_users` and confirm graceful degradation plan if scope is optionalized later.
- Confirm `read_all_orders` is required only for historical backfill/reporting.

UX tests:

- Empty shop.
- Sync running.
- Sync failed.
- No assigned locations.
- Mobile and narrow iframe widths.
- Broken Supabase connection.
- Expired session / OAuth reauth.

## Files Inspected

- `package.json`
- `README.md`
- `docs/current-status.md`
- `docs/operations/sync-and-backfill.md`
- `shopify.app.store-dashboard.toml`
- `shopify.app.store-dashboard-staging.toml`
- `shopify.web.toml`
- `prisma/schema.prisma`
- `app/shopify.server.ts`
- `app/root.tsx`
- `app/routes.ts`
- `app/routes/_index/route.tsx`
- `app/routes/auth.$.tsx`
- `app/routes/auth.login/route.tsx`
- `app/routes/auth.login/error.server.tsx`
- `app/routes/app.tsx`
- `app/routes/app._index.tsx`
- `app/routes/app.db-dashboard.tsx`
- `app/routes/app.live-dashboard.tsx`
- `app/routes/app.locations.tsx`
- `app/routes/app.data-quality.tsx`
- `app/routes/app.admin.expenses.tsx`
- `app/routes/app.admin.permissions.tsx`
- `app/routes/app.admin.sync.tsx`
- `app/routes/app.admin.financial-qa.tsx`
- `app/routes/app.admin.sync-inventory.tsx`
- `app/routes/app.admin.sync-locations.tsx`
- `app/routes/app.admin.sync-orders.tsx`
- `app/routes/app.admin.sync-products.tsx`
- `app/routes/internal.cron.process-webhook-events.tsx`
- `app/routes/internal.financial-backfill-30d.tsx`
- `app/routes/webhooks.app.uninstalled.tsx`
- `app/routes/webhooks.app.scopes_update.tsx`
- `app/routes/webhooks.customers.data_request.tsx`
- `app/routes/webhooks.customers.redact.tsx`
- `app/routes/webhooks.shop.redact.tsx`
- `app/routes/webhooks.orders.create.tsx`
- `app/routes/webhooks.orders.updated.tsx`
- `app/routes/webhooks.products.create.tsx`
- `app/routes/webhooks.products.update.tsx`
- `app/routes/webhooks.products.delete.tsx`
- `app/routes/webhooks.inventory-levels.update.tsx`
- `app/routes/webhooks.inventory-items.update.tsx`
- `app/lib/auth/permissions.server.ts`
- `app/lib/compliance/compliance-webhooks.server.ts`
- `app/lib/db/supabase.server.ts`
- `app/lib/shopify/offline-admin.server.ts`
- `app/lib/sync/shopify-sync.server.ts`
- `app/lib/sync/sync-jobs.server.ts`
- `app/lib/sync/webhook-events-processor.server.ts`
- `app/lib/webhooks/webhook-events.server.ts`
- `supabase/migrations/001_initial_business_schema.sql`
- `supabase/migrations/20260517_add_sync_run_details.sql`
- `supabase/migrations/20260520_add_staff_members_and_staff_attribution.sql`
- `supabase/migrations/20260527_add_inventory_items_cost_snapshots.sql`
- `supabase/migrations/20260527_add_sync_jobs.sql`
- `supabase/migrations/20260531_add_bulk_cogs_recompute.sql`
- `supabase/migrations/20260601_add_compliance_webhook_events.sql`
- `supabase/migrations/20260601_add_data_quality_report.sql`
- `supabase/migrations/20260616_add_operational_webhook_events.sql`
- `supabase/migrations/20260618_add_order_financial_fields.sql`
- `supabase/migrations/20260618_add_orders_reconciliation_48h_job.sql`
- `supabase/migrations/20260618_add_financial_backfill_30d_job_type.sql`
- `supabase/seeds/001_staging_demo_data.sql`

## Findings

Blockers:

- Missing legal/support/listing/reviewer artifacts.
- Billing/pricing not implemented.
- `read_all_orders` and `read_users` need formal justification and minimization docs.
- Uninstall/reinstall data retention policy is implicit, not explicit.
- First-install and no-data UX is not marketplace-ready.

Security / isolation:

- App routes are authenticated.
- Admin routes are protected with `assertAdminAccess`.
- Viewer access is limited to `/app/db-dashboard`.
- Webhooks authenticate through Shopify package.
- Internal endpoints require `CRON_SECRET`.
- Multi-shop data access is generally scoped correctly.

Operational:

- Production Shopify config points to the existing client production Render URL. Marketplace config should be separated before submission work.
- Sync architecture is service-role based and depends on careful app-level scoping.
- Compliance webhook handlers exist and are a strong starting point.

Recommended next branch:

- `marketplace/readiness-phase-1-docs-legal-onboarding`

No production-impacting changes:

- This audit created documentation only.
- No app behavior changed.
- No production config changed.
- No Shopify production config changed.
- No Render env vars changed.
- No database schema changed.
- No webhook behavior changed.
- Billing was not enabled.
- Marketplace mode was not enabled by default.
