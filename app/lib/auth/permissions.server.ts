import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllSupabasePages } from "../db/supabase-pagination.server";
import { resolveOwnerMaterializationIdentifiers } from "./owner-bootstrap";

type ShopifySessionLike = {
  shop: string;
  userId?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  accountOwner?: boolean | null;
  onlineAccessInfo?: {
    associated_user?: {
      id?: number | string | null;
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      account_owner?: boolean | null;
    } | null;
  } | null;
};

export type DashboardRole = "owner" | "admin" | "manager" | "viewer";

export type CurrentUserIdentity = {
  shop: string;
  email: string | null;
  shopifyUserId: string | null;
  displayName: string;
  isShopifyAccountOwner: boolean;
};

export type DashboardMembership = {
  id: string;
  personId: string | null;
  shopifyUserId: string | null;
  userEmail: string | null;
  displayName: string;
  role: DashboardRole;
  status: "active" | "disabled";
  isOwner: boolean;
};

export type PermissionContext = {
  identity: CurrentUserIdentity;
  membership: DashboardMembership | null;
  hasOwner: boolean;
  isActiveMember: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  role: DashboardRole | null;
  accessSource: "owner" | "membership" | "owner_setup_required" | "none";
  allowedLocationIds: Set<string>;
};

type MembershipRow = {
  id: string;
  person_id: string | null;
  shopify_user_id: string | null;
  normalized_email: string | null;
  display_name: string;
  role: DashboardRole;
  status: "active" | "disabled";
  is_owner: boolean;
};

type PermissionRow = {
  id: string;
  shopify_location_id: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
};

export class OwnerBootstrapError extends Error {
  readonly reason:
    | "identity_conflict"
    | "identity_missing"
    | "storage_unavailable";

  constructor(reason: OwnerBootstrapError["reason"]) {
    super("Owner access setup is temporarily unavailable.");
    this.name = "OwnerBootstrapError";
    this.reason = reason;
  }
}

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

function normalizeShopifyUserId(userId: string | number | null | undefined) {
  if (userId === undefined || userId === null) return null;
  return String(userId).trim() || null;
}

function toMembership(row: MembershipRow): DashboardMembership {
  return {
    id: row.id,
    personId: row.person_id,
    shopifyUserId: normalizeShopifyUserId(row.shopify_user_id),
    userEmail: normalizeEmail(row.normalized_email),
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    isOwner: row.is_owner,
  };
}

async function loadMembershipRows({
  shop,
  supabase,
  label,
}: {
  shop: string;
  supabase: SupabaseClient;
  label: string;
}) {
  return fetchAllSupabasePages<MembershipRow>({
    label,
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("dashboard_memberships")
        .select(
          "id, person_id, shopify_user_id, normalized_email, display_name, role, status, is_owner",
        )
        .eq("shop_domain", shop)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: MembershipRow[] | null;
        error: { message: string } | null;
      }>,
  });
}

function logOwnerBootstrapFailure({
  route,
  shop,
  reason,
}: {
  route: string;
  shop: string;
  reason: OwnerBootstrapError["reason"];
}) {
  console.error("[owner-bootstrap] controlled failure", {
    route,
    shop,
    reason,
  });
}

/**
 * Identity comes only from the server-verified Shopify session. Request query
 * parameters are deliberately ignored because Shopify authentication has
 * already verified and persisted these fields before this code runs.
 */
export function getCurrentUserIdentity({
  session,
}: {
  request?: Request;
  session: ShopifySessionLike;
}): CurrentUserIdentity {
  const associatedUser = session.onlineAccessInfo?.associated_user;
  const email = normalizeEmail(associatedUser?.email ?? session.email);
  const shopifyUserId = normalizeShopifyUserId(
    associatedUser?.id ?? session.userId,
  );
  const firstName = associatedUser?.first_name ?? session.firstName;
  const lastName = associatedUser?.last_name ?? session.lastName;
  const nameParts = [firstName, lastName]
    .map((part) => part?.trim())
    .filter(Boolean);

  return {
    shop: session.shop,
    email,
    shopifyUserId,
    displayName:
      nameParts.join(" ") || email || shopifyUserId || "Unknown user",
    isShopifyAccountOwner: Boolean(
      associatedUser?.account_owner ?? session.accountOwner,
    ),
  };
}

export async function materializeVerifiedOwner({
  identity,
  supabase,
  route = "permission-context",
}: {
  identity: CurrentUserIdentity;
  supabase: SupabaseClient;
  route?: string;
}) {
  if (!identity.isShopifyAccountOwner) return null;
  if (!identity.shopifyUserId && !identity.email) {
    logOwnerBootstrapFailure({
      route,
      shop: identity.shop,
      reason: "identity_missing",
    });
    throw new OwnerBootstrapError("identity_missing");
  }

  try {
    // A retry handles another request winning the owner insert between the
    // read and the transactionally locked RPC.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rows = await loadMembershipRows({
        shop: identity.shop,
        supabase,
        label: "Owner bootstrap memberships",
      });
      const identifiers = resolveOwnerMaterializationIdentifiers({
        identity,
        memberships: rows.map(toMembership),
      });
      if (!identifiers) {
        throw new OwnerBootstrapError("identity_conflict");
      }

      const { data, error } = await supabase.rpc(
        "materialize_dashboard_owner",
        {
          p_shop_domain: identity.shop,
          p_shopify_user_id: identifiers.shopifyUserId,
          p_normalized_email: identifiers.normalizedEmail,
          p_display_name: identity.displayName,
        },
      );
      if (!error) return typeof data === "string" ? data : null;
      if (attempt === 1) {
        const reason =
          error.code === "23505" ||
          error.message.includes("owner_identity_conflict")
            ? "identity_conflict"
            : "storage_unavailable";
        throw new OwnerBootstrapError(reason);
      }
    }
  } catch (error) {
    const bootstrapError =
      error instanceof OwnerBootstrapError
        ? error
        : new OwnerBootstrapError("storage_unavailable");
    logOwnerBootstrapFailure({
      route,
      shop: identity.shop,
      reason: bootstrapError.reason,
    });
    throw bootstrapError;
  }

  throw new OwnerBootstrapError("storage_unavailable");
}

export async function getPermissionContext({
  session,
  supabase,
  route,
}: {
  request?: Request;
  session: ShopifySessionLike;
  supabase: SupabaseClient;
  route?: string;
}): Promise<PermissionContext> {
  const identity = getCurrentUserIdentity({ session });
  await materializeVerifiedOwner({ identity, supabase, route });

  const membershipRows = await loadMembershipRows({
    shop: session.shop,
    supabase,
    label: "Dashboard memberships",
  });

  const memberships = membershipRows.map(toMembership);
  const owner = memberships.find((membership) => membership.isOwner) ?? null;
  const userIdMembership = memberships.find(
    (candidate) =>
      Boolean(identity.shopifyUserId) &&
      candidate.shopifyUserId === identity.shopifyUserId,
  );
  const emailMembership = memberships.find(
    (candidate) =>
      Boolean(identity.email) && candidate.userEmail === identity.email,
  );
  if (
    !identity.isShopifyAccountOwner &&
    userIdMembership &&
    emailMembership &&
    userIdMembership.id !== emailMembership.id
  ) {
    throw new Response(
      "You don't have access to ShopOps Studio. Contact the store owner.",
      { status: 403 },
    );
  }
  const membership = identity.isShopifyAccountOwner
    ? owner
    : (userIdMembership ?? emailMembership ?? null);
  const activeMembership = membership?.status === "active" ? membership : null;

  const allowedLocationIds = new Set<string>();
  if (activeMembership && !activeMembership.isOwner) {
    const accessRows = await fetchAllSupabasePages<PermissionRow>({
      label: "Dashboard location access",
      getRowKey: (row) => row.id,
      fetchPage: (from, to) =>
        supabase
          .from("user_location_access")
          .select("id, shopify_location_id, can_view, can_manage")
          .eq("shop_domain", session.shop)
          .eq("membership_id", activeMembership.id)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: PermissionRow[] | null;
          error: { message: string } | null;
        }>,
    });

    for (const row of accessRows) {
      if (!row.shopify_location_id || row.shopify_location_id === "*") continue;
      if (row.can_view || row.can_manage) {
        allowedLocationIds.add(row.shopify_location_id);
      }
    }
  }

  const isActiveMember = Boolean(activeMembership);
  const isOwner = Boolean(activeMembership?.isOwner);
  const isAdmin =
    isActiveMember && (isOwner || activeMembership?.role === "admin");
  const accessSource: PermissionContext["accessSource"] = isOwner
    ? "owner"
    : isActiveMember
      ? "membership"
      : owner
        ? "none"
        : "owner_setup_required";

  return {
    identity,
    membership: activeMembership,
    hasOwner: Boolean(owner),
    isActiveMember,
    isOwner,
    isAdmin,
    role: activeMembership?.role ?? null,
    accessSource,
    allowedLocationIds,
  };
}

export async function assertDashboardAccess(args: {
  request?: Request;
  session: ShopifySessionLike;
  supabase: SupabaseClient;
  route?: string;
}) {
  const permissions = await getPermissionContext(args);
  if (!permissions.hasOwner) {
    throw new Response(
      "ShopOps Studio setup must be completed by the Shopify store owner.",
      { status: 403 },
    );
  }
  if (!permissions.isActiveMember) {
    throw new Response(
      "You don't have access to ShopOps Studio. Contact the store owner.",
      { status: 403 },
    );
  }
  return permissions;
}

export async function assertAdminAccess(args: {
  request?: Request;
  session: ShopifySessionLike;
  supabase: SupabaseClient;
  route?: string;
}) {
  const permissions = await assertDashboardAccess(args);
  if (!permissions.isAdmin) {
    throw new Response("Forbidden: admin access required", { status: 403 });
  }
  return permissions;
}

export async function assertOwnerAccess(args: {
  request?: Request;
  session: ShopifySessionLike;
  supabase: SupabaseClient;
  route?: string;
}) {
  const identity = getCurrentUserIdentity({ session: args.session });
  if (!identity.isShopifyAccountOwner) {
    throw new Response("Forbidden: Shopify store owner access required", {
      status: 403,
    });
  }
  const permissions = await assertDashboardAccess(args);
  if (!permissions.isOwner) {
    throw new Response("Forbidden: store owner access required", {
      status: 403,
    });
  }
  return permissions;
}
