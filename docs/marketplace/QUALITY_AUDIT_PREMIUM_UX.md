# ShopOps Studio Premium UX Quality Audit

Date: 2026-07-01  
Scope: marketplace preview product quality audit only. No code changes recommended here are implemented in this document.

## Overall Score

**Overall product score: 71 / 100**

ShopOps Studio is useful and materially differentiated for Shopify merchants who care about margin, COGS, discounts, refunds, returns, inventory, expenses, and data health. The data model is stronger than the UI currently communicates. The app feels more like a capable internal reporting console than a polished paid Shopify App Store product.

The biggest gap is not raw functionality. It is packaging: metric definitions are not visible enough, the main reporting experience needs stronger hierarchy and trend/comparison context, and support/admin diagnostics leak too much into the merchant-facing experience. At $59.99/month, the app needs to feel more guided, more confident, and less like the merchant is reading system state.

## Scoring Model Summary

- Value and clarity: 14 / 20
- Data accuracy: 19 / 25
- UX / premium feeling: 11 / 20
- Reporting usefulness: 11 / 15
- Reliability / sync / empty states: 8 / 10
- Marketplace readiness: 8 / 10

## Page Audits

### /app/db-dashboard

**Score: 76 / 100**  
**Priority: P1**

**Strengths**
- Strong core value: sales, margin, inventory, staff attribution, expenses, refunds, returns, and sync health are all present.
- Empty and preparing states are safe for fresh installs and route users toward Sync Center.
- Drilldowns for hour, product, staff, vendor, and location give the page real analytical value.
- Recent sync failure warning improves trust.

**Weaknesses**
- The page does not immediately frame the merchant question it answers. It says "dashboard" through layout, but not "Are my stores profitable and where is margin leaking?"
- KPI cards appear before enough explanation of metric definitions or confidence.
- The visuals are functional but basic: cards and tables over a neutral gray shell, limited premium polish, little sense of insight ranking.
- Date, location, staff, and vendor filters are useful, but the page needs stronger "what changed vs last period" context.

**What feels basic/cheap**
- Generic KPI grid without deltas, trend arrows, or compact metric definitions.
- Warning copy includes internal wording like "No billing or reviewer-facing full sync action is required on this page."
- Charts appear operational rather than executive. They report facts but do not guide the merchant toward the next decision.

**Premium UX opportunities**
- Add a top "Business snapshot" row with Net Sales, Gross Profit, Margin, Discounts, Refunds, and Inventory Risk, each with delta vs previous period.
- Add a margin waterfall: Gross Sales -> Discounts -> Returns -> Net Sales -> COGS -> Gross Profit -> Expenses -> Estimated Net.
- Add a "Needs attention" panel for missing COGS, stale sync, high discount impact, low-margin products, and inventory risks.
- Add hover or inline metric definitions for Gross Sales, Discounts, Net Sales, COGS, Gross Profit, Margin, Refunds, Returns.

**Data accuracy risks**
- Gross/net/discount/refund definitions are not visible enough, so merchants may assume accounting-grade financial statements.
- Refunds and returns are separate but need clearer explanation to prevent perceived double counting.
- Staff attribution is still dependent on available Shopify fields and should be labeled as attribution when available, not guaranteed full staff reporting.

**Quick wins**
- Rename page title to "Profit Dashboard" or "Store Performance".
- Add subtitle: "Track sales, discounts, refunds, COGS, margin, and inventory risk from synced Shopify data."
- Add "Metric definitions" inline popover near KPIs.
- Replace internal/reviewer copy in empty states with merchant-facing copy.

**Bigger improvements**
- Add period-over-period comparisons.
- Add a confidence badge fed by Data Health and sync freshness.
- Add a discount/refund impact panel.
- Add guided insight cards: "3 products with low margin", "2 locations missing COGS", "Discounts increased vs prior period".

### /app/locations

**Score: 73 / 100**  
**Priority: P1**

**Strengths**
- Clear page purpose: compare sales, margin, and expenses across locations.
- Multi-location filtering is a real paid-app value driver.
- Location comparison, vendor, staff, and trend sections are directionally useful.
- Empty states route users to Sync Center.

**Weaknesses**
- The page is dense and feels admin-heavy.
- Expense caveats appear as a small paragraph, but they materially affect profitability interpretation.
- Location selector uses chip-like labels and checkboxes, but the interaction feels utilitarian rather than polished.
- The page does not clearly answer "Which location needs my attention today?"

**What feels basic/cheap**
- Inline caveat text about V1 expenses and global expenses reads like implementation detail.
- "TEMP DEBUG - admin only" is a severe marketplace trust risk if exposed.
- Tables and filters use default-ish visual styling.

**Premium UX opportunities**
- Add location leaderboard cards: Revenue, Gross Profit, Margin, Discount Rate, Refund Rate, Inventory Risk.
- Add comparison bars for location contribution and margin.
- Add a "Why this matters" summary for expense allocation and refunds.
- Promote global expense handling from a caveat into a clear confidence note.

**Data accuracy risks**
- Global/unassigned expenses not allocated can make location profitability look better than it is.
- Refund allocation across locations needs visible definition.
- If staff attribution is unavailable, staff filters could appear more complete than they are.

**Quick wins**
- Remove or hide debug output before marketplace submission.
- Rename subtitle to: "Compare store performance by sales, margin, discounts, refunds, COGS, and expenses."
- Add a small "Profitability confidence" badge when expenses or COGS are incomplete.
- Add a clear empty state for stores with locations but no sales.

**Bigger improvements**
- Add location scorecards with deltas vs previous period.
- Add margin waterfall by location.
- Add expense allocation options or clear global expense treatment.
- Add "attention required" sorting by low margin, high refunds, missing COGS, stale inventory.

### /app/data-quality

**Score: 82 / 100**  
**Priority: P1**

**Strengths**
- This is one of the strongest differentiated features.
- The page explains whether reports are ready to trust, which is valuable for merchants and reviewers.
- It covers sync freshness, missing costs, reporting gaps, financial completeness, sync failures, expenses, and optional staff attribution.
- Empty state is clear and safe for fresh installs.

**Weaknesses**
- It still reads like a support diagnostic rather than a merchant-facing confidence center.
- Issue sections likely need clearer severity ranking.
- It should better connect data issues to business impact: "Margin may be understated", "Inventory risk may be incomplete", "Discount reporting may need review."

**What feels basic/cheap**
- "Admin/support diagnostic view" appears in merchant-facing text.
- Sections are useful but may feel like checklists rather than premium assurance.
- The page needs a stronger top summary.

**Premium UX opportunities**
- Rename to "Data Confidence" or "Report Health".
- Add a top health score: "Reports ready", "Needs review", or "Preparing".
- Add severity cards: Critical, Warning, Informational.
- Add a checklist style Financial QA / COGS / Inventory / Sync health summary.

**Data accuracy risks**
- If metric issues are listed without severity, merchants may overreact or ignore important warnings.
- Missing costs and stale syncs affect margin materially and need prominent severity.

**Quick wins**
- Replace "Admin/support diagnostic view" with "Use this to confirm whether reports are complete enough to trust."
- Add a top one-line verdict.
- Add CTAs per issue: "Open Expenses", "Open Sync Center", "Review Financial QA".

**Bigger improvements**
- Add report confidence scoring.
- Add historical sync health timeline.
- Add issue resolution tracking.
- Add merchant-readable definitions for each check.

### /app/admin/expenses

**Score: 64 / 100**  
**Priority: P1**

**Strengths**
- Functional fixed expense entry by category, month, amount, and location.
- Useful for converting margin reporting into profitability reporting.
- Empty state points to the business value: add fixed expenses to calculate location profitability.

**Weaknesses**
- Feels like an admin CRUD page, not a premium profitability feature.
- It does not show the impact of expenses on reports.
- Global expense behavior is not explained deeply enough.
- No import/template guidance.

**What feels basic/cheap**
- Form and table dominate the page.
- "Manage fixed expenses by location" is accurate but under-sells the value.
- Delete/edit controls are utilitarian.

**Premium UX opportunities**
- Rename to "Expense Setup" or "Profit Expenses".
- Add summary cards: Monthly fixed expenses, allocated by location, unallocated/global, active/inactive.
- Add a preview: "These expenses reduce estimated net profit in Dashboard and Locations."
- Add category guidance and examples.

**Data accuracy risks**
- Expenses are fixed monthly and not necessarily accounting-complete.
- Global expenses are shared but not clearly allocated in location views.
- Before-tax amount wording may not match merchant expectations.

**Quick wins**
- Add explanatory subtitle: "Add fixed monthly costs so ShopOps can estimate location-level profitability."
- Add empty-state CTA label: "Add first expense".
- Add inline copy: "This is reporting input, not accounting or tax advice."

**Bigger improvements**
- Add CSV import.
- Add expense allocation rules.
- Add expense impact preview by location and date range.
- Add audit trail for expense changes.

### /app/admin/permissions

**Score: 70 / 100**  
**Priority: P1**

**Strengths**
- Manual email workflow works without `read_users`.
- Clear step structure: email, role, locations.
- Good empty-state handling when locations have not synced.
- Current access table is straightforward.

**Weaknesses**
- The page feels administrative and technical.
- It does not reassure merchants enough about how email matching works.
- Roles are not defined enough.
- The footer exposes environment details and Shopify user IDs, which feels internal.

**What feels basic/cheap**
- "Environment details" line is not marketplace-polished.
- Role labels are generic without capability explanations.
- Permission model is functional but lacks trust polish.

**Premium UX opportunities**
- Add role cards or role descriptions: Viewer, Manager, Admin.
- Add a "How access works" collapsible note.
- Add a location access preview for selected user.
- Hide environment details from standard marketplace users.

**Data accuracy risks**
- Email-based matching depends on users signing in with the same Shopify account email.
- Without `read_users`, merchants may expect automatic staff discovery that does not exist.

**Quick wins**
- Rename title to "Team Access".
- Subtitle: "Control which team members can view each location."
- Add role descriptions near the selector.
- Hide raw Shopify IDs and environment details unless support mode is active.

**Bigger improvements**
- Add invitation/status flow.
- Add permission testing: "Preview as user".
- Add last accessed / audit log.
- Add clearer admin-only guardrails.

### /app/admin/sync

**Score: 68 / 100**  
**Priority: P1**

**Strengths**
- Background queue model is now clear.
- Manual sync actions support marketplace testing and support.
- Shows database counts, job status, recent sync runs, and freshness.
- Staff sync copy correctly handles public app `read_users` absence.

**Weaknesses**
- This page is too support/internal for most merchants.
- "Local support refresh" command should not be visible to ordinary marketplace users.
- Database table counts are useful for support but not premium merchant UX.
- Sync health should be summarized, not exposed as raw operations.

**What feels basic/cheap**
- Buttons like "Process queued jobs now" and local CLI command make the app feel unfinished.
- "Legacy/manual job status" copy feels internal.
- Database record pills expose implementation detail.

**Premium UX opportunities**
- Split into merchant "Sync Status" and support-only "Sync Diagnostics".
- Add a visual sync timeline: queued, running, completed, failed.
- Add a single confidence status: "Data current as of..."
- Hide local command, raw counts, process-now button behind support mode.

**Data accuracy risks**
- If sync is stale, every report is suspect; this page needs clearer "reports may be incomplete" messaging.
- Merchants should understand webhooks are future changes and manual sync/backfill covers historical data, but not in scary operational terms.

**Quick wins**
- Rename standard view to "Data Sync".
- Hide local refresh command for marketplace users.
- Move database counts and process-now into support-only section.
- Add CTA after first sync: "View Dashboard".

**Bigger improvements**
- Add sync progress timeline.
- Add sync health API consumed by dashboard badges.
- Add retry suggestions based on failure type.
- Add last completed per object type with friendly labels.

### /app/admin/financial-qa

**Score: 72 / 100**  
**Priority: P1**

**Strengths**
- Strong trust-building concept: compares order-level and line-level financial totals.
- Tracks discount mismatches, refunds, returns, financial completeness, legacy line deltas.
- Good empty state.
- Valuable for debugging Shopify edge cases.

**Weaknesses**
- It is too raw for merchants.
- "Legacy revenue", "Order - Line Delta", and internal flags are useful for support but not premium UX.
- Huge wide table creates a spreadsheet/support console feel.
- It needs a merchant-friendly checklist and severity summary.

**What feels basic/cheap**
- Dense 20-column table.
- Raw flag names like `discount_mismatch` and `legacy_line_delta`.
- Default-ish filter controls.

**Premium UX opportunities**
- Rename to "Financial QA" only for support/admin; merchant-facing label should be "Report Accuracy".
- Add checklist cards: Discounts, Refunds, Returns, Taxes, Shipping, Order-line match.
- Convert flags to readable messages: "Discount allocations need review".
- Add severity and next action per issue.

**Data accuracy risks**
- Discount mismatch is useful but may require explanation about shipping discounts, rounding, Shopify presentment currency, and allocations.
- Merchants may confuse QA deltas with accounting errors.
- Legacy metrics should be hidden from marketplace users.

**Quick wins**
- Add top summary: "X orders checked, Y need review."
- Replace raw flag labels in UI copy.
- Hide legacy columns by default.
- Add explanation for discount delta tolerance.

**Bigger improvements**
- Add grouped issue list before the table.
- Add order drilldown view.
- Add export for support.
- Add automatic link from Data Health when financial QA issues exist.

### /privacy

**Score: 84 / 100**  
**Priority: P0**

**Strengths**
- Clear explanation of data processed.
- Explicitly states data isolation, no sale of data, no marketing use.
- Mentions Shopify privacy webhooks.
- Support contact is visible.

**Weaknesses**
- Staff/user data section still says "If Shopify approves user access", which may confuse reviewers if the public app no longer requests `read_users`.
- Could more explicitly say reporting is merchant-facing and informational.
- Legal pages look clean but somewhat generic.

**What feels basic/cheap**
- Plain article layout is acceptable for legal pages, but brand polish is minimal.
- No effective date/version block visible in the sampled section.

**Premium UX opportunities**
- Add "Effective date" and concise summary at top.
- Add "Data is shop-scoped" callout.
- Align staff/user wording with current public app behavior.

**Data accuracy risks**
- Any mismatch between requested scopes and privacy copy creates reviewer doubt.

**Quick wins**
- Update staff/user copy to distinguish current public app behavior from future/custom environments.
- Add informational reporting disclaimer.

**Bigger improvements**
- Add subprocessors/security section if applicable.
- Add retention table by data category.

### /terms

**Score: 78 / 100**  
**Priority: P0**

**Strengths**
- Public terms page exists and is accessible.
- Likely sufficient for first submission if aligned with listing copy and billing behavior.

**Weaknesses**
- Needs to be checked for billing, trial, cancellation, informational reporting, and no advice language.
- Should avoid implying accounting/tax/legal/financial advice.

**What feels basic/cheap**
- Standard legal page without merchant-friendly summary.

**Premium UX opportunities**
- Add top summary: subscription, trial, reporting-only nature, support contact.
- Add clear limitation: informational reporting only.

**Data accuracy risks**
- Terms that overstate accuracy or advice could conflict with product reality.

**Quick wins**
- Ensure $59.99/month and 14-day trial language is consistent where appropriate.
- Add no-accounting/no-tax/no-legal/no-financial-advice wording.

**Bigger improvements**
- Add versioning/effective date.
- Add jurisdiction and cancellation clarity if missing.

### /support

**Score: 80 / 100**  
**Priority: P0**

**Strengths**
- Public support page exists.
- Support email is available.
- Likely enough for Shopify reviewer flow.

**Weaknesses**
- Needs stronger expectation setting: response times, required diagnostic info, support boundaries.
- Should direct users to Sync Center/Data Health only if appropriate and in merchant-friendly language.

**What feels basic/cheap**
- Basic support page can feel thin for a paid app unless it includes clear service expectations.

**Premium UX opportunities**
- Add support categories: sync/data issue, billing, privacy, setup help.
- Add response-time target.
- Add "include your shop domain and screenshot" guidance.

**Data accuracy risks**
- Support needs language for reporting discrepancies without promising accounting reconciliation.

**Quick wins**
- Add "For reporting questions, include date range, location, and metric."
- Add "For sync issues, include latest sync status from Data Health."

**Bigger improvements**
- Add help center docs after MVP.
- Add in-app support launcher later.

## Top 10 Improvements Ranked By Impact

1. **Add metric definitions everywhere KPIs appear.** Define Gross Sales, Discounts, Net Sales, COGS, Gross Profit, Margin, Refunds, Returns, Taxes, Shipping. Impact: trust and reduced support load.
2. **Create a premium dashboard top section.** KPI cards with deltas, confidence badge, and a clear "what changed" summary. Impact: paid-app perception.
3. **Hide support/internal diagnostics from standard marketplace users.** Move CLI command, raw DB counts, process-now button, environment details, temp debug, and legacy QA fields behind support/admin mode. Impact: marketplace readiness.
4. **Add a sync/data confidence badge across reports.** "Current", "Preparing", "Needs review", with last sync timestamp. Impact: reliability and trust.
5. **Add margin waterfall.** Show how Gross Sales becomes Estimated Profit. Impact: clarity and premium reporting.
6. **Improve discount/refund/return explanation.** Add a dedicated card showing gross/net/discount/refund breakdown and definitions. Impact: accuracy perception.
7. **Upgrade Financial QA into a readable checklist.** Keep raw table for support, but lead with merchant-friendly issue cards. Impact: trust without overwhelming users.
8. **Strengthen Location reporting.** Add leaderboard, deltas, and attention sorting by low margin/high refunds/missing COGS. Impact: merchant usefulness.
9. **Make Expenses feel like a profitability setup flow.** Add impact preview and allocation clarity. Impact: converts a CRUD page into a product feature.
10. **Rewrite marketplace-facing copy.** Remove reviewer/internal phrases and replace with simple merchant actions. Impact: first impression.

## Suggested Final Navigation

**Main nav**
- Dashboard
- Locations
- Data Health
- Expenses

**Admin nav**
- Team Access
- Sync Status
- Billing, if billing is enabled and reviewer-ready

**Support-only or hidden by default**
- Financial QA raw table
- Sync job processor controls
- Local support refresh command
- Database record counts
- Environment details and raw Shopify IDs
- Temp debug sections
- Legacy revenue/legacy delta QA columns

**Public pages**
- Privacy
- Terms
- Support

## Suggested Dashboard Layout

1. **Top KPI row**
   - Net Sales
   - Gross Profit
   - Margin
   - Discounts
   - Refunds/Returns
   - Inventory Risk
   - Each KPI should show delta vs previous period and a short definition tooltip.

2. **Trend section**
   - Net Sales and Gross Profit over time.
   - Toggle: daily/weekly/monthly depending on date range.
   - Annotate high discount/refund days.

3. **Location comparison**
   - Sales, margin, discount rate, refund rate, expense impact, missing COGS.
   - Sort by attention needed, not only revenue.

4. **Product/margin section**
   - Best sellers by net sales.
   - Lowest-margin products.
   - Missing COGS products.
   - Stock risk tied to sales velocity.

5. **Discounts/refunds section**
   - Gross Sales -> Discounts -> Returns -> Net Sales.
   - Discount rate and refund/return rate.
   - Top discounted products or locations.

6. **Inventory risk section**
   - Low stock/high velocity.
   - Inventory without cost.
   - Products with sales but missing inventory context.

7. **Sync/data confidence section**
   - Last successful sync.
   - Data Health verdict.
   - Financial QA status.
   - CTA to resolve the most important issue.

## Recommended Premium Visuals

- KPI cards with delta vs previous period.
- Gross/net/discount/refund breakdown.
- Margin waterfall.
- Sales by location leaderboard.
- Inventory risk table.
- Discount impact card.
- COGS/margin health card.
- Sync health timeline.
- Financial QA checklist.
- Empty states with next action.

## Copy Improvements

**Better page titles**
- Dashboard -> Profit Dashboard or Store Performance
- Locations -> Location Performance
- Data Health -> Data Confidence
- Expenses -> Expense Setup
- Permissions -> Team Access
- Sync Center -> Sync Status
- Financial QA -> Report Accuracy, with raw Financial QA hidden under support tools

**Better subtitles**
- Dashboard: "Track Shopify sales, discounts, refunds, COGS, margins, and inventory risk from synced store data."
- Locations: "Compare stores by net sales, margin, expenses, discounts, refunds, and inventory health."
- Data Health: "See whether your reports are complete enough to trust and what needs attention."
- Expenses: "Add fixed monthly costs so ShopOps can estimate location-level profitability."
- Team Access: "Control which team members can view each location."
- Sync Status: "See when Shopify data last updated and whether reports are current."
- Report Accuracy: "Review checks that compare Shopify order totals with line-level reporting data."

**Better empty state copy**
- "Your first reports are preparing. Sync locations, products, inventory, and orders to unlock margin and inventory reporting."
- "No sales found for this period. Try a wider date range or check sync status if orders should be available."
- "No expenses yet. Add rent, payroll, software, or other fixed monthly costs to estimate profitability."
- "No team access rules yet. Add a staff email to control which locations that person can view."

**Better CTA labels**
- "Check Sync Status"
- "View Dashboard"
- "Add First Expense"
- "Add Team Member"
- "Review Data Health"
- "Fix Missing COGS"
- "Review Discount Issues"

**Better explanations**
- Sync: "ShopOps imports historical Shopify data through queued sync jobs, then keeps reports current with Shopify changes."
- Discounts: "Discounts come from Shopify order and line allocation data. Net Sales is Gross Sales minus Discounts and Returns."
- COGS: "COGS uses synced Shopify inventory item costs when available. Missing costs reduce margin confidence."
- Permissions: "Public marketplace installs use manual email-based access rules. Shopify staff directory sync is not required."

## Data Product Recommendations

**Metric definitions to show in-app**
- Gross Sales: product sales before discounts and returns.
- Discounts: Shopify discount allocations applied to orders and line items.
- Net Sales: Gross Sales minus Discounts and Returns.
- COGS: cost of goods sold from synced Shopify inventory item cost data where available.
- Gross Profit: Net Sales minus COGS.
- Margin: Gross Profit divided by Net Sales.
- Refunds: cash refunded on Shopify orders, reported separately from returns.
- Returns: returned line-item value used in net sales calculations where available.
- Taxes: Shopify tax totals, informational reporting only.
- Shipping: Shopify shipping totals, tracked separately from product margin.

**Confidence and QA indicators**
- Add confidence badges to Dashboard and Locations:
  - High confidence: recent sync, low missing COGS, no major Financial QA warnings.
  - Needs review: stale sync, missing COGS, discount mismatch, incomplete financial data.
  - Preparing: fresh install or first sync incomplete.
- Make Shopify edge cases visible but not scary:
  - "Some Shopify discounts, refunds, or shipping adjustments may require review. Reports remain informational."
  - "Discount allocation differences over $0.02 are flagged for review."

## Marketplace Risk Section

**Could make Shopify reviewers or merchants doubt the app**
- Internal/support wording on customer-facing pages.
- TEMP DEBUG section on Locations.
- Local CLI command exposed in Sync Center.
- Raw database counts and job-processing controls visible to normal users.
- Metric definitions not visible enough for financial reporting claims.
- Privacy copy mentioning staff/user data in a way that may not match public app scopes.
- Dense Financial QA table with raw flags and legacy metrics.
- Global expenses not allocated clearly in location profitability.

**Should be fixed before submission**
- Hide or remove debug output.
- Hide support-only sync controls and local CLI command from marketplace users.
- Align privacy/terms wording with current public app scopes and reporting-only positioning.
- Add metric definitions to dashboard KPI areas.
- Replace internal/reviewer copy with merchant-facing copy.
- Add Data Health confidence summary.
- Hide raw legacy QA columns by default.

**Can wait after MVP**
- Full margin waterfall.
- Period-over-period deltas everywhere.
- Expense CSV import and advanced allocation.
- Order-level Financial QA drilldown.
- Help center docs.
- In-app support launcher.
- Advanced insight recommendations.

## Final Take

ShopOps Studio has enough functional substance for a meaningful marketplace MVP. The premium gap is presentation and trust packaging. The app should feel less like "here are synced database reports" and more like "here is what is happening to your Shopify profitability, how confident we are, and what to do next."

The fastest path to a better first impression is to keep the current data engine, hide support internals, add metric definitions and confidence badges, and redesign the dashboard lead section around merchant questions: sales, margin, discounts, refunds, COGS, inventory risk, and data trust.
