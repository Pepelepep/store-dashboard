# Marketplace Environment Setup

Draft status: marketplace setup plan. Do not use current client production infrastructure for marketplace review.

## Objective

Prepare a dedicated marketplace environment for ShopOps Studio that is separate from the current client production app. The marketplace environment should support Shopify review, demo data, screenshots, and pre-launch QA without changing current client production Shopify config, Render env vars, or database schema.

## Required Service Separation

Render service:

- Use the existing dedicated Render service for marketplace review and production.
- Do not reuse the current client production Render service.
- Production URL, confirmed final 2026-08-19 (no custom domain planned for now):
  `https://shopops-marketplace-preview.onrender.com`.
- Deploys from `marketplace/stable-prep` with auto-deploy on every commit (verified live).
- Confirm Node version matches `package.json` engine constraints.

Shopify app:

- Use the existing ShopOps Studio Marketplace registration with canonical handle `shopops-studio` for the pre-launch Render preview and future public production release.
- Do not create or require a separate staging Shopify registration during pre-launch.
- Use `shopify.app.shopops-marketplace.toml` only for this marketplace app.
- Do not deploy marketplace config to `shopify.app.store-dashboard.toml`.
- Do not deploy marketplace config to `shopify.app.store-dashboard-staging.toml` unless intentionally testing a separate staging app.

Supabase/database:

- Preferred: create a dedicated Supabase project/database for marketplace demo and review.
- Alternative: use the existing database only with strict tenant safeguards and a demo shop domain that cannot collide with client production data.
- Do not use current client production data for reviewer testing or screenshots.
- Do not run destructive demo seeds against a production shop domain.

## Required Environment Variables

Marketplace Render service should define:

- `SHOPIFY_API_KEY`: marketplace app API key.
- `SHOPIFY_API_SECRET`: marketplace app API secret.
- `SHOPIFY_APP_URL`: final marketplace Render URL.
- `SCOPES`: scope list aligned with marketplace Shopify config.
- `DATABASE_URL`: dedicated marketplace Prisma/session database URL.
- `SUPABASE_URL`: dedicated marketplace Supabase URL.
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`: service-role key for marketplace Supabase.
- `CRON_SECRET`: strong unique marketplace secret for internal cron endpoints.
- `FINANCIAL_METRICS_VERSION`: recommended `v2` for marketplace review if the demo data and sync path support current financial fields.
- `ADMIN_EMAILS`: reviewer/admin bootstrap email list for the demo shop.
- `ADMIN_SHOPIFY_USER_IDS`: optional bootstrap user IDs for reviewer/admin access.
- `BILLING_ENABLED`: use `false` only for local, non-production development. It must be `true` in marketplace preview and final production.
- `SHOPIFY_PARTNER_ORG_ID`: Partner organization ID used in the Partner API endpoint. Required only when billing is enabled.
- `SHOPIFY_PARTNER_ACCESS_TOKEN`: server-only Partner API token with Manage apps access. Required only when billing is enabled; never expose it to the browser or logs.
- `SHOPIFY_PARTNER_APP_GID`: Shopify App GID for the canonical `shopops-studio` Marketplace registration. It must identify the same registration as the Marketplace TOML client ID and hosted pricing handle. Required only when billing is enabled.
- `SHOPIFY_PARTNER_API_VERSION`: must be `2026-07` when billing is enabled.
- `SHOPIFY_APP_HANDLE`: must be the canonical Marketplace handle `shopops-studio` when billing is enabled.
- `SHOP_CUSTOM_DOMAIN`: only if the marketplace app needs a custom shop domain. Leave unset by default.

Do not copy current client production secrets into the marketplace environment.

## Billing Configuration

Billing uses Shopify App Pricing only. Do not configure Stripe, create recurring charges from the app, or add an application-owned cancellation flow.

Partner Dashboard plans and application capacity:

| Plan           | Handle           | Monthly price | Trial   | Reporting locations | ShopOps users | Availability                                 |
| -------------- | ---------------- | ------------: | ------- | ------------------: | ------------: | -------------------------------------------- |
| Solo           | `solo`           |       $19 USD | 14 days |                   1 |             1 | Public                                       |
| Growth         | `growth`         |       $49 USD | 14 days |                   5 |             5 | Public                                       |
| Multi-location | `multi-location` |       $99 USD | 14 days |                  10 |     Unlimited | Public                                       |
| QA Pilot       | `qa-pilot`       |            $0 | None    |           Unmetered |     Unmetered | Private; explicitly authorized QA shops only |

All Shopify App Pricing plans must use `/app/billing/complete` as their welcome link. Prices, trials, and public/private visibility are configured in Shopify rather than application code. The application catalog owns only the exact handle-to-entitlement mapping. `qa-pilot` is recognized so authorized preview and review shops can use it, but the application does not render a local plan list; Shopify must keep it in the private-plan section.

Runtime behavior:

- Local development with `NODE_ENV` other than `production` may use `BILLING_ENABLED=false`. Partner API variables are then optional, no Partner lookup is made, and billing entitlements are not enforced.
- A production-mode runtime with missing or false `BILLING_ENABLED` fails closed as billing temporarily unavailable. Marketplace preview and final production must set it to `true`; there is no production billing bypass.
- When `BILLING_ENABLED=true`, the app verifies the authenticated shop's current subscription through Partner API version `2026-07` before granting access or accepting a plan-sensitive increase.
- Shops without a recognized active plan are sent to the billing-required state. Trials remain accessible, and cancel-at-end-of-cycle plans remain accessible through their effective cycle.
- Temporary Partner API failures produce a retryable billing-unavailable state and never classify the merchant as unpaid.
- There is no environment-variable billing bypass. QA access uses Shopify's private, store-restricted `qa-pilot` plan on the current Marketplace registration; Shopify must limit that plan to authorized QA stores.

Environment matrix:

| Environment               | `NODE_ENV`     | `BILLING_ENABLED` | App identity and offer expectations                                                                                                                                                                                     |
| ------------------------- | -------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local development         | Non-production | `false` allowed   | No Partner credentials required. Use only for local work; access is intentionally ungated.                                                                                                                              |
| Render (pre-launch QA and production) | `production`   | `true` required   | Uses the canonical `shopops-studio` Marketplace client ID, app GID, and handle. Confirmed 2026-08-19: this is the same Render service and hostname for both pre-launch QA and public production — there is no separate "final" hosting URL to switch to. MyShop may use the private, store-restricted QA Pilot; only Solo, Growth, and Multi-location are public offers. |

Source of truth and lifecycle:

- Each protected request reads the active Shopify App Pricing subscription through the Partner API, subject to a 30-second in-memory cache. There is no persisted local subscription or plan-authority field.
- The Marketplace TOML client ID, strict `shopops-studio` handle validation, Partner API app GID, and hosted pricing URL must form one configured Shopify app identity. The current Render preview is hosting topology, not a second Shopify registration.
- Entitlement-changing actions bypass that cache and refresh Shopify before applying capacity limits in the existing transactional database functions.
- The authenticated Shopify shop GID and canonical shop domain must match the Partner API response.
- `activeSubscription: null` means no active contract and produces the plan-required state. Unknown or multiple handles produce the unsupported-plan state. Malformed responses and Partner authentication, throttling, network, or service failures produce the retryable unavailable state.
- An active trial remains accessible through `trialEndsAt`. A cancel-at-end subscription remains accessible through its current cycle. When Shopify no longer returns an active subscription, access is gated after the next authoritative read.
- Uninstall deletes Shopify sessions and invalidates the shop's in-memory billing cache. Reinstall must authenticate again and cannot reuse the prior cached paid state.
- Shopify App Pricing appends `plan_handle` to the welcome link; it does not provide an application callback nonce. The return route requires an authenticated Shopify owner, refreshes `activeSubscription`, and accepts the return only when the authoritative handle matches. The redirect destination is a fixed internal Settings path, so replay does not create or assign a subscription.

Partner Dashboard checks requiring human verification:

- Confirm the three public handles, display names, USD monthly prices, 14-day trials, and `/app/billing/complete` welcome links exactly match the table.
- Confirm QA Pilot is a $0 private plan on the current Marketplace registration, is absent from every public listing, and contains only intended preview/review shop domains.
- Confirm the Partner API client has Manage apps access and API version `2026-07` is available for `activeSubscription`.
- Confirm the configured Partner app GID belongs to the same `shopops-studio` registration as client ID `751df93cb283cb05edc5b46b35de06be`, and that Shopify's hosted pricing URL uses the `shopops-studio` handle.
- Confirm the application and auth URLs point to the `shopops-marketplace-preview` Render deployment — confirmed 2026-08-19 as the permanent production hosting, not a placeholder to be swapped later.
- Exercise initial selection, all three paid plans, private QA activation, trial display, upgrade, downgrade, cancellation, callback retry, uninstall/reinstall, and a temporary Partner API failure in test stores without using live service calls in automated tests.

## Future Post-Launch Topology (Not Implemented)

- `shopops-studio` will be the public production Marketplace app.
- A separate internal `ShopOps Studio Staging` Shopify app registration will be created later and linked to its own TOML, credentials, Render staging service, and staging database.
- MyShop will move to that staging registration only after the staging topology exists.
- The staging handle must come from the actual future Shopify registration. No staging handle is assumed or hard-coded now.
- This phase does not create or delete Shopify registrations, Render services, databases, or Git branches.
- `marketplace/stable-prep` remains the single release-candidate branch until V1 is frozen.
- After V1 is frozen, the release-candidate branch becomes `marketplace/stable`, and `marketplace/develop` is created for ongoing development.

## Financial Metrics Version Guidance

Recommended:

- Use `FINANCIAL_METRICS_VERSION=v2` for marketplace review if demo orders include discounts, refunds, returns, and transaction data.

Fallback:

- Use legacy only if v2 fields are not populated in the marketplace demo environment.

Review note:

- The app is operational reporting, not accounting, tax, payroll, or legal advice. Demo flows should make clear that merchants validate financial reports before business use.

## CRON_SECRET Guidance

`CRON_SECRET` protects:

- `/internal/cron/process-sync-jobs`
- `/internal/cron/process-webhook-events`
- `/internal/financial-backfill-30d`

Requirements:

- Generate a unique high-entropy secret for marketplace review.
- Store it only in Render/environment secret storage.
- Do not commit it.
- Do not share it with reviewers.
- Rotate it if exposed.

Cron/review note:

- Marketplace review should not require reviewers to call internal cron endpoints.
- Sync Center can queue manual marketplace sync jobs and optionally process queued jobs now for admin troubleshooting.
- Manual sync requests are processed by the background sync worker; webhooks are only for future Shopify changes after data has synced.

## Render Cron Requirements

Superseded: see `RENDER_CRON_SETUP.md` for the current single-job setup
(`shopops-maintenance-tick`, every minute, `POST /internal/cron/maintenance-tick`).

The two-endpoint scheme below (`process-sync-jobs` + `process-webhook-events`)
is kept only for historical reference. Do not schedule it alongside
`shopops-maintenance-tick` — the endpoints remain temporarily compatible but
should not both be triggered by Render Cron at the same time.

1. Sync jobs processor
   - Route: `/internal/cron/process-sync-jobs`
   - Method: `POST` preferred; `GET` acceptable if matching the existing cron style.
   - Header: `Authorization: Bearer <cron secret>`
   - Frequency: every 5 minutes.
   - Purpose: processes queued `sync_jobs` for manual sync/backfill of locations, products, inventory, orders, and full refresh jobs.

2. Webhook events processor
   - Route: `/internal/cron/process-webhook-events`
   - Method: `POST` preferred; `GET` acceptable if matching the existing cron style.
   - Header: `Authorization: Bearer <cron secret>`
   - Frequency: every 5 minutes.
   - Purpose: processes queued Shopify webhook events for future changes.

## Shopify Config Guidance

Use:

- `shopify.app.shopops-marketplace.toml`

Do not alter:

- `shopify.app.store-dashboard.toml`
- `shopify.app.store-dashboard-staging.toml`
- `shopify.web.toml`

Current pre-launch values in `shopify.app.shopops-marketplace.toml`:

- Client ID: `751df93cb283cb05edc5b46b35de06be`
- App name: `ShopOps Studio`
- Canonical handle: `shopops-studio`
- Temporary application URL: `https://shopops-marketplace-preview.onrender.com`
- OAuth redirect URLs use that same Render host, confirmed permanent.

Before public launch, verify the application URL, OAuth redirect URLs, operational webhook URLs, and compliance webhook URLs use the approved production host. Do not change the canonical handle or substitute an unrelated client ID or Partner app GID.

App distribution:

- Runtime code currently uses `AppDistribution.AppStore` in `app/shopify.server.ts`.
- Do not change runtime distribution behavior in this phase.

Embedded app:

- Marketplace config should keep `embedded = true`.

## Scope Decision Table

| Scope             | Current recommendation        | Review risk                                              | MVP decision needed                         | Fallback                                                           |
| ----------------- | ----------------------------- | -------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `read_orders`     | Keep                          | High because order history can be sensitive              | No removal recommended                      | App cannot provide core sales/margin reporting                     |
| `read_all_orders` | Keep                          | High; historical order access can slow review            | Keep for historical analytics and backfills | Limit historical reporting to accessible recent/order-forward data |
| `read_products`   | Keep                          | Low customer-data risk                                   | No removal recommended                      | Product/vendor/SKU reporting and joins degrade sharply             |
| `read_inventory`  | Keep                          | Low customer-data risk, medium merchant cost sensitivity | No removal recommended                      | Disable stock alerts and cost/margin context                       |
| `read_locations`  | Keep                          | Low customer-data risk                                   | No removal recommended                      | Remove location reporting and location permissions                 |
| `read_users`      | Do not request for public app | N/A for public App Store apps                            | Public app uses manual email permissions    | Future/custom/Plus-only staff directory sync                       |

Current recommendation:

- Public marketplace `SCOPES` must be `read_orders,read_all_orders,read_products,read_inventory,read_locations`.
- Do not include `read_users` in the public marketplace app. Shopify Partner Support confirmed it is unavailable for public App Store apps.
- Permissions use the currently logged-in Shopify staff identity from the embedded app session where available plus ShopOps Studio DB assignments in `user_location_access`.
- Merchant admins manage location access by manually entering staff emails.
- Staff sales attribution is best-effort based on available Shopify order/session data.
- Advanced Shopify staff directory sync is future-only for custom, Plus, or Advanced implementations.

Data field notes:

- No individual protected customer field access is needed because customer name, address, email, and phone are not displayed or stored in reporting tables.
- `orders.shipping` is a shipping amount, not a customer shipping address.
- `orders.staff_member_email`, `order_lines.staff_member_email`, and `user_location_access.user_email` are staff/app permission fields, not customer email fields.

Compliance webhook behavior:

- `customers/data_request`, `customers/redact`, and `shop/redact` are registered in marketplace config.
- Each compliance webhook route validates Shopify HMAC through Shopify webhook authentication.
- Valid compliance webhook requests return 200.
- Invalid HMAC requests return 401.

## No Client Production Data

Marketplace review must avoid:

- Current client production Shopify shop data.
- Current client production Render service.
- Current client production database credentials.
- Screenshots containing real client orders, staff, products, sales, costs, or expenses.

Use demo/fake data only.

## Pre-Review Environment Checklist

Status verified 2026-08-19, first from the repo alone, then cross-checked live against the Render
dashboard (`shopops-marketplace-preview` service and `shopops-maintenance-tick` cron job) — see
`PRE_SUBMISSION_AUDIT_2026-08-19.md`. Items below are checked only where actually verified;
everything else needs manual confirmation from the owner.

- [ ] Dedicated Shopify marketplace app created. **Not verifiable from repo/Render — Partner Dashboard state, manual confirmation required.**
- [x] Dedicated Render marketplace service created. **Verified live 2026-08-19**: `shopops-marketplace-preview` (Node, Oregon, Starter plan) exists as its own service, separate from the client-production service, auto-deploys on every commit, and its deploy history matches `origin/marketplace/stable-prep` commit-for-commit (currently live at `037ae6c`). No second service is needed.
- [ ] Dedicated Supabase/database environment created or tenant safeguards approved. **Not verifiable from repo/Render dashboard (would require the Supabase project directly) — manual confirmation required.**
- [ ] Marketplace env vars configured. Confirmed the Render service has an environment variables section populated (names not inspected — secrets), but which exact vars/values are set is **not verifiable this way — manual confirmation required.**
- [x] `shopify.app.shopops-marketplace.toml` hostname confirmed acceptable as final. Still on `shopops-marketplace-preview.onrender.com` (application_url + all 3 redirect URLs) as of 2026-08-19 — this is a real, live, dedicated Render service (see above), and Shopify App Store submission does not require a custom domain. Owner confirmed (2026-08-19) no hostname change is needed; a custom domain is optional/cheap later (Render includes custom domains on paid plans at no extra platform cost — only domain registration itself costs money) but not required now.
- [ ] Compliance webhooks registered. Toml declares all 3 compliance topics (`customers/data_request`, `customers/redact`, `shop/redact`) under `api_version = "2026-07"` — config-level presence confirmed, but live Partner Dashboard registration is not verifiable from the repo or Render.
- [ ] Operational webhooks registered. Toml declares all 6 operational topics — same caveat as above.
- [ ] Reviewer/admin bootstrap access configured. **Not verifiable from repo/Render — manual confirmation required.**
- [ ] Demo data loaded or synced. A seed script exists (`supabase/seeds/001_staging_demo_data.sql`), but whether it has actually been loaded into any live environment is not verifiable from here.
- [ ] Sync Center shows successful sync state or expected first-run state. **Not verifiable without signing into the running app — manual confirmation required.**

**Note, unrelated to this checklist's original items**: the `shopops-maintenance-tick` Render cron
job — described below as running every minute — has been suspended since 2026-08-08 23:21 EDT
(the owner suspended it directly; confirmed via Render's own event log). Owner confirmed 2026-08-19
this is intentional: it will be resumed once the preview is validated and the app actually goes to
production, not before.
- [x] Screenshots captured from demo data only. Verified 2026-08-19: `public/marketplace/screenshots/2026-08-final/` contains exactly 11 PNG files, each confirmed exactly 1600×900 pixels via `file`.
