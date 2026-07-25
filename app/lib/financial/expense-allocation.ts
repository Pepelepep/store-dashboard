import type { FixedExpenseDbRow } from "../dashboard/dashboard-types";

function parseDateOnlyUtc(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getDaysInMonth(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function getMonthKeyFromDateString(value: string | null) {
  return value ? value.slice(0, 7) : null;
}

function allocateCents(totalCents: number, position: number, count: number) {
  const divisor = Math.max(count, 1);
  const base = Math.floor(totalCents / divisor);
  const remainder = totalCents - base * divisor;

  return base + (position < remainder ? 1 : 0);
}

export function allocateExpensesByLocation({
  expenses,
  activeLocationIds,
  startDate,
  endDate,
}: {
  expenses: FixedExpenseDbRow[];
  activeLocationIds: string[];
  startDate: string;
  endDate: string;
}) {
  const sortedLocationIds = Array.from(new Set(activeLocationIds)).sort();
  const totalsInCents = new Map(
    sortedLocationIds.map((locationId) => [locationId, 0]),
  );
  const rangeStart = parseDateOnlyUtc(startDate);
  const rangeEndExclusive = addDays(parseDateOnlyUtc(endDate), 1);
  const selectedDaysByMonth = new Map<
    string,
    { exampleDate: Date; selectedDays: number }
  >();

  for (
    let current = new Date(rangeStart);
    current < rangeEndExclusive;
    current = addDays(current, 1)
  ) {
    const monthKey = getMonthKey(current);
    const month = selectedDaysByMonth.get(monthKey);

    selectedDaysByMonth.set(monthKey, {
      exampleDate: current,
      selectedDays: (month?.selectedDays ?? 0) + 1,
    });
  }

  for (const expense of expenses) {
    if (!expense.is_active) continue;

    const assignedLocationIds = expense.shopify_location_id
      ? sortedLocationIds.filter(
          (locationId) => locationId === expense.shopify_location_id,
        )
      : sortedLocationIds;

    if (assignedLocationIds.length === 0) continue;

    const monthlyCents = Math.round(Number(expense.monthly_amount ?? 0) * 100);
    const expenseStartMonth = getMonthKeyFromDateString(expense.start_month);
    const expenseEndMonth = getMonthKeyFromDateString(expense.end_month);

    for (const [monthKey, month] of selectedDaysByMonth) {
      if (expenseStartMonth && monthKey < expenseStartMonth) continue;
      if (expenseEndMonth && monthKey > expenseEndMonth) continue;

      for (const [
        locationPosition,
        locationId,
      ] of assignedLocationIds.entries()) {
        const proratedCents = Math.round(
          (monthlyCents * month.selectedDays) /
            getDaysInMonth(month.exampleDate),
        );
        const locationCents = expense.shopify_location_id
          ? proratedCents
          : allocateCents(
              proratedCents,
              locationPosition,
              assignedLocationIds.length,
            );

        totalsInCents.set(
          locationId,
          (totalsInCents.get(locationId) ?? 0) + locationCents,
        );
      }
    }
  }

  return new Map(
    Array.from(totalsInCents, ([locationId, cents]) => [
      locationId,
      cents / 100,
    ]),
  );
}
