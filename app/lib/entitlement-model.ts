export type EntitlementMembership = {
  id: string;
  personId: string | null;
  displayName: string;
  userEmail: string | null;
  role: "owner" | "admin" | "manager" | "viewer";
  status: "active" | "disabled";
  isOwner: boolean;
};

export type EntitlementLocation = {
  id: string;
  shopifyLocationId: string;
  name: string;
  shopifyIsActive: boolean;
  reportingEnabled: boolean;
};

export type EntitlementLimits = {
  planHandle: "solo" | "growth" | "multi-location" | "qa-pilot" | null;
  planName: string;
  activeLocations: number | null;
  dashboardUsers: number | null;
};

export type EntitlementSnapshot = {
  memberships: EntitlementMembership[];
  locations: EntitlementLocation[];
  owner: EntitlementMembership | null;
  activeDashboardUsers: number;
  activeReportingLocations: number;
  limits: EntitlementLimits;
  userLimitExceeded: boolean;
  locationLimitExceeded: boolean;
  locationSelectionRequired: boolean;
  resolutionRequired: boolean;
};

export function summarizeEntitlements({
  memberships,
  locations,
  limits,
}: {
  memberships: EntitlementMembership[];
  locations: EntitlementLocation[];
  limits: EntitlementLimits;
}): Omit<
  EntitlementSnapshot,
  "memberships" | "locations" | "owner" | "limits"
> {
  const activeDashboardUsers = memberships.filter(
    (membership) => membership.status === "active",
  ).length;
  const detectedActiveLocations = locations.filter(
    (location) => location.shopifyIsActive,
  ).length;
  const activeReportingLocations = locations.filter(
    (location) => location.shopifyIsActive && location.reportingEnabled,
  ).length;
  const userLimitExceeded =
    limits.dashboardUsers !== null &&
    activeDashboardUsers > limits.dashboardUsers;
  const locationLimitExceeded =
    limits.activeLocations !== null &&
    activeReportingLocations > limits.activeLocations;
  const locationSelectionRequired =
    detectedActiveLocations > 0 && activeReportingLocations === 0;

  return {
    activeDashboardUsers,
    activeReportingLocations,
    userLimitExceeded,
    locationLimitExceeded,
    locationSelectionRequired,
    resolutionRequired:
      userLimitExceeded || locationLimitExceeded || locationSelectionRequired,
  };
}
