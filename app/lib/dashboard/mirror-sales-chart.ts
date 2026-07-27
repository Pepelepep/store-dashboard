export type MirrorChartMetricPoint = {
  sales: number;
  orders: number;
};

export function buildMirrorChartScale<T extends MirrorChartMetricPoint>(
  points: T[],
) {
  const maximumSales = points.reduce(
    (maximum, point) => Math.max(maximum, Math.abs(point.sales)),
    0,
  );
  const maximumOrders = points.reduce(
    (maximum, point) => Math.max(maximum, point.orders),
    0,
  );

  return {
    hasActivity: points.some(
      (point) => point.sales !== 0 || point.orders !== 0,
    ),
    maximumOrders,
    maximumSales,
    points: points.map((point) => ({
      ...point,
      upperMirror:
        maximumSales === 0 ? 0 : Math.abs(point.sales) / maximumSales,
      lowerMirror:
        maximumOrders === 0 || point.orders === 0
          ? 0
          : -(point.orders / maximumOrders),
    })),
  };
}
