type HourlySalesLine = {
  created_at_shopify: string;
  shopify_order_id: string;
  revenue: number;
  quantity: number;
};

export function getHourInTimeZone(value: string, timeZone: string) {
  const orderDate = new Date(value);

  if (Number.isNaN(orderDate.getTime())) {
    return null;
  }

  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(orderDate),
  );

  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

export function computeHourlySalesRows(
  orderLines: HourlySalesLine[],
  timeZone: string,
) {
  const orderIdsByHour = new Map<number, Set<string>>();
  const rows = Array.from({ length: 24 }, (_, hour) => {
    orderIdsByHour.set(hour, new Set<string>());

    return {
      hour,
      revenue: 0,
      unitsSold: 0,
      ordersCount: 0,
      averageOrderValue: 0,
    };
  });

  for (const row of orderLines) {
    if (!row.created_at_shopify) {
      continue;
    }

    const hour = getHourInTimeZone(row.created_at_shopify, timeZone);

    if (hour === null) {
      continue;
    }

    const hourRow = rows[hour];

    hourRow.revenue += Number(row.revenue ?? 0);
    hourRow.unitsSold += Number(row.quantity ?? 0);

    if (row.shopify_order_id) {
      orderIdsByHour.get(hour)?.add(row.shopify_order_id);
    }
  }

  for (const row of rows) {
    row.ordersCount = orderIdsByHour.get(row.hour)?.size ?? 0;
    row.averageOrderValue =
      row.ordersCount > 0 ? row.revenue / row.ordersCount : 0;
  }

  return rows;
}
