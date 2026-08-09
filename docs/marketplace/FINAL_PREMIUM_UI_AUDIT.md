# Final Premium UI audit

Date: 2026-08-09  
Branch: `codex/premium-ui-pass`

## Current architecture

- React 18 with React Router 7.
- Shopify Polaris supplies the embedded-app provider, icons, accessibility conventions, and a small number of Shopify-specific components.
- ShopOps owns a shared presentation layer in `app/components/ui` and analytics components in `app/components/dashboard`.
- Recharts powers the main chart system.
- Styling is currently shared CSS-in-TS plus some route/component-local styles.
- Tailwind/shadcn were absent at audit time. A progressive, no-preflight
  foundation is now installed on this branch.

## Component inventory

| Purpose           | Current implementation                                    | Usage                        | Target/action                                                                                            |
| ----------------- | --------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| Buttons           | `AppButton` / `AppButtonLink`                             | Global                       | Canonical ShopOps controls backed by shadcn Button — complete                                            |
| Page shell/header | `ShopOpsPage` / `PageHeader`                              | User-facing routes           | Keep; refined type, spacing, icon, and responsive rules — complete                                       |
| Content cards     | `ContentCard`, `SectionCard`                              | Setup + analytics            | Keep both roles; shared tokens and shadcn Card foundation — complete                                     |
| KPI cards         | `MetricCard` and `SummaryCard`                            | Analytics + setup            | Canonical analytics metric; setup summaries remain deliberately separate — complete                      |
| Filters           | `ReportFilterPanel` / `DashboardFilters`                  | Reports + Dashboard          | Keep behavior; reduce height and visual chrome — complete                                                |
| Notices           | `PageNotice`, `InlineNotice`, `ReportKpiNotice`           | Context-specific             | Keep because their scopes differ; shared semantic palette                                                |
| Badges            | `StatusBadge`, drill-down bar                             | Status + analytics selection | Keep StatusBadge; consolidate active selections through `ShopOpsDrilldownBar` — complete                 |
| Empty states      | `EmptyState`, `CompactEmptyDataNotice`, chart empty state | Global + analytics           | Compact report state and stable chart dimensions — complete                                              |
| Loading           | `MetricCardSkeleton`, `ChartCardSkeleton`                 | Dashboard + Locations        | Match final component dimensions — complete                                                              |
| Charts            | `ShopOpsChart`, `SectionCard`, Recharts charts            | Dashboard + Locations        | Common tooltip, focus, card, empty, and responsive styling — complete                                    |
| Tables            | Native semantic tables with `shopops-data-table`          | Dashboard, Locations, Costs  | Shared density/alignment/hover/overflow; preserve route-specific behavior — complete for core user flows |
| Tabs              | `SectionTabs`                                             | Costs, People, Settings      | Keep as the canonical product-level section navigation                                                   |

## Decision on shadcn/ui

Adopt shadcn/ui progressively behind the ShopOps API. Tailwind 4 is configured
without Preflight so it does not reset Polaris or existing pages. The first
foundation includes Button, Card, Tooltip, and Skeleton primitives; pages keep
using `AppButton`, `ShopOpsTooltip`, `MetricCard`, and ShopOps skeletons.

Do not perform a broad class-by-class migration before Marketplace. Add or
migrate a primitive only when it removes a concrete inconsistency, and measure
its bundle impact. Radix Tooltip is intentionally isolated from the global root
so pages that do not use it do not pay its client-side cost.

## Main findings

- The existing ShopOps design work is substantial and should be evolved, not replaced.
- Tokens exist but radius, elevation, controls, and chart cards were not fully centralized.
- Dashboard filters used more card chrome and metadata pills than needed.
- KPI cards were repeated inline rather than represented by a named canonical component.
- Locations combined selection, comparison, staff attribution, and responsive behavior in local presentation code. Those interactions now use shared table/chart/drill-down presentation without changing route state or handlers.
- The current compact no-sales notice already resolves the oversized-empty-state concern and should remain.
- Role-aware location filtering and server-side reporting scope are already present and must remain untouched.
- People already had a dedicated, coherent lifecycle UI and complex access workflows. It remains on the ShopOps page/header/tabs contract; a broad markup rewrite would add risk without improving Marketplace readiness.
- Reports already consume the shared filter, KPI, chart, card, and table surfaces. No separate redesign was required.
- Costs now shares the same form controls, preview cards, density, numeric alignment, table presentation, and pagination controls.

## Deliberately untouched

- Authentication, legal, billing, authorization, setup actions, and all server loaders/actions.
- `app.admin.financial-qa.tsx`, which is an internal financial verification surface rather than a merchant-facing product page.
- People identity/access overlays and staff lifecycle behavior, because their existing interaction model is mature and permission-sensitive.
- Chart data contracts, Recharts composition, calculations, sorting, selection state, and export behavior.
- Navigation structure and route semantics; global polish was applied through the existing shared shell instead.

## Safe implementation sequence

1. Centralize practical tokens and shared analytics-card styling. Complete.
2. Add the no-preflight shadcn foundation and migrate canonical buttons. Complete.
3. Establish `MetricCard` without changing KPI data or calculation. Complete.
4. Compact Dashboard header/filter presentation and freshness metadata. Complete.
5. Standardize shared chart card headings, export controls, focus, and responsive behavior. Complete.
6. Apply the same tokens to Locations comparison surfaces in small verified groups. Complete.
7. Consolidate repeated native table presentation without changing sorting, selection, or route state. Complete for Dashboard, Locations, and Costs.
8. Apply the established system to merchant-facing secondary pages without redesigning workflows. Complete.
9. Run lint, typecheck, tests, build, dependency audit, and manual role/responsive QA.

## Risk controls

- No route, loader, action, database, billing, scope, authorization, or metric-calculation changes.
- Dependency additions are limited to Tailwind 4, shadcn utility packages, Lucide, and the Radix primitives actually used.
- Tailwind Preflight is disabled to avoid resetting Polaris and legacy workflow surfaces.
- No broad page migration or duplicated public primitive API.
- No inferred access based on visibility of controls.
