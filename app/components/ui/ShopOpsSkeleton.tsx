import { Skeleton } from "./primitives/skeleton";

export function MetricCardSkeleton() {
  return (
    <div className="shopops-kpi-card" role="status" aria-label="Loading metric">
      <Skeleton className="mb-4 h-3 w-24" />
      <Skeleton className="mb-3 h-8 w-32" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export function ChartCardSkeleton() {
  return (
    <div
      className="shopops-section-card"
      role="status"
      aria-label="Loading chart"
    >
      <Skeleton className="mb-3 h-5 w-40" />
      <Skeleton className="mb-5 h-3 w-64 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
