export function validateExpenseMonthRange({
  startMonth,
  endMonth,
}: {
  startMonth: string;
  endMonth: string | null;
}) {
  if (!startMonth) {
    return {
      start_month: "Start month is required.",
    };
  }

  if (endMonth && endMonth < startMonth) {
    return {
      end_month: "End month cannot be earlier than start month.",
    };
  }

  return {};
}
