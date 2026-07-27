export type RankedBreakdownRow = {
  label: string;
  value: string;
  revenue: number;
  ordersCount: number;
  unitsSold: number;
  percent: number;
};

export function limitRankedBreakdownRows(
  rows: RankedBreakdownRow[],
  namedLimit = 7,
): RankedBreakdownRow[] {
  if (rows.length <= namedLimit) {
    return rows;
  }

  const visibleRows = rows.slice(0, namedLimit);
  const otherRows = rows.slice(namedLimit);
  const others = otherRows.reduce<RankedBreakdownRow>(
    (sum, row) => ({
      label: "Others",
      value: "Others",
      revenue: sum.revenue + row.revenue,
      ordersCount: sum.ordersCount + row.ordersCount,
      unitsSold: sum.unitsSold + row.unitsSold,
      percent: sum.percent + row.percent,
    }),
    {
      label: "Others",
      value: "Others",
      revenue: 0,
      ordersCount: 0,
      unitsSold: 0,
      percent: 0,
    },
  );

  return [...visibleRows, others];
}
