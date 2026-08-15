const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_INTERACTIVE_REPORT_DAYS = 366;
export const MAX_INTERACTIVE_ORDER_LINES = 100_000;
export const MAX_INTERACTIVE_INVENTORY_ROWS = 250_000;

function parseIsoDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function assertInteractiveReportDateRange({
  startDate,
  endDate,
  maxDays = MAX_INTERACTIVE_REPORT_DAYS,
}: {
  startDate: string;
  endDate: string;
  maxDays?: number;
}) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) {
    throw new Error("Choose a valid reporting date range.");
  }

  const selectedDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (selectedDays < 1) {
    throw new Error("The reporting start date must not be after the end date.");
  }
  if (selectedDays > maxDays) {
    throw new Error(
      `Interactive reports are limited to ${maxDays} days. Narrow the date range or use an export.`,
    );
  }

  return selectedDays;
}
