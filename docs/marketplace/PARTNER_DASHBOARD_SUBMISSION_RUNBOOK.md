# Partner Dashboard Submission Runbook

Status: final-preparation runbook for the first ShopOps Studio public App Store submission.

Do not submit until every item marked **manual proof required** has been completed. Public distribution is selected on the production Marketplace registration and cannot later be changed to Custom distribution.

## 1. Canonical Registration

Use the dedicated Marketplace registration only:

| Field | Value |
|---|---|
| App name | `ShopOps Studio` |
| Client ID | `751df93cb283cb05edc5b46b35de06be` |
| Handle | `shopops-studio` |
| App URL | `https://shopops-marketplace-preview.onrender.com` |
| Embedded app | Yes |
| Distribution | Public / Shopify App Store |
| Primary language | English |

Before launch, replace the temporary Render preview hostname with the final production hostname everywhere if a permanent domain is adopted. Do not mix this registration with the existing client production or staging registrations.

## 2. Configuration

App URLs:

- App URL: `https://shopops-marketplace-preview.onrender.com`
- Allowed redirect URLs:
  - `https://shopops-marketplace-preview.onrender.com/auth/callback`
  - `https://shopops-marketplace-preview.onrender.com/auth/shopify/callback`
  - `https://shopops-marketplace-preview.onrender.com/api/auth/callback`

Public URLs:

- Website: `https://shopops-marketplace-preview.onrender.com/`
- Privacy policy: `https://shopops-marketplace-preview.onrender.com/privacy`
- Terms: `https://shopops-marketplace-preview.onrender.com/terms`
- Support: `https://shopops-marketplace-preview.onrender.com/support`
- Support email: `support@shopopsstudio.com`
- API contact email: `support@shopopsstudio.com`

Required manual contacts:

- **Manual proof required:** confirm the submission email is monitored and allow-list `noreply@shopify.com`.
- **Manual input required:** emergency developer email.
- **Manual input required:** emergency developer phone number.
- **Manual proof required:** verify the support mailbox can send and receive messages from outside the organization.

App icon:

- Submission-ready candidate: `public/marketplace/shopops-studio-app-icon-1200.png`.
- 1200 × 1200 PNG or JPEG.
- No Shopify logo or trademark as the app brand.
- No pricing, discount, review, rating, statistic, or unsupported claim.
- **Manual proof required:** approve the candidate visually, then upload it to the canonical Marketplace registration.

## 3. API Access and Webhooks

Requested scopes:

`read_orders,read_all_orders,read_products,read_inventory,read_locations`

Do not request `read_users` for the public app.

`read_all_orders` justification:

> ShopOps Studio provides historical sales, margin, COGS, discount, refund, return, vendor, product and location reporting. Merchants need to backfill and compare reporting periods beyond Shopify's standard recent-order window after installation. Historical orders are used only for the installing merchant's operational reporting, are isolated by shop, and are not sold or used for third-party marketing.

Protected Customer Data declaration:

- Declare access to order data and the reporting purposes described in `PROTECTED_CUSTOMER_DATA_MATRIX.md`.
- Do not claim that order history is non-personal merely because customer contact columns are not stored.
- State that customer name, address, phone and email are not intentionally persisted in reporting tables.
- **Manual proof required:** obtain approval before submission if the dashboard requires a separate protected-data review.

Webhooks, API version `2026-07`:

- `orders/create`
- `orders/updated`
- `products/create`
- `products/update`
- `products/delete`
- `inventory_items/update`
- `inventory_levels/update`
- `customers/data_request`
- `customers/redact`
- `shop/redact`

The three compliance webhooks must be visible on the released production app version. Test valid HMAC delivery and invalid-HMAC 401 behavior before submission.

## 4. Shopify App Pricing

All prices belong only in Shopify App Pricing / Pricing details. Do not put prices in the icon, screenshots, subtitle, feature media, or general description.

Canonical public plans are defined by the deployed Partner configuration and must match `app/lib/billing.server.ts` exactly. For every public plan confirm:

- display name;
- recurring price and currency;
- trial duration;
- plan handle;
- features and limits;
- upgrade and downgrade availability;
- welcome/callback URL;
- visibility to public merchants.

Keep the private QA plan hidden from the public listing.

**Manual proof required:** on a development store in the same Partner organization, test initial approval, welcome redirect, active/trial state, upgrade, downgrade, cancellation, reinstall and Partner API temporary failure. Shopify App Pricing produces zero-effective-price development contracts; do not add a Billing API test flag to this flow.

## 5. Listing Content

Use `LISTING_COPY_DRAFT.md` as the canonical copy source, with these constraints:

- Primary language: English only for first submission.
- Do not list French until the complete merchant UI and support content are translated.
- Keep the subtitle concise and value-led, not keyword-stuffed.
- Do not include prices outside Pricing details.
- Do not use superlatives, guarantees, merchant statistics, reviews or testimonials.
- State that reporting is informational and not accounting, tax, payroll, legal or financial advice.
- State geographic or Shopify-plan limitations only if they genuinely apply.
- Do not select “Merchant must have online store”; ShopOps reporting does not require the Online Store sales channel.

Recommended primary category: Analytics / Store data or the closest current Partner Dashboard reporting category. Select only tags that describe shipped features. Shopify makes the final category decision.

## 6. Media

Create unique screenshots from demo data only. Crop to the app UI; do not include desktop wallpaper, browser chrome, real customer data, pricing, testimonials or unsupported performance claims.

Recommended sequence:

1. Overview — sales and profit KPIs.
2. Compare Locations — manager/admin multi-location comparison.
3. Costs — COGS and operating expense setup.
4. People — role and assigned-location access.
5. Data Health / Sync — report readiness and freshness.

For the People screenshot, never show a Viewer with access-management controls. Viewer behavior must be represented as direct scoped reporting only.

**Manual proof required:** upload final screenshots in the exact dimensions shown by the current listing form and a short review screencast covering install, billing, sync, Viewer, Manager, Admin and Owner behavior.

## 7. Reviewer Instructions

Use `REVIEWER_TEST_SCRIPT.md`, replacing every placeholder before submission. Provide:

- development/demo store;
- install link or dashboard install path;
- test credentials if the reviewer needs a non-Shopify login (none expected here);
- seeded date range containing orders;
- exact steps for initial billing approval;
- expected first-sync duration and what the reviewer should do while it runs;
- role identities or a safe method to demonstrate Viewer, Manager, Admin and Owner;
- short screencast URL;
- support contact for review.

Never provide real merchant/customer data or production client credentials.

## 8. Final Submission Gate

- [ ] Released app version uses the canonical Marketplace client ID and URLs.
- [ ] Render production variables match Marketplace scopes and billing identity.
- [ ] Homepage, privacy, terms and support return HTTP 200 over valid TLS.
- [ ] Compliance webhooks are registered and staging drills pass.
- [ ] Protected Customer Data and `read_all_orders` are approved.
- [ ] Typecheck, lint, P0 tests and production build pass from a clean checkout.
- [ ] Fresh install, OAuth, owner bootstrap, first sync and embedded navigation pass.
- [ ] Viewer, Manager, Admin and Owner matrix passes with server-side URL tampering tests.
- [ ] Shopify App Pricing lifecycle passes.
- [ ] Uninstall deletes sessions; reinstall reauthenticates and refreshes billing.
- [ ] `customers/data_request` is tracked for direct merchant fulfillment within 30 days.
- [ ] `customers/redact` and `shop/redact` complete successfully.
- [ ] Listing copy contains no price outside Pricing details.
- [ ] Icon, screenshots and screencast are final and contain demo data only.
- [ ] Emergency email and phone are entered.
- [ ] Submission email is monitored and `noreply@shopify.com` is allow-listed.

Only after all boxes are checked: run Shopify's automated pre-submission checks and AI self-review, resolve every finding, then submit from App > Distribution.
