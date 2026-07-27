export function formatCurrencyAxis(value: number) {
  const absoluteValue = Math.abs(Number(value));

  return new Intl.NumberFormat("en-CA", {
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
  return new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 0,
  }).format(Number(value));
}
