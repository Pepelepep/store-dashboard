type LocationWithId = {
  shopify_location_id: string;
};

type ReportingScopePermissions = {
  allowedLocationIds: Set<string>;
  capabilities: { all_locations: boolean };
};

export function resolveReportingScope<T extends LocationWithId>({
  locations,
  permissions,
  requestedLocationIds = [],
  route,
  shop,
}: {
  locations: T[];
  permissions: ReportingScopePermissions;
  requestedLocationIds?: Iterable<string>;
  route: string;
  shop: string;
}) {
  const hasAllLocations = permissions.capabilities.all_locations;
  const accessibleLocations = hasAllLocations
    ? locations
    : locations.filter((location) =>
        permissions.allowedLocationIds.has(location.shopify_location_id),
      );
  const accessibleById = new Map(
    accessibleLocations.map((location) => [
      location.shopify_location_id,
      location,
    ]),
  );
  const requestedIds = [...new Set(requestedLocationIds)].filter(Boolean);
  const unauthorizedCount = requestedIds.filter(
    (locationId) => !accessibleById.has(locationId),
  ).length;

  if (unauthorizedCount > 0) {
    console.info("[shopops-access] reporting scope denied", {
      route,
      shop,
      reason: "location_restricted",
      requestedLocationCount: requestedIds.length,
      unauthorizedLocationCount: unauthorizedCount,
    });
    throw new Response(
      "This location is not included in your ShopOps access.",
      {
        status: 403,
        headers: { "X-ShopOps-Denial-Reason": "location_restricted" },
      },
    );
  }

  if (
    !hasAllLocations &&
    locations.length > 0 &&
    accessibleLocations.length === 0
  ) {
    console.info("[shopops-access] reporting scope denied", {
      route,
      shop,
      reason: "locations_missing",
    });
    throw new Response("No reporting locations are assigned to this access.", {
      status: 403,
      headers: { "X-ShopOps-Denial-Reason": "locations_missing" },
    });
  }

  return {
    accessibleLocations,
    hasAllLocations,
    selectedLocations:
      requestedIds.length > 0
        ? requestedIds.map((locationId) => accessibleById.get(locationId)!)
        : accessibleLocations,
  };
}
