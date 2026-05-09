export type LocationRole = "admin" | "manager" | "viewer";

export type UserLocationAccess = {
  shopDomain: string;
  shopifyUserId?: string;
  userEmail: string;
  locationId: string;
  locationName: string;
  role: LocationRole;
  canView: boolean;
};

export type AuthenticatedDashboardUser = {
  shopDomain: string;
  shopifyUserId?: string;
  email: string;
  name?: string;
  isShopAdmin?: boolean;
};

export type LocationAccessResult = {
  allowedLocationIds: string[];
  allowedLocations: {
    locationId: string;
    locationName: string;
    role: LocationRole;
  }[];
};
