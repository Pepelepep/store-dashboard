export function filterByLocation<T extends { locationId?: string }>(
  rows: T[],
  selectedLocationId: string,
): T[] {
  if (!selectedLocationId) {
    return rows;
  }

  return rows.filter((row) => row.locationId === selectedLocationId);
}

export function groupByLocation<T extends { locationId?: string; locationName?: string }>(
  rows: T[],
) {
  return rows.reduce<Record<string, { locationId: string; locationName: string; rows: T[] }>>(
    (acc, row) => {
      const locationId = row.locationId ?? "unknown";
      const locationName = row.locationName ?? "Unknown location";

      if (!acc[locationId]) {
        acc[locationId] = {
          locationId,
          locationName,
          rows: [],
        };
      }

      acc[locationId].rows.push(row);

      return acc;
    },
    {},
  );
}