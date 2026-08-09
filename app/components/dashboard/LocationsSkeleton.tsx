import { ChartCardSkeleton, MetricCardSkeleton } from "../ui/ShopOpsSkeleton";

export function LocationsContentSkeleton() {
  return (
    <div
      aria-label="Updating location comparison"
      aria-live="polite"
      role="status"
    >
      <div className="shopops-kpi-grid" data-item-count="11">
        {Array.from({ length: 11 }, (_, index) => (
          <MetricCardSkeleton key={index} />
        ))}
      </div>
      <div className="shopops-dashboard-loading-chart">
        <ChartCardSkeleton />
      </div>
      <div className="shopops-breakdown-grid">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}
