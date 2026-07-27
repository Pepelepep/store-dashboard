type LocationWithId = {
  shopify_location_id: string;
};

export function getAccessibleLocationRows<T extends LocationWithId>({
  locations,
  isAdmin,
  allowedLocationIds,
}: {
  locations: T[];
  isAdmin: boolean;
  allowedLocationIds: Set<string>;
}) {
  return isAdmin
    ? locations
    : locations.filter((location) =>
        allowedLocationIds.has(location.shopify_location_id),
      );
}

export function hasNoAssignedLocationAccess({
  activeLocationCount,
  accessibleLocationCount,
  isAdmin,
}: {
  activeLocationCount: number;
  accessibleLocationCount: number;
  isAdmin: boolean;
}) {
  return !isAdmin && activeLocationCount > 0 && accessibleLocationCount === 0;
}
