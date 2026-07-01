# Screenshot Plan

Status: Phase 7A first-submission screenshot sequence.

## Capture Rules

- Use demo/fake data only.
- Do not use current client production data.
- Do not show real customer names, addresses, phone numbers, emails, or private order details.
- Capture screenshots from the dedicated marketplace/demo environment.
- Keep browser zoom and Shopify admin frame consistent across screenshots.
- Make screenshots match the listing promise: reporting, margin, COGS, refunds, discounts, returns, permissions, and Data Health.
- Treat reports as merchant-facing and informational; do not show copy that implies accounting, tax, legal, payroll, or financial advice.

## Final Screenshot Sequence

1. Dashboard overview
2. Location performance
3. Data Health
4. Expenses / COGS
5. Permissions
6. Billing / onboarding if needed

## Screenshot Details

### 1. Dashboard Overview

Show:

- ShopOps Studio embedded in Shopify admin.
- Date range and location filters.
- Sales, net sales, COGS, gross profit, gross margin, discounts, refunds, returns, expenses, and net profit where available.
- Best sellers, inventory signals, and recent order-line reporting using demo data.

Data requirements:

- At least one selected demo location with non-zero orders.
- Products with SKUs, vendors, and populated costs.
- Demo orders that include discounts, refunds, and returns.

### 2. Location Performance

Show:

- Multiple selected locations.
- Location-level sales, COGS, margin, refunds, returns, discounts, expenses, and net profit context where available.
- Trend or comparison table that makes multi-location reporting clear.

Data requirements:

- At least 3 active demo locations.
- Sales in each location.
- Fixed expenses configured for at least some locations.
- No client production location names.

### 3. Data Health

Show:

- Sync freshness.
- Missing cost checks.
- Product, variant, order, inventory, and location readiness checks.
- Financial completeness signals for COGS, refunds, returns, discounts, and expenses where available.
- Clear merchant-facing readiness language.

Data requirements:

- Mix of healthy and warning demo examples.
- Avoid unresolved failure states unless intentionally used to demonstrate report readiness checks.

### 4. Expenses / COGS

Show:

- Expense management for global and location-specific fixed expenses.
- Product cost or COGS context where visible in the app.
- How expenses and COGS support operational profitability reporting.

Data requirements:

- Fake expense names and amounts.
- Demo products with costs populated.
- No client production expenses.

### 5. Permissions

Show:

- Location-aware access assignment.
- Staff selector or staff list where `read_users` data is available.
- Demo access rules for admin, manager, or viewer roles.

Data requirements:

- Demo staff users only.
- Fake staff emails only.
- At least 2 locations assigned across demo users.

### 6. Billing / Onboarding If Needed

Use only if the submission flow needs a billing or first-run screenshot.

Show:

- ShopOps Studio plan at `$59.99/month`.
- 14-day free trial.
- Shopify managed billing context.
- First-run state that explains reporting becomes useful after sync completes.

Data requirements:

- Billing must be shown only in a marketplace-safe review environment.
- If `BILLING_ENABLED=false`, capture first-run/onboarding instead of billing.

## Optional Internal Screenshot

Sync Center may be captured for internal review or support documentation, but it should not be a primary App Store screenshot unless Shopify review specifically asks to see sync diagnostics.

If captured, show:

- Last successful sync.
- Record counts.
- Recent sync jobs.
- No internal secrets.
- No reviewer-facing production full-refresh action.

## Dimensions and Assets

Final Shopify App Store screenshot dimensions:

- `TODO_CONFIRM_SHOPIFY_SCREENSHOT_DIMENSIONS`

Working capture recommendations:

- Desktop browser width: 1440px.
- Capture embedded app inside Shopify admin.
- Avoid browser bookmarks and personal account details.
- Crop only if Shopify listing requirements allow it.

## Final Asset Checklist

- [ ] App icon.
- [ ] Dashboard overview screenshot.
- [ ] Location performance screenshot.
- [ ] Data Health screenshot.
- [ ] Expenses / COGS screenshot.
- [ ] Permissions screenshot.
- [ ] Billing or onboarding screenshot if needed.
- [ ] Optional Sync Center support screenshot if requested by reviewer.
- [ ] All screenshots use demo data only.
- [ ] All screenshots checked for customer personal data.
- [ ] All screenshots checked for client production data.
- [ ] Final dimensions confirmed.
- [ ] Listing copy and screenshots tell the same story.
