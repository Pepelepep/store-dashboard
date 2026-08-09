# ShopOps UI component contract

Pages should consume ShopOps components. They should not import Radix or
shadcn primitives directly.

```tsx
import {
  AppButton,
  ContentCard,
  MetricCard,
  ReportFilterPanel,
  ShopOpsTooltip,
} from "@/components/shopops";
```

## Architecture

1. Polaris provides Shopify conventions, embedded-app familiarity, and the
   provider/icon layer.
2. shadcn/Radix provides selected low-level primitives.
3. ShopOps tokens and components define the visual system and product API.
4. Routes compose ShopOps product components and retain business behavior.

## Canonical choices

| Purpose         | ShopOps API                               | Foundation                   |
| --------------- | ----------------------------------------- | ---------------------------- |
| Button and link | `AppButton`, `AppButtonLink`              | shadcn Button                |
| General card    | `ContentCard`, `SummaryCard`              | shadcn Card                  |
| Analytics card  | `SectionCard`, `MetricCard`               | shadcn Card + ShopOps tokens |
| Metric help     | `ShopOpsTooltip`                          | Radix Tooltip                |
| Loading         | `MetricCardSkeleton`, `ChartCardSkeleton` | shadcn Skeleton              |
| Filters         | `ReportFilterPanel`, `ReportFilterField`  | ShopOps form contract        |
| Drill-downs     | `ShopOpsDrilldownBar`                     | ShopOps interaction contract |
| Empty data      | `CompactEmptyDataNotice`                  | ShopOps analytics state      |
| Tabs            | `SectionTabs`                             | ShopOps navigation contract  |

## Rules

- Keep route loaders, actions, permissions, and metric calculations outside UI
  primitives.
- Preserve `onClick`, keyboard handling, selection state, form type, and route
  semantics when changing a component foundation.
- Do not enable Tailwind Preflight before a dedicated Polaris compatibility QA.
- Add a primitive only when it removes a concrete inconsistency.
- Prefer semantic tokens over arbitrary per-page colors.
- Numeric and financial values use tabular numbers and right alignment.
- Metric comparisons use the immediately preceding period with the same length
  and filters. Direction tone is metric-aware: lower refunds/returns are
  positive, while higher sales/activity are positive.
- Semantic color identifies metric families; it does not encode arbitrary card
  identity.
- Keep no-data and loading dimensions stable enough to avoid layout shifts.
