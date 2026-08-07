export type ShopOpsRole = "viewer" | "manager" | "admin" | "owner";

export type ShopOpsCapability =
  | "view_dashboard"
  | "view_locations"
  | "assigned_locations"
  | "manage_people"
  | "manage_costs"
  | "view_data_quality"
  | "manage_sync"
  | "manage_settings"
  | "manage_billing"
  | "all_locations";

export type ShopOpsCapabilitySet = Record<ShopOpsCapability, boolean>;

type ShopOpsRoleDefinition = {
  label: string;
  description: string;
  defaultPath: "/app/locations" | "/app/db-dashboard";
  capabilities: ShopOpsCapabilitySet;
};

export const SHOP_OPS_ROLE_DEFINITIONS = {
  viewer: {
    label: "Location viewer",
    description: "View performance for assigned locations only.",
    defaultPath: "/app/db-dashboard",
    capabilities: {
      view_dashboard: true,
      view_locations: false,
      assigned_locations: true,
      manage_people: false,
      manage_costs: false,
      view_data_quality: false,
      manage_sync: false,
      manage_settings: false,
      manage_billing: false,
      all_locations: false,
    },
  },
  manager: {
    label: "Reporting manager",
    description: "View the Dashboard and performance for assigned locations.",
    defaultPath: "/app/db-dashboard",
    capabilities: {
      view_dashboard: true,
      view_locations: true,
      assigned_locations: true,
      manage_people: false,
      manage_costs: false,
      view_data_quality: false,
      manage_sync: false,
      manage_settings: false,
      manage_billing: false,
      all_locations: false,
    },
  },
  admin: {
    label: "Admin",
    description:
      "Manage reporting, people, costs, synchronization, and settings. Billing remains owner-only.",
    defaultPath: "/app/db-dashboard",
    capabilities: {
      view_dashboard: true,
      view_locations: true,
      assigned_locations: false,
      manage_people: true,
      manage_costs: true,
      view_data_quality: true,
      manage_sync: true,
      manage_settings: true,
      manage_billing: false,
      all_locations: true,
    },
  },
  owner: {
    label: "Owner",
    description:
      "Manage all ShopOps reporting, operations, settings, and billing.",
    defaultPath: "/app/db-dashboard",
    capabilities: {
      view_dashboard: true,
      view_locations: true,
      assigned_locations: false,
      manage_people: true,
      manage_costs: true,
      view_data_quality: true,
      manage_sync: true,
      manage_settings: true,
      manage_billing: true,
      all_locations: true,
    },
  },
} as const satisfies Record<ShopOpsRole, ShopOpsRoleDefinition>;

export const ASSIGNABLE_SHOP_OPS_ROLES = [
  "viewer",
  "manager",
  "admin",
] as const satisfies readonly ShopOpsRole[];

export type AssignableShopOpsRole = (typeof ASSIGNABLE_SHOP_OPS_ROLES)[number];

export const SHOP_OPS_NAVIGATION = [
  {
    capability: "view_dashboard",
    href: "/app/db-dashboard",
    label: "Overview",
  },
  {
    capability: "view_locations",
    href: "/app/locations",
    label: "Compare Locations",
  },
  { capability: "manage_costs", href: "/app/costs", label: "Costs" },
  { capability: "manage_people", href: "/app/people", label: "People" },
  {
    capability: "manage_settings",
    href: "/app/settings",
    label: "Settings",
    tab: "plan",
  },
] as const satisfies ReadonlyArray<{
  capability: ShopOpsCapability;
  href: string;
  label: string;
  tab?: "plan" | "sync";
}>;

const NO_CAPABILITIES: ShopOpsCapabilitySet = {
  view_dashboard: false,
  view_locations: false,
  assigned_locations: false,
  manage_people: false,
  manage_costs: false,
  view_data_quality: false,
  manage_sync: false,
  manage_settings: false,
  manage_billing: false,
  all_locations: false,
};

export function getShopOpsCapabilities(
  role: ShopOpsRole | null | undefined,
): ShopOpsCapabilitySet {
  return role
    ? { ...SHOP_OPS_ROLE_DEFINITIONS[role].capabilities }
    : { ...NO_CAPABILITIES };
}

export function hasShopOpsCapability(
  role: ShopOpsRole | null | undefined,
  capability: ShopOpsCapability,
) {
  return role
    ? SHOP_OPS_ROLE_DEFINITIONS[role].capabilities[capability]
    : false;
}

export function getShopOpsDefaultPath(role: ShopOpsRole) {
  return SHOP_OPS_ROLE_DEFINITIONS[role].defaultPath;
}

export function getShopOpsNavigation(role: ShopOpsRole | null | undefined) {
  if (!role) return [];
  return SHOP_OPS_NAVIGATION.filter((item) =>
    hasShopOpsCapability(role, item.capability),
  );
}

export function isAssignableShopOpsRole(
  role: string,
): role is AssignableShopOpsRole {
  return (ASSIGNABLE_SHOP_OPS_ROLES as readonly string[]).includes(role);
}

export function normalizeShopOpsAccessConfiguration({
  locationIds,
  role,
}: {
  locationIds: Iterable<string>;
  role: string;
}) {
  if (!isAssignableShopOpsRole(role)) return null;
  const normalizedLocationIds = [
    ...new Set(
      [...locationIds].map((locationId) => locationId.trim()).filter(Boolean),
    ),
  ];
  if (
    SHOP_OPS_ROLE_DEFINITIONS[role].capabilities.assigned_locations &&
    normalizedLocationIds.length === 0
  ) {
    return null;
  }
  return {
    role,
    locationIds: SHOP_OPS_ROLE_DEFINITIONS[role].capabilities.all_locations
      ? []
      : normalizedLocationIds,
  };
}
