export function calculateNetSalesAfterCashRefunds({
  lineNetSales,
  merchandiseReturns,
  totalRefunds,
}: {
  lineNetSales: number;
  merchandiseReturns: number;
  totalRefunds: number;
}) {
  const cashOnlyRefunds = Math.max(totalRefunds - merchandiseReturns, 0);
  return lineNetSales - cashOnlyRefunds;
}
