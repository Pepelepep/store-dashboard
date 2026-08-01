import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "react-router";

import {
  getBillingState,
  getPlanLimits,
  isAccessibleBillingState,
  refreshBillingState,
  type BillingState,
} from "./billing.server";
import {
  assertDashboardAccess,
  type PermissionContext,
} from "./auth/permissions.server";
import { fetchAllSupabasePages } from "./db/supabase-pagination.server";
import {
  summarizeEntitlements,
  type EntitlementLimits,
  type EntitlementMembership,
  type EntitlementSnapshot,
} from "./entitlement-model";

export { summarizeEntitlements } from "./entitlement-model";
export type {
  EntitlementLimits,
  EntitlementLocation,
  EntitlementMembership,
  EntitlementSnapshot,
} from "./entitlement-model";

type AdminGraphqlClient = Parameters<typeof getBillingState>[0]["admin"];

type MembershipRow = {
  id: string;
  person_id: string | null;
  display_name: string;
  normalized_email: string | null;
  role: EntitlementMembership["role"];
  status: EntitlementMembership["status"];
  is_owner: boolean;
};

type LocationRow = {
  id: string;
  shopify_location_id: string;
  name: string;
  shopify_is_active: boolean;
  reporting_enabled: boolean;
};

export function resolveEntitlementLimits(
  billing: BillingState,
): EntitlementLimits {
  if (isAccessibleBillingState(billing)) {
    const limits = getPlanLimits(billing.planHandle);
    return {
      planHandle: billing.planHandle,
      planName: limits.displayName,
      activeLocations: limits.activeLocations,
      dashboardUsers: limits.dashboardUsers,
    };
  }
  return {
    planHandle: null,
    planName: billing.state === "disabled" ? "Billing disabled" : "Unavailable",
    activeLocations: null,
    dashboardUsers: null,
  };
}

export async function getEntitlementSnapshot({
  supabase,
  shop,
  billing,
}: {
  supabase: SupabaseClient;
  shop: string;
  billing: BillingState;
}): Promise<EntitlementSnapshot> {
  const [membershipRows, locationRows] = await Promise.all([
    fetchAllSupabasePages<MembershipRow>({
      label: "Plan dashboard memberships",
      getRowKey: (row) => row.id,
      fetchPage: (from, to) =>
        supabase
          .from("dashboard_memberships")
          .select(
            "id, person_id, display_name, normalized_email, role, status, is_owner",
          )
          .eq("shop_domain", shop)
          .order("is_owner", { ascending: false })
          .order("display_name", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: MembershipRow[] | null;
          error: { message: string } | null;
        }>,
    }),
    fetchAllSupabasePages<LocationRow>({
      label: "Plan reporting locations",
      getRowKey: (row) => row.id,
      fetchPage: (from, to) =>
        supabase
          .from("locations")
          .select(
            "id, shopify_location_id, name, shopify_is_active, reporting_enabled",
          )
          .eq("shop_domain", shop)
          .order("name", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: LocationRow[] | null;
          error: { message: string } | null;
        }>,
    }),
  ]);

  const memberships = membershipRows.map((row) => ({
    id: row.id,
    personId: row.person_id,
    displayName: row.display_name,
    userEmail: row.normalized_email,
    role: row.role,
    status: row.status,
    isOwner: row.is_owner,
  }));
  const locations = locationRows.map((row) => ({
    id: row.id,
    shopifyLocationId: row.shopify_location_id,
    name: row.name,
    shopifyIsActive: row.shopify_is_active,
    reportingEnabled: row.reporting_enabled,
  }));
  const limits = resolveEntitlementLimits(billing);
  const summary = summarizeEntitlements({ memberships, locations, limits });

  return {
    memberships,
    locations,
    owner: memberships.find((membership) => membership.isOwner) ?? null,
    limits,
    ...summary,
  };
}

export async function getFreshPlanLimits({
  admin,
  shop,
}: {
  admin: AdminGraphqlClient;
  shop: string;
}) {
  const billing = await refreshBillingState({ admin, shop });
  if (billing.state === "billing_unavailable") {
    throw new Response("Billing is temporarily unavailable. Please retry.", {
      status: 503,
    });
  }
  if (!isAccessibleBillingState(billing) && billing.state !== "disabled") {
    throw new Response("An active ShopOps Studio plan is required.", {
      status: 402,
    });
  }
  return { billing, limits: resolveEntitlementLimits(billing) };
}

function buildPlanResolutionPath(request: Request) {
  const url = new URL(request.url);
  const search = new URLSearchParams(url.search);
  search.set("tab", "plan");
  search.set("resolution", "required");
  return `/app/settings?${search.toString()}`;
}

export async function assertReportingEntitlements({
  request,
  session,
  supabase,
  admin,
}: {
  request: Request;
  session: Parameters<typeof assertDashboardAccess>[0]["session"];
  supabase: SupabaseClient;
  admin: AdminGraphqlClient;
}): Promise<{
  permissions: PermissionContext;
  billing: BillingState;
  entitlements: EntitlementSnapshot;
}> {
  const permissions = await assertDashboardAccess({
    request,
    session,
    supabase,
  });
  const billing = await getBillingState({ admin, shop: session.shop });
  const entitlements = await getEntitlementSnapshot({
    supabase,
    shop: session.shop,
    billing,
  });

  if (entitlements.resolutionRequired) {
    if (permissions.isAdmin) {
      throw redirect(buildPlanResolutionPath(request));
    }
    throw new Response(
      "Your ShopOps access needs to be updated by the store owner.",
      { status: 403 },
    );
  }

  return { permissions, billing, entitlements };
}
