type TrendRevenueRow = {
  period: string;
  revenue: number;
};

type RefundTransaction = {
  amount: number | null;
  processed_at: string | null;
};

export function reconcileTrendRowsWithCashRefunds<T extends TrendRevenueRow>({
  rows,
  refundTransactions,
  merchandiseReturns,
  getTransactionPeriod,
}: {
  rows: T[];
  refundTransactions: RefundTransaction[];
  merchandiseReturns: number;
  getTransactionPeriod: (processedAt: string) => string;
}) {
  const refundsWithPeriods = refundTransactions
    .map((transaction) => ({
      amount: Math.max(Number(transaction.amount ?? 0), 0),
      period: transaction.processed_at
        ? getTransactionPeriod(transaction.processed_at)
        : "",
    }))
    .filter((transaction) => transaction.amount > 0 && transaction.period);
  const totalRefunds = refundsWithPeriods.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const cashOnlyRefunds = Math.max(totalRefunds - merchandiseReturns, 0);

  if (cashOnlyRefunds === 0 || totalRefunds === 0) {
    return rows.map((row) => ({ ...row }));
  }

  const cashRefundsByPeriod = new Map<string, number>();

  for (const transaction of refundsWithPeriods) {
    const allocatedCashRefund =
      cashOnlyRefunds * (transaction.amount / totalRefunds);
    cashRefundsByPeriod.set(
      transaction.period,
      (cashRefundsByPeriod.get(transaction.period) ?? 0) + allocatedCashRefund,
    );
  }

  return rows.map((row) => ({
    ...row,
    revenue: row.revenue - (cashRefundsByPeriod.get(row.period) ?? 0),
  }));
}
