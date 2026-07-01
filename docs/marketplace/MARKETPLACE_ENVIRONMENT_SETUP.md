# Marketplace Environment Setup

Draft status: marketplace setup plan. Do not use current client production infrastructure for marketplace review.

## Objective

Prepare a dedicated marketplace environment for ShopOps Studio that is separate from the current client production app. The marketplace environment should support Shopify review, demo data, screenshots, and pre-launch QA without changing current client production Shopify config, Render env vars, or database schema.

## Required Service Separation

Render service:

- Create a dedicated Render service for marketplace review.
- Do not reuse the current client production Render service.
- Recommended placeholder URL: `https://TODO_MARKETPLACE_APP_URL`.
- Configure deploys from the marketplace branch or a controlled marketplace release branch.
- Confirm Node version matches `package.json` engine constraints.

Shopify app:

- Create a dedicated Shopify Partner app for marketplace review.
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
- `BILLING_ENABLED`: set to `false` by default. Set to `true` only for final billing review.
- `BILLING_TEST_SHOPS`: comma-separated dev or reviewer shop domains that may bypass the billing gate while billing is enabled.
- `SHOP_CUSTOM_DOMAIN`: only if the marketplace app needs a custom shop domain. Leave unset by default.

Do not copy current client production secrets into the marketplace environment.

## Billing Configuration

Billing uses Shopify App Store managed pricing only. Do not configure Stripe or external billing for marketplace review.

Initial public plan:

- ShopOps Studio: `$59.99/month`
- Free trial: 14 days

Runtime behavior:

- Keep `BILLING_ENABLED=false` until final review.
- When `BILLING_ENABLED=false`, app access is not blocked.
- When `BILLING_ENABLED=true`, shops without an active Shopify managed subscription are sent to the billing-required state.
- Shops listed in `BILLING_TEST_SHOPS` bypass the billing gate for dev and reviewer testing.

Future pricing draft:

- Starter: `$39.99/month`
- Growth: `$99.99/month`
- Pro: `$199.99/month`

## Financial Metrics Version Guidance

Recommended:

- Use `FINANCIAL_METRICS_VERSION=v2` for marketplace review if demo orders include discounts, refunds, returns, and transaction data.

Fallback:

- Use legacy only if v2 fields are not populated in the marketplace demo environment.

Review note:

- The app is operational reporting, not accounting, tax, payroll, or legal advice. Demo flows should make clear that merchants validate financial reports before business use.

## CRON_SECRET Guidance

`CRON_SECRET` protects:

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
- Sync Center is monitoring-only and must not expose reviewer-facing full sync triggers.

## Shopify Config Guidance

Use:

- `shopify.app.shopops-marketplace.toml`

Do not alter:

- `shopify.app.store-dashboard.toml`
- `shopify.app.store-dashboard-staging.toml`
- `shopify.web.toml`

Before deploy, replace placeholders in `shopify.app.shopops-marketplace.toml`:

- `TODO_MARKETPLACE_CLIENT_ID`
- `https://TODO_MARKETPLACE_APP_URL`
- final app name/handle if Shopify Partner Dashboard differs
- OAuth redirect URLs
- operational webhook URLs through `application_url`
- compliance webhook URLs through `application_url`

App distribution:

- Runtime code currently uses `AppDistribution.AppStore` in `app/shopify.server.ts`.
- Do not change runtime distribution behavior in this phase.

Embedded app:

- Marketplace config should keep `embedded = true`.

## Scope Decision Table

| Scope | Current recommendation | Review risk | MVP decision needed | Fallback |
|---|---|---|---|---|
| `read_orders` | Keep | High because order history can be sensitive | No removal recommended | App cannot provide core sales/margin reporting |
| `read_all_orders` | Keep | High; historical order access can slow review | Keep for historical analytics and backfills | Limit historical reporting to accessible recent/order-forward data |
| `read_products` | Keep | Low customer-data risk | No removal recommended | Product/vendor/SKU reporting and joins degrade sharply |
| `read_inventory` | Keep | Low customer-data risk, medium merchant cost sensitivity | No removal recommended | Disable stock alerts and cost/margin context |
| `read_locations` | Keep | Low customer-data risk | No removal recommended | Remove location reporting and location permissions |
| `read_users` | Do not request for public app | N/A for public App Store apps | Public app uses manual email permissions | Future/custom/Plus-only staff directory sync |

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

- [ ] Dedicated Shopify marketplace app created.
- [ ] Dedicated Render marketplace service created.
- [ ] Dedicated Supabase/database environment created or tenant safeguards approved.
- [ ] Marketplace env vars configured.
- [ ] `shopify.app.shopops-marketplace.toml` placeholders replaced.
- [ ] Compliance webhooks registered.
- [ ] Operational webhooks registered.
- [ ] Reviewer/admin bootstrap access configured.
- [ ] Demo data loaded or synced.
- [ ] Sync Center shows successful sync state or expected first-run state.
- [ ] Screenshots captured from demo data only.
