import type { SupabaseClient } from "@supabase/supabase-js";

import { STAFF_ALIAS_TYPES } from "../staff-identity/staff-identity";
import {
  loadCanonicalMembershipLocationAccess,
  loadCanonicalMembershipRows,
  type CanonicalMembershipRow,
} from "./canonical-access.server";
import { resolveApprovedDuplicateAccess } from "./duplicate-access.server";
import { resolveOwnerMaterializationIdentifiers } from "./owner-bootstrap";
import {
  getCurrentShopifyUserIdentity as getCurrentUserIdentity,
  normalizeShopOpsEmail,
  type CurrentUserIdentity,
  type ShopifySessionIdentitySource,
} from "./shopops-access";

export { getCurrentShopifyUserIdentity as getCurrentUserIdentity } from "./shopops-access";
export type { CurrentUserIdentity } from "./shopops-access";

export type DashboardRole = "owner" | "admin" | "manager" | "viewer";

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
  accessSource:
    | "owner"
    | "membership"
    | "owner_setup_required"
    | "needs_attention"
    | "none";
  accessReason:
    | "owner"
    | "linked_shopify_user_id"
    | "verified_email_linked"
    | "verified_email_reactivated"
    | "membership_revoked"
    | "membership_missing"
    | "email_unverified"
    | "identity_conflict";
  needsAttention: boolean;
  allowedLocationIds: Set<string>;
};

type MembershipRow = CanonicalMembershipRow;

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

function toMembership(
  row: Pick<
    CanonicalMembershipRow,
    | "id"
    | "person_id"
    | "shopify_user_id"
    | "normalized_email"
    | "display_name"
    | "role"
    | "status"
    | "is_owner"
  >,
): DashboardMembership {
  return {
    id: row.id,
    personId: row.person_id,
    shopifyUserId: row.shopify_user_id?.trim() || null,
    userEmail: normalizeShopOpsEmail(row.normalized_email),
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
  return loadCanonicalMembershipRows({
    label,
    shop,
    supabase,
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

function logAccessDecision({
  route,
  shop,
  reason,
  granted,
}: {
  route: string;
  shop: string;
  reason: PermissionContext["accessReason"];
  granted: boolean;
}) {
  console.info("[shopops-access] authorization decision", {
    route,
    shop,
    reason,
    granted,
  });
}

type IdentityBindingResult =
  | "not_attempted"
  | "bound"
  | "consolidated_reactivation"
  | "duplicate_access_needs_attention"
  | "identity_conflict"
  | "membership_not_bindable"
  | "storage_unavailable";

function membershipDiagnosticState(
  membership: DashboardMembership | null | undefined,
) {
  if (!membership) return "missing";
  if (membership.status === "disabled") return "revoked";
  return membership.shopifyUserId ? "active" : "waiting";
}

function logFirstSignInResolution({
  identity,
  reason,
  matchedByHiddenIdentity,
  matchedByEmail,
  membership,
  bindingAttempted,
  activationAttempted,
  result,
}: {
  identity: CurrentUserIdentity;
  reason: PermissionContext["accessReason"];
  matchedByHiddenIdentity: boolean;
  matchedByEmail: boolean;
  membership: DashboardMembership | null | undefined;
  bindingAttempted: boolean;
  activationAttempted: boolean;
  result: IdentityBindingResult;
}) {
  console.info("[shopops-access] first-sign-in resolution", {
    shop: identity.shop,
    reason,
    associatedShopifyUserPresent: Boolean(identity.shopifyUserId),
    verifiedAuthenticatedEmailPresent: Boolean(
      identity.isEmailVerified && identity.email,
    ),
    matchedByHiddenIdentity,
    matchedByEmail,
    membershipState: membershipDiagnosticState(membership),
    bindingAttempted,
    activationAttempted,
    result,
  });
}

async function markIdentityNeedsAttention({
  identity,
  supabase,
}: {
  identity: CurrentUserIdentity;
  supabase: SupabaseClient;
}) {
  if (!identity.email && !identity.shopifyUserId) return;
  const now = new Date().toISOString();
  let personId: string | null = null;

  if (identity.shopifyUserId) {
    const alias = await supabase
      .from("staff_identity_aliases")
      .select("person_id")
      .eq("shop_domain", identity.shop)
      .eq("alias_type", STAFF_ALIAS_TYPES.shopifyAdminUserId)
      .eq("alias_value", identity.shopifyUserId)
      .maybeSingle();
    if (!alias.error) personId = alias.data?.person_id ?? null;
  }

  if (!personId && identity.email) {
    const person = await supabase
      .from("staff_people")
      .select("id, email")
      .eq("shop_domain", identity.shop)
      .ilike("email", identity.email)
      .limit(20);
    if (!person.error) {
      personId =
        (person.data ?? []).find(
          (candidate) =>
            normalizeShopOpsEmail(candidate.email) === identity.email,
        )?.id ?? null;
    }
  }

  if (!personId && identity.email) {
    const created = await supabase
      .from("staff_people")
      .insert({
        shop_domain: identity.shop,
        display_name: identity.displayName,
        email: identity.email,
      })
      .select("id")
      .single();
    if (!created.error) {
      personId = created.data.id;
    } else if (created.error.code === "23505") {
      const existing = await supabase
        .from("staff_people")
        .select("id, email")
        .eq("shop_domain", identity.shop)
        .ilike("email", identity.email)
        .limit(20);
      if (!existing.error) {
        personId =
          (existing.data ?? []).find(
            (candidate) =>
              normalizeShopOpsEmail(candidate.email) === identity.email,
          )?.id ?? null;
      }
    }
  }

  if (!personId || !identity.email) return;
  const aliases = [
    {
      aliasType: STAFF_ALIAS_TYPES.email,
      aliasValue: identity.email,
    },
    ...(identity.shopifyUserId
      ? [
          {
            aliasType: STAFF_ALIAS_TYPES.shopifyAdminUserId,
            aliasValue: identity.shopifyUserId,
          },
        ]
      : []),
  ];
  for (const alias of aliases) {
    const existing = await supabase
      .from("staff_identity_aliases")
      .select("id, person_id")
      .eq("shop_domain", identity.shop)
      .eq("alias_type", alias.aliasType)
      .eq("alias_value", alias.aliasValue)
      .maybeSingle();
    if (existing.error) continue;
    if (existing.data) {
      await supabase
        .from("staff_identity_aliases")
        .update({
          review_status: "pending",
          last_seen_at: now,
          updated_at: now,
        })
        .eq("shop_domain", identity.shop)
        .eq("id", existing.data.id);
      continue;
    }
    await supabase.from("staff_identity_aliases").insert({
      shop_domain: identity.shop,
      person_id: personId,
      alias_type: alias.aliasType,
      alias_value: alias.aliasValue,
      source: "authenticated_session_attention",
      review_status: "pending",
      first_seen_at: now,
      last_seen_at: now,
      updated_at: now,
    });
  }
}

async function bindVerifiedMembership({
  identity,
  membership,
  memberships,
  supabase,
}: {
  identity: CurrentUserIdentity;
  membership: DashboardMembership;
  memberships: DashboardMembership[];
  supabase: SupabaseClient;
}) {
  if (
    !identity.isEmailVerified ||
    !identity.email ||
    !identity.shopifyUserId ||
    !membership.personId ||
    membership.status !== "active"
  ) {
    return {
      membership: null,
      bindingAttempted: false,
      activationAttempted: false,
      result: "membership_not_bindable" as const,
    };
  }
  const userIdConflict = memberships.find(
    (candidate) =>
      candidate.id !== membership.id &&
      candidate.shopifyUserId === identity.shopifyUserId,
  );
  if (userIdConflict || membership.shopifyUserId) {
    return {
      membership: null,
      bindingAttempted: true,
      activationAttempted: false,
      result: "identity_conflict" as const,
    };
  }

  const activated = await supabase.rpc("bind_verified_shopops_identity", {
    p_shop_domain: identity.shop,
    p_membership_id: membership.id,
    p_person_id: membership.personId,
    p_shopify_user_id: identity.shopifyUserId,
    p_verified_email: identity.email,
  });
  if (activated.error) {
    return {
      membership: null,
      bindingAttempted: true,
      activationAttempted: true,
      result:
        activated.error.code === "23505" ||
        activated.error.message.includes("identity_in_use")
          ? ("identity_conflict" as const)
          : ("storage_unavailable" as const),
    };
  }

  const bound = await supabase
    .from("dashboard_memberships")
    .select(
      "id, person_id, shopify_user_id, normalized_email, display_name, role, status, is_owner",
    )
    .eq("shop_domain", identity.shop)
    .eq("id", membership.id)
    .maybeSingle();
  if (
    bound.error ||
    !bound.data ||
    bound.data.status !== "active" ||
    bound.data.shopify_user_id !== identity.shopifyUserId
  ) {
    return {
      membership: null,
      bindingAttempted: true,
      activationAttempted: true,
      result: bound.error
        ? ("storage_unavailable" as const)
        : ("identity_conflict" as const),
    };
  }

  return {
    membership: toMembership(bound.data as MembershipRow),
    bindingAttempted: true,
    activationAttempted: true,
    result: "bound" as const,
  };
}

async function synchronizeVerifiedEmail({
  identity,
  membership,
  memberships,
  supabase,
}: {
  identity: CurrentUserIdentity;
  membership: DashboardMembership;
  memberships: DashboardMembership[];
  supabase: SupabaseClient;
}) {
  if (
    !identity.isEmailVerified ||
    !identity.email ||
    identity.email === membership.userEmail
  ) {
    return { membership, needsAttention: false };
  }
  if (
    memberships.some(
      (candidate) =>
        candidate.id !== membership.id &&
        candidate.userEmail === identity.email,
    )
  ) {
    return { membership, needsAttention: true };
  }

  if (membership.personId) {
    const conflictingPerson = await supabase
      .from("staff_people")
      .select("id, email")
      .eq("shop_domain", identity.shop)
      .ilike("email", identity.email)
      .neq("id", membership.personId)
      .limit(20);
    if (
      conflictingPerson.error ||
      (conflictingPerson.data ?? []).some(
        (candidate) =>
          normalizeShopOpsEmail(candidate.email) === identity.email,
      )
    ) {
      return { membership, needsAttention: true };
    }
    const conflictingAlias = await supabase
      .from("staff_identity_aliases")
      .select("person_id")
      .eq("shop_domain", identity.shop)
      .eq("alias_type", STAFF_ALIAS_TYPES.email)
      .eq("alias_value", identity.email)
      .maybeSingle();
    if (
      conflictingAlias.error ||
      (conflictingAlias.data?.person_id &&
        conflictingAlias.data.person_id !== membership.personId)
    ) {
      return { membership, needsAttention: true };
    }
  }

  if (!membership.personId || !identity.shopifyUserId) {
    return { membership, needsAttention: true };
  }
  const updated = await supabase.rpc("bind_verified_shopops_identity", {
    p_shop_domain: identity.shop,
    p_membership_id: membership.id,
    p_person_id: membership.personId,
    p_shopify_user_id: identity.shopifyUserId,
    p_verified_email: identity.email,
  });
  if (updated.error) return { membership, needsAttention: true };
  return {
    membership: { ...membership, userEmail: identity.email },
    needsAttention: false,
  };
}

/**
 * Identity comes only from the server-verified Shopify session. Request query
 * parameters are deliberately ignored because Shopify authentication has
 * already verified and persisted these fields before this code runs.
 */
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
        identity: {
          shopifyUserId: identity.shopifyUserId,
          email: identity.isEmailVerified ? identity.email : null,
        },
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
  session: ShopifySessionIdentitySource;
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
      identity.isEmailVerified &&
      Boolean(identity.email) &&
      candidate.userEmail === identity.email,
  );
  let needsAttention = false;
  let accessReason: PermissionContext["accessReason"];
  let membership: DashboardMembership | null;
  let bindingAttempted = false;
  let activationAttempted = false;
  let bindingResult: IdentityBindingResult = "not_attempted";
  if (identity.isShopifyAccountOwner) {
    membership = owner;
    accessReason = "owner";
  } else if (userIdMembership?.status === "disabled") {
    const ownerMembership = memberships.find(
      (candidate) => candidate.isOwner && candidate.status === "active",
    );
    if (
      identity.isEmailVerified &&
      identity.email &&
      identity.shopifyUserId &&
      ownerMembership &&
      emailMembership?.status === "active" &&
      emailMembership.id !== userIdMembership.id &&
      !emailMembership.shopifyUserId
    ) {
      bindingAttempted = true;
      activationAttempted = true;
      const resolution = await resolveApprovedDuplicateAccess({
        ownerMembershipId: ownerMembership.id,
        revokedMembershipId: userIdMembership.id,
        shop: identity.shop,
        shopifyUserId: identity.shopifyUserId,
        supabase,
        verifiedEmail: identity.email,
        waitingMembershipId: emailMembership.id,
      });
      if (resolution.status === "resolved") {
        membership = toMembership(resolution.membership);
        accessReason = "verified_email_reactivated";
        bindingResult = "consolidated_reactivation";
      } else {
        membership = userIdMembership;
        needsAttention = true;
        accessReason = "identity_conflict";
        bindingResult = "duplicate_access_needs_attention";
        await markIdentityNeedsAttention({ identity, supabase });
      }
    } else {
      membership = userIdMembership;
      accessReason = "membership_revoked";
    }
  } else if (userIdMembership) {
    membership = userIdMembership;
    const synchronized = await synchronizeVerifiedEmail({
      identity,
      membership,
      memberships,
      supabase,
    });
    membership = synchronized.membership;
    needsAttention = synchronized.needsAttention;
    accessReason = needsAttention
      ? "identity_conflict"
      : "linked_shopify_user_id";
  } else if (emailMembership?.status === "active") {
    const linked = await bindVerifiedMembership({
      identity,
      membership: emailMembership,
      memberships,
      supabase,
    });
    membership = linked.membership;
    bindingAttempted = linked.bindingAttempted;
    activationAttempted = linked.activationAttempted;
    bindingResult = linked.result;
    needsAttention = !linked.membership;
    accessReason = linked.membership
      ? "verified_email_linked"
      : "identity_conflict";
    if (!linked.membership) {
      await markIdentityNeedsAttention({ identity, supabase });
    }
  } else if (emailMembership?.status === "disabled") {
    membership = emailMembership;
    accessReason = "membership_revoked";
  } else {
    membership = null;
    needsAttention = true;
    accessReason = identity.isEmailVerified
      ? "membership_missing"
      : "email_unverified";
    await markIdentityNeedsAttention({ identity, supabase });
  }
  const activeMembership = membership?.status === "active" ? membership : null;

  const allowedLocationIds = new Set<string>();
  if (activeMembership && !activeMembership.isOwner) {
    const membershipSnapshot = membershipRows.find(
      (row) => row.id === activeMembership.id,
    );
    // Identity-binding and duplicate-resolution RPCs may have committed after
    // membershipRows was loaded. Overlay their verified result so this same
    // request evaluates the freshly canonicalized location rows correctly.
    const canonicalMembership = membershipSnapshot
      ? {
          ...membershipSnapshot,
          person_id: activeMembership.personId,
          shopify_user_id: activeMembership.shopifyUserId,
          normalized_email: activeMembership.userEmail,
          display_name: activeMembership.displayName,
          role: activeMembership.role,
          status: activeMembership.status,
          is_owner: activeMembership.isOwner,
        }
      : null;
    const accessRows = canonicalMembership
      ? await loadCanonicalMembershipLocationAccess({
          membership: canonicalMembership,
          supabase,
        })
      : [];

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
      : needsAttention
        ? "needs_attention"
        : owner
          ? "none"
          : "owner_setup_required";

  logAccessDecision({
    route: route ?? "permission-context",
    shop: identity.shop,
    reason: accessReason,
    granted: isActiveMember,
  });
  logFirstSignInResolution({
    identity,
    reason: accessReason,
    matchedByHiddenIdentity: Boolean(userIdMembership),
    matchedByEmail: Boolean(emailMembership),
    membership: membership ?? userIdMembership ?? emailMembership,
    bindingAttempted,
    activationAttempted,
    result: bindingResult,
  });

  return {
    identity,
    membership: activeMembership,
    hasOwner: Boolean(owner),
    isActiveMember,
    isOwner,
    isAdmin,
    role: activeMembership?.role ?? null,
    accessSource,
    accessReason,
    needsAttention,
    allowedLocationIds,
  };
}

export async function assertDashboardAccess(args: {
  request?: Request;
  session: ShopifySessionIdentitySource;
  supabase: SupabaseClient;
  route?: string;
}) {
  const permissions = await getPermissionContext(args);
  if (!permissions.hasOwner) {
    logAccessDecision({
      route: args.route ?? "dashboard-access",
      shop: permissions.identity.shop,
      reason: "membership_missing",
      granted: false,
    });
    throw new Response(
      "ShopOps Studio setup must be completed by the Shopify store owner.",
      { status: 403 },
    );
  }
  if (!permissions.isActiveMember) {
    throw new Response("ShopOps access required.", { status: 403 });
  }
  return permissions;
}

export async function assertAdminAccess(args: {
  request?: Request;
  session: ShopifySessionIdentitySource;
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
  session: ShopifySessionIdentitySource;
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
