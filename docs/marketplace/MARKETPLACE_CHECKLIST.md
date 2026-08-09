# Marketplace Checklist

Draft status: marketplace preparation checklist.

## Phase 7A Status

- [x] Created first-submission-ready listing package for ShopOps Studio.
- [x] Finalized App Store positioning around Shopify reporting, margin, COGS, refunds, discounts, returns, and Data Health.
- [x] Added current public pricing copy: Solo `$19`, Growth `$49`, and Multi-location `$99` USD/month, each with a 14-day free trial.
- [x] Added support, privacy, terms, and support URLs for marketplace preview.
- [x] Added reviewer note for `read_orders`, `read_all_orders`, public-app removal of `read_users`, protected customer/order data processing, shop isolation, and no data sale/third-party marketing sharing.
- [x] Finalized first-submission screenshot sequence.
- [x] Aligned reviewer flow with finalized listing package.
- [ ] Confirm Shopify approval for Protected Customer Data and `read_all_orders`.
- [ ] Capture final screenshots with demo data only.
- [ ] Confirm final Shopify App Store screenshot dimensions.

## Phase 7B Status

- [x] Removed `read_users` from public marketplace scope package.
- [x] Confirmed public App Store permissions use current Shopify session identity plus ShopOps Studio DB assignments.
- [x] Confirmed merchant admins manage access manually with email as the main identity, Shopify user IDs as aliases, and display-only access labels for ID-only access.
- [x] Confirmed staff sales attribution is best-effort based on available order/session data.
- [x] Confirmed staff attribution failures fall back to location/source reporting and do not affect financial totals.
- [x] Kept `staff_members` and staff attribution fields for future custom/Plus support.
- [x] Documented advanced Shopify staff sync as future/custom-only.
- [x] Documented no individual protected customer field access is needed because customer name, address, email, and phone are not displayed or stored.
- [x] Documented `orders.shipping` as a shipping amount, not customer address.
- [x] Documented `staff_member_email` / `user_email` as staff/app permission fields, not customer email fields.
- [x] Verified compliance webhook design: valid HMAC returns 200, invalid HMAC returns 401.
- [ ] Confirm Protected Customer Data Draft review with App Store listing.

## Phase 7E Status

- [x] Added internal sync jobs processor route: `/internal/cron/process-sync-jobs`.
- [x] Reused `CRON_SECRET` bearer authentication for sync jobs processing.
- [x] Confirmed sync jobs worker uses existing sync job logic and `sync_runs` schema without `created_at`.
- [x] Updated Sync Center copy for queued manual sync requests and background worker processing.
- [x] Added admin-only “Process queued jobs now” action in Sync Center.
- [ ] Configure Render Cron for `/internal/cron/process-sync-jobs` every 5 minutes.
- [ ] Confirm pending marketplace sync jobs complete in preview.

## Product Readiness

- [x] Confirm app name: ShopOps Studio.
- [ ] Approve target launch strategy: private, unlisted, or public App Store.
- [x] Finalize role-first Locations behavior: Viewer uses scoped Overview only; Manager compares assigned locations; Admin/Owner compare globally.
- [ ] Decide first-install onboarding requirements.
- [x] Confirm Data Health is the marketplace-facing report trust page.
- [ ] Confirm Sync Center remains admin/support diagnostic and hidden from main navigation.
- [x] Confirm financial metrics disclaimers.
- [ ] Confirm historical reporting expectations.

## UX Readiness

- [x] Add first-run onboarding state. Implemented in `app/routes/app.db-dashboard.tsx` (`showOnboarding` checklist).
- [x] Add empty dashboard state. Implemented (`hasNoSalesForPeriod` → `CompactEmptyDataNotice`).
- [x] Add no locations state. Implemented (`isFirstRunPreparing` → "Your data is being prepared").
- [x] Add no assigned locations state. Implemented (`readiness.noAssignedLocations` → PageNotice).
- [x] Add sync in progress state. Implemented via first-run preparing state above.
- [x] Add sync failed state. Implemented (`syncFailureBanner` → "Reconnect Shopify" PageNotice).
- [x] Add branded unauthorized/admin-only state. Implemented via `RouteErrorNotice`/`PageNotice` in each route's `ErrorBoundary`, not a bare thrown Response.
- [ ] Test mobile and embedded iframe widths.
- [ ] Confirm tables do not break on narrow screens.
- [ ] Confirm 404/500 behavior is acceptable.

## Data / Privacy Readiness

- [x] Privacy URL implemented in marketplace preview: `https://shopops-marketplace-preview.onrender.com/privacy`.
- [x] Terms URL implemented in marketplace preview: `https://shopops-marketplace-preview.onrender.com/terms`.
- [x] Support URL implemented in marketplace preview: `https://shopops-marketplace-preview.onrender.com/support`.
- [x] Public support and privacy/security contact set to `support@shopopsstudio.com`.
- [x] Public expected response time set to within 2 business days; security or privacy requests are prioritized.
- [ ] Legal review privacy policy.
- [ ] Legal review terms of service.
- [x] Approve first-submission data retention policy.
- [x] Set a maximum 30-day accidental-reinstall window, with `shop/redact` deletion taking precedence.
- [x] Preserve permissions only during the recovery window; delete them on `shop/redact`.
- [x] Retain minimal non-contact compliance audit events for one year.
- [ ] Confirm direct customer profile fields are not stored in reporting tables.
- [x] Confirm no customer name, customer email, customer phone, or customer address columns are used in reporting tables.
- [x] Confirm `orders.shipping` is shipping amount only.
- [x] Confirm staff/app email fields are not customer email fields.
- [x] Confirm bounded operational history cleanup and prohibit unnecessary customer contact data in payload history.
- [ ] Confirm support workflow avoids unnecessary customer personal data.
- [ ] Validate compliance webhook behavior in staging.

## Shopify Config

- [x] Create marketplace-specific Shopify config separate from client production config. Confirmed distinct `client_id`/`application_url`/`redirect_urls` across `shopify.app.store-dashboard.toml`, `-staging.toml`, and `shopify.app.shopops-marketplace.toml`.
- [ ] Confirm OAuth redirect URLs for marketplace app.
- [ ] Confirm webhook subscriptions.
- [ ] Confirm compliance webhook URLs.
- [x] Confirm `read_all_orders` decision for first submission.
- [x] Confirm public app does not request `read_users`.
- [x] Prepare scope justification for Shopify review.
- [ ] Confirm App Store contact metadata.
- [ ] Do not modify production Shopify config during prep.

## Billing

- [x] Decide free, paid, beta, or trial launch strategy.
- [x] Design pricing model.
- [x] Implement Shopify App Pricing and authoritative Partner API verification.
- [x] Add active, trial, cancel-at-end, unavailable, and no-subscription handling.
- [ ] Verify the Marketplace TOML client ID, Partner app GID, canonical `shopops-studio` handle, and hosted pricing URL all identify the same Shopify app registration in the pre-launch Render preview and final production.
- [ ] Verify public prices/trials and private QA Pilot visibility in Shopify Partner Dashboard.
- [ ] Complete the billing lifecycle QA matrix in `REVIEWER_FLOW.md`.
- [x] Add billing reviewer instructions.
- [ ] Confirm terms include pricing/refund language before paid launch.

## Listing Assets

- [x] Create a compliant 1200 × 1200 app-icon candidate (`public/marketplace/shopops-studio-app-icon-1200.png`). Final visual approval/upload remains manual.
- [ ] Dashboard screenshot.
- [ ] Locations screenshot.
- [ ] Data Health screenshot.
- [ ] Expenses / COGS screenshot.
- [ ] Permissions screenshot.
- [ ] Billing or first-run onboarding screenshot if needed.
- [ ] Optional Sync Center screenshot only if needed for admin/support diagnostics.
- [x] Final tagline.
- [x] Final short description.
- [x] Final long description.
- [x] Final support URL/email implemented for preview: `https://shopops-marketplace-preview.onrender.com/support`, `support@shopopsstudio.com`.
- [x] Final privacy policy URL implemented for preview: `https://shopops-marketplace-preview.onrender.com/privacy`.
- [x] Final terms URL implemented for preview: `https://shopops-marketplace-preview.onrender.com/terms`.

## Reviewer Testing

- [ ] Prepare test shop.
- [ ] Seed or sync demo data.
- [ ] Include discounts, refunds, returns, products, vendors, SKUs, inventory, locations, best-effort staff attribution, manual email permissions, and expenses.
- [ ] Verify admin reviewer account.
- [ ] Verify viewer/manager test account if needed.
- [ ] Verify install flow.
- [ ] Verify reinstall flow.
- [ ] Verify uninstall flow.
- [ ] Verify compliance webhook handling.
- [ ] Verify reviewer flow document matches actual UI.
- [ ] Verify no production client data is used for screenshots or review.

## Production Rollout

- [ ] Keep marketplace app/config isolated from current client production app.
- [ ] Confirm Render environment separation.
- [ ] Confirm Supabase/database environment separation or tenant safeguards.
- [ ] Confirm `CRON_SECRET` exists and is rotated/stored securely.
- [ ] Configure Render Cron: `POST /internal/cron/process-sync-jobs` with `Authorization: Bearer <cron secret>` every 5 minutes.
- [ ] Configure Render Cron: `POST /internal/cron/process-webhook-events` with `Authorization: Bearer <cron secret>` every 5 minutes.
- [ ] Confirm monitoring and alerting.
- [ ] Confirm rollback plan.
- [ ] Confirm no merge to staging/main/prod until approved.
- [ ] Confirm launch checklist sign-off.
