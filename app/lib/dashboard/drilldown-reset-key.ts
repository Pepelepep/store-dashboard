export function buildDrilldownResetKey({
  startDate,
  endDate,
  period,
  locationIds,
  staff,
  vendor,
}: {
  startDate: string;
  endDate: string;
  period?: string;
  locationIds: string[];
  staff: string;
  vendor: string;
}) {
  return JSON.stringify({
    startDate,
    endDate,
    period: period ?? "",
    locationIds: [...locationIds].sort(),
    staff,
    vendor,
  });
}
