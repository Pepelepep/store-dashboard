import type { ReactNode } from "react";

import type {
  ReportKpiId,
  ReportKpiPresentationItem,
} from "../../lib/dashboard/kpi-presentation";
import { ShopOpsTooltip } from "../ui/ShopOpsTooltip";
import { Card } from "../ui/primitives/card";

export type ReportKpiCardItem = ReportKpiPresentationItem & {
  detail?: ReactNode;
};

export function MetricCard({ item }: { item: ReportKpiCardItem }) {
  return (
    <Card asChild>
      <article
        aria-label={`${item.label}: ${item.value}`}
        className="shopops-kpi-card"
        data-category={item.category}
      >
        <div className="shopops-kpi-card__heading">
          <div className="shopops-kpi-label">{item.label}</div>
          <ShopOpsTooltip content={item.explanation}>
            <button
              aria-label={`${item.label} definition`}
              className="shopops-kpi-info"
              type="button"
            >
              i
            </button>
          </ShopOpsTooltip>
        </div>
        <div className="shopops-kpi-value">{item.value}</div>
        {item.detail ? (
          <div className="shopops-kpi-detail">{item.detail}</div>
        ) : null}
      </article>
    </Card>
  );
}

export function ReportKpiNotice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "info" | "neutral" | "warning";
}) {
  return (
    <div className="shopops-kpi-notice" data-tone={tone} role="status">
      {children}
    </div>
  );
}

export function ReportKpiGrid({ items }: { items: ReportKpiCardItem[] }) {
  return (
    <section className="shopops-kpi-grid" data-item-count={items.length}>
      {items.map((item) => (
        <MetricCard item={item} key={item.id} />
      ))}
    </section>
  );
}

export function attachReportKpiDetails(
  items: ReportKpiPresentationItem[],
  details: Partial<Record<ReportKpiId, ReactNode>>,
): ReportKpiCardItem[] {
  return items.map((item) => ({
    ...item,
    detail: details[item.id],
  }));
}
