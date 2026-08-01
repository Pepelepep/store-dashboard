const SHOP_OPS_DISPLAY_LOCALE = "fr-CA";

export function formatCurrencyAxis(value: number) {
  const absoluteValue = Math.abs(Number(value));

  return new Intl.NumberFormat(SHOP_OPS_DISPLAY_LOCALE, {
    style: "currency",
    currency: "CAD",
    notation: "compact",
    maximumFractionDigits:
      absoluteValue > 0 && absoluteValue < 10
        ? 2
        : absoluteValue >= 1000
          ? 1
          : 0,
  }).format(value);
}

export function formatIntegerAxis(value: number) {
  return new Intl.NumberFormat(SHOP_OPS_DISPLAY_LOCALE, {
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatNonZeroCurrencyLabel(value: number) {
  return value === 0 ? "" : formatCurrencyAxis(value);
}

export function formatNonZeroIntegerLabel(value: number) {
  return value === 0 ? "" : formatIntegerAxis(value);
}

export function hasMirrorChartActivity(
  points: Array<{ sales: number; orders: number }>,
) {
  return points.some((point) => point.sales !== 0 || point.orders !== 0);
}

export type TrendPeriod = "day" | "week" | "month" | "year";

export function formatTrendPeriodLabel(periodKey: string, period: TrendPeriod) {
  if (period === "year") return periodKey;

  if (period === "week") {
    const match = periodKey.match(/^\d{4}-W(\d{2})$/);
    return match ? `W${Number(match[1])}` : periodKey;
  }

  const match = periodKey.match(
    period === "day" ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{4})-(\d{2})$/,
  );
  if (!match) return periodKey;

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1)),
  );

  return new Intl.DateTimeFormat(SHOP_OPS_DISPLAY_LOCALE, {
    day: period === "day" ? "numeric" : undefined,
    month: "short",
    timeZone: "UTC",
    year: period === "month" ? "numeric" : undefined,
  }).format(date);
}
