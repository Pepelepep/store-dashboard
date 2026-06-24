# Screenshot Plan

Draft status: marketplace listing asset plan.

## Rules

- Use demo/fake data only.
- Do not use current client production data.
- Do not show real customer names, addresses, phone numbers, emails, or private order details.
- Capture screenshots from the dedicated marketplace/demo environment.
- Keep browser zoom and Shopify admin frame consistent across screenshots.

## Recommended Screenshot Order

1. Dashboard overview.
2. Dashboard tables and stock alerts.
3. Sales by Vendor and Sales by Staff.
4. Locations comparison.
5. Data Health.
6. Sync Center only if showing admin/support diagnostics.
7. Permissions.
8. Expenses.
9. First-run/empty state.

## Screenshot Details

### 1. Dashboard Overview

Show:

- App name/context in embedded Shopify admin.
- Location selector.
- Date range filters.
- KPI cards with non-zero sales.
- Gross profit/margin context.

Data requirements:

- At least one selected location with demo orders.
- COGS populated for margin metrics.

### 2. Dashboard Tables and Stock Alerts

Show:

- Best sellers.
- Soon out of stock.
- Recent order lines.
- Discounts/refunds/returns chips or columns where available.

Data requirements:

- Products with SKUs/vendors.
- Inventory warning/critical examples.
- Orders with discounts/refunds/returns.

### 3. Sales by Vendor and Sales by Staff

Show:

- Vendor breakdown.
- Staff breakdown if `read_users` remains enabled.

Data requirements:

- Multiple vendors.
- Multiple staff attribution examples where Shopify provides data.

Fallback:

- If `read_users` is removed or staff attribution unavailable, capture vendor reporting and omit staff-specific screenshot or label staff attribution as optional.

### 4. Locations Comparison

Show:

- Multiple selected locations.
- Location KPIs.
- Trend chart.
- Location table.

Data requirements:

- At least 3 active locations.
- Sales in each location.
- Expenses configured for at least some locations.

### 5. Data Health

Show:

- Sync freshness.
- Product/variant/order/inventory checks.
- Expense coverage.
- Optional staff attribution check.
- Copy that explains these checks help show whether reports are ready to trust.

Data requirements:

- Mix of healthy and warning examples.
- Avoid scary unresolved failures unless intentional and explained.

### 6. Sync Center

Show:

- First run status only if demonstrating onboarding.
- Last successful sync.
- Sync status cards.
- Database records.
- Recent sync history.

Data requirements:

- Successful demo sync runs.
- Record counts populated.

Important:

- Do not show internal secrets.
- Do not show any reviewer-facing full sync trigger.
- Treat this as an admin/support diagnostic screenshot, not a primary marketplace product screen.

### 7. Permissions

Show:

- Grant access form.
- Location checkboxes.
- Existing demo access rules.
- Staff dropdown if available.

Data requirements:

- Demo staff and demo locations.
- Fake staff emails only.

### 8. Expenses

Show:

- Add/edit expense form.
- Existing fixed expenses table.
- Location-specific and global examples if useful.

Data requirements:

- Fake expense names and amounts.
- No client production expenses.

### 9. First-Run / Empty State

Show:

- "Your data is being prepared"
- Sync Center CTA for admin.
- Simple next steps.

Data requirements:

- Empty demo tenant or unsynced demo shop.

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
- [ ] Dashboard table/stock alert screenshot.
- [ ] Vendor/staff screenshot.
- [ ] Locations screenshot.
- [ ] Data Health screenshot.
- [ ] Sync Center screenshot only if needed for admin/support diagnostics.
- [ ] Permissions screenshot.
- [ ] Expenses screenshot.
- [ ] First-run empty state screenshot.
- [ ] All screenshots use demo data only.
- [ ] All screenshots checked for customer personal data.
- [ ] All screenshots checked for client production data.
- [ ] Final dimensions confirmed.
- [ ] Listing copy and screenshots tell the same story.
