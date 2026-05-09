import type { OrderLineRow, DashboardKpis } from "../types/dashboard";

export function computeSalesKpis(orderLines: OrderLineRow[]): DashboardKpis {
  const revenue = orderLines.reduce((sum, row) => sum + row.revenue, 0);
  const unitsSold = orderLines.reduce((sum, row) => sum + row.quantity, 0);

  const uniqueOrders = new Set(orderLines.map((row) => row.orderId));
  const ordersCount = uniqueOrders.size;

  const averageOrderValue = ordersCount > 0 ? revenue / ordersCount : 0;

  return {
    revenue,
    ordersCount,
    unitsSold,
    averageOrderValue,
  };
}