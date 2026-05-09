import type {
  AuthenticatedDashboardUser,
  LocationAccessResult,
  UserLocationAccess,
} from "../types/permissions";

export function getAllowedLocationsForUser(
  user: AuthenticatedDashboardUser,
  accessRules: UserLocationAccess[],
): LocationAccessResult {
  const normalizedEmail = user.email.trim().toLowerCase();

  const matchingRules = accessRules.filter((rule) => {
    return (
      rule.shopDomain === user.shopDomain &&
      rule.userEmail.trim().toLowerCase() === normalizedEmail &&
      rule.canView
    );
  });

  const uniqueLocations = new Map<
    string,
    {
      locationId: string;
      locationName: string;
      role: UserLocationAccess["role"];
    }
  >();

  for (const rule of matchingRules) {
    uniqueLocations.set(rule.locationId, {
      locationId: rule.locationId,
      locationName: rule.locationName,
      role: rule.role,
    });
  }

  const allowedLocations = Array.from(uniqueLocations.values());

  return {
    allowedLocationIds: allowedLocations.map((location) => location.locationId),
    allowedLocations,
  };
}

export function canUserAccessLocation(
  user: AuthenticatedDashboardUser,
  locationId: string,
  accessRules: UserLocationAccess[],
): boolean {
  const { allowedLocationIds } = getAllowedLocationsForUser(user, accessRules);

  return allowedLocationIds.includes(locationId);
}

export function assertUserCanAccessLocation(
  user: AuthenticatedDashboardUser,
  locationId: string,
  accessRules: UserLocationAccess[],
): void {
  const canAccess = canUserAccessLocation(user, locationId, accessRules);

  if (!canAccess) {
    throw new Response("Forbidden: location access denied", {
      status: 403,
    });
  }
}
