import { ChartCardSkeleton, MetricCardSkeleton } from "../ui/ShopOpsSkeleton";

export function DashboardContentSkeleton() {
  return (
    <div aria-label="Updating dashboard" aria-live="polite" role="status">
      <div className="shopops-kpi-grid" data-item-count="10">
        {Array.from({ length: 10 }, (_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>
      <div className="shopops-dashboard-loading-chart">
        <ChartCardSkeleton />
      </div>
      <div className="shopops-dashboard-pair">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}
