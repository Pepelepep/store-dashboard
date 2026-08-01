import type { ReactNode } from "react";

import type {
  ReportKpiId,
  ReportKpiPresentationItem,
} from "../../lib/dashboard/kpi-presentation";

export type ReportKpiCardItem = ReportKpiPresentationItem & {
  detail?: ReactNode;
};

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
        <article
          className="shopops-kpi-card"
          data-category={item.category}
          key={item.id}
          title={item.explanation}
        >
          <div className="shopops-kpi-label">{item.label}</div>
          <div className="shopops-kpi-value">{item.value}</div>
          {item.detail ? (
            <div className="shopops-kpi-detail">{item.detail}</div>
          ) : null}
        </article>
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
