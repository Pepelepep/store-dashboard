# Marketplace Checklist

Draft status: marketplace preparation checklist.

## Phase 7A Status

- [x] Created first-submission-ready listing package for ShopOps Studio.
- [x] Finalized App Store positioning around Shopify reporting, margin, COGS, refunds, discounts, returns, and Data Health.
- [x] Added first-submission pricing copy: ShopOps Studio, `$59.99/month`, 14-day free trial.
- [x] Added support, privacy, terms, and support URLs for marketplace preview.
- [x] Added reviewer note for `read_orders`, `read_all_orders`, public-app removal of `read_users`, protected customer/order data processing, shop isolation, and no data sale/third-party marketing sharing.
- [x] Finalized first-submission screenshot sequence.
- [x] Aligned reviewer flow with finalized listing package.
- [ ] Confirm Shopify approval for Protected Customer Data and `read_all_orders`.
- [ ] Capture final screenshots with demo data only.
- [ ] Confirm final Shopify App Store screenshot dimensions.

## Phase 7B Status

- [x] Removed `read_users` from public marketplace scope package.
- [x] Confirmed public App Store permissions use current embedded-session staff identity plus ShopOps Studio DB assignments.
- [x] Confirmed merchant admins manage access by manual staff email entry.
- [x] Confirmed staff sales attribution is best-effort based on available order/session data.
- [x] Kept `staff_members` and staff attribution fields for future custom/Plus support.
- [x] Documented advanced Shopify staff sync as future/custom-only.
- [x] Documented no individual protected customer field access is needed because customer name, address, email, and phone are not displayed or stored.
- [x] Documented `orders.shipping` as a shipping amount, not customer address.
- [x] Documented `staff_member_email` / `user_email` as staff/app permission fields, not customer email fields.
- [x] Verified compliance webhook design: valid HMAC returns 200, invalid HMAC returns 401.
- [ ] Confirm Protected Customer Data Draft review with App Store listing.

## Product Readiness

- [x] Confirm app name: ShopOps Studio.
- [ ] Approve target launch strategy: private, unlisted, or public App Store.
- [ ] Decide whether `/app/locations` should remain admin-only or become viewer-accessible.
- [ ] Decide first-install onboarding requirements.
- [x] Confirm Data Health is the marketplace-facing report trust page.
- [ ] Confirm Sync Center remains admin/support diagnostic and hidden from main navigation.
- [x] Confirm financial metrics disclaimers.
- [ ] Confirm historical reporting expectations.

## UX Readiness

- [ ] Add first-run onboarding state.
- [ ] Add empty dashboard state.
- [ ] Add no locations state.
- [ ] Add no assigned locations state.
- [ ] Add sync in progress state.
- [ ] Add sync failed state.
- [ ] Add branded unauthorized/admin-only state.
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
- [ ] Approve data retention policy.
- [ ] Approve 30-day post-uninstall retention or choose alternative.
- [ ] Decide permission preservation vs reset on uninstall.
- [ ] Decide compliance audit event retention window.
- [ ] Confirm direct customer profile fields are not stored in reporting tables.
- [x] Confirm no customer name, customer email, customer phone, or customer address columns are used in reporting tables.
- [x] Confirm `orders.shipping` is shipping amount only.
- [x] Confirm staff/app email fields are not customer email fields.
- [ ] Confirm operational webhook payload retention policy.
- [ ] Confirm support workflow avoids unnecessary customer personal data.
- [ ] Validate compliance webhook behavior in staging.

## Shopify Config

- [ ] Create marketplace-specific Shopify config separate from client production config.
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
- [ ] Implement billing in a separate branch only.
- [ ] Keep billing disabled until tested.
- [ ] Add cancellation handling.
- [x] Add billing reviewer instructions.
- [ ] Confirm terms include pricing/refund language before paid launch.

## Listing Assets

- [ ] Final app icon.
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
- [ ] Confirm monitoring and alerting.
- [ ] Confirm rollback plan.
- [ ] Confirm no merge to staging/main/prod until approved.
- [ ] Confirm launch checklist sign-off.
