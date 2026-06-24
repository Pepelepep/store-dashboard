# Marketplace Checklist

Draft status: marketplace preparation checklist.

## Product Readiness

- [ ] Confirm app name: ShopOps Studio.
- [ ] Approve target launch strategy: private, unlisted, or public App Store.
- [ ] Decide whether `/app/locations` should remain admin-only or become viewer-accessible.
- [ ] Decide first-install onboarding requirements.
- [ ] Confirm Data Health is the marketplace-facing report trust page.
- [ ] Confirm Sync Center remains admin/support diagnostic and hidden from main navigation.
- [ ] Confirm financial metrics disclaimers.
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
- [ ] Confirm operational webhook payload retention policy.
- [ ] Confirm support workflow avoids unnecessary customer personal data.
- [ ] Validate compliance webhook behavior in staging.

## Shopify Config

- [ ] Create marketplace-specific Shopify config separate from client production config.
- [ ] Confirm OAuth redirect URLs for marketplace app.
- [ ] Confirm webhook subscriptions.
- [ ] Confirm compliance webhook URLs.
- [ ] Confirm `read_all_orders` decision.
- [ ] Confirm `read_users` decision.
- [ ] Prepare scope justification for Shopify review.
- [ ] Confirm App Store contact metadata.
- [ ] Do not modify production Shopify config during prep.

## Billing

- [ ] Decide free, paid, beta, or trial launch strategy.
- [ ] Design pricing model.
- [ ] Implement billing in a separate branch only.
- [ ] Keep billing disabled until tested.
- [ ] Add cancellation handling.
- [ ] Add billing reviewer instructions.
- [ ] Confirm terms include pricing/refund language before paid launch.

## Listing Assets

- [ ] Final app icon.
- [ ] Dashboard screenshot.
- [ ] Locations screenshot.
- [ ] Data Health screenshot.
- [ ] Sync Center screenshot only if needed for admin/support diagnostics.
- [ ] Permissions screenshot.
- [ ] Expenses screenshot.
- [ ] First-run onboarding screenshot.
- [ ] Final tagline.
- [ ] Final short description.
- [ ] Final long description.
- [ ] Final FAQ.
- [x] Final support URL/email implemented for preview: `https://shopops-marketplace-preview.onrender.com/support`, `support@shopopsstudio.com`.
- [x] Final privacy policy URL implemented for preview: `https://shopops-marketplace-preview.onrender.com/privacy`.
- [x] Final terms URL implemented for preview: `https://shopops-marketplace-preview.onrender.com/terms`.

## Reviewer Testing

- [ ] Prepare test shop.
- [ ] Seed or sync demo data.
- [ ] Include discounts, refunds, returns, products, vendors, SKUs, inventory, locations, staff, and expenses.
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
