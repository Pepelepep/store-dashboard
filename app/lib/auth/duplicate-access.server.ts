import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllSupabasePages } from "../db/supabase-pagination.server";
import { STAFF_ALIAS_TYPES } from "../staff-identity/staff-identity";
import { normalizeShopOpsEmail } from "./shopops-access";
import { hasShopOpsCapability } from "./role-capabilities";

type MembershipRow = {
  id: string;
  person_id: string | null;
  shopify_user_id: string | null;
  normalized_email: string | null;
  display_name: string;
  role: "owner" | "admin" | "manager" | "viewer";
  status: "active" | "disabled";
  is_owner: boolean;
  updated_at: string;
};

type PersonRow = {
  id: string;
  display_name: string;
  email: string | null;
  is_active: boolean;
};

type AliasRow = {
  id: string;
  person_id: string | null;
  alias_type: string;
  alias_value: string;
  review_status: string | null;
  updated_at: string | null;
};

type LocationAccessRow = {
  id: string;
  membership_id: string | null;
  person_id: string | null;
  user_email: string | null;
  shopify_user_id: string | null;
  shopify_location_id: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
};

export type DuplicateAccessResolution =
  | { status: "resolved"; membership: MembershipRow }
  | {
      status: "needs_attention";
      reason:
        | "ambiguous_identity"
        | "attribution_conflict"
        | "invalid_access_configuration"
        | "resolution_failed";
    };

export type DuplicateAccessCandidate = {
  revokedMembershipId: string;
  waitingMembershipId: string;
  verifiedEmail: string;
  shopifyUserId: string;
};

const MEMBERSHIP_COLUMNS =
  "id, person_id, shopify_user_id, normalized_email, display_name, role, status, is_owner, updated_at";

async function loadMemberships({
  shop,
  supabase,
}: {
  shop: string;
  supabase: SupabaseClient;
}) {
  return fetchAllSupabasePages<MembershipRow>({
    label: "Duplicate access memberships",
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("dashboard_memberships")
        .select(MEMBERSHIP_COLUMNS)
        .eq("shop_domain", shop)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: MembershipRow[] | null;
        error: { message: string } | null;
      }>,
  });
}

async function loadAliases({
  shop,
  supabase,
}: {
  shop: string;
  supabase: SupabaseClient;
}) {
  return fetchAllSupabasePages<AliasRow>({
    label: "Duplicate access aliases",
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("staff_identity_aliases")
        .select(
          "id, person_id, alias_type, alias_value, review_status, updated_at",
        )
        .eq("shop_domain", shop)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: AliasRow[] | null;
        error: { message: string } | null;
      }>,
  });
}

async function reloadMembership({
  id,
  shop,
  supabase,
}: {
  id: string;
  shop: string;
  supabase: SupabaseClient;
}) {
  const result = await supabase
    .from("dashboard_memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("shop_domain", shop)
    .eq("id", id)
    .maybeSingle();
  return result.error ? null : (result.data as MembershipRow | null);
}

function isCanonicalResolvedMembership({
  email,
  membership,
  shopifyUserId,
}: {
  email: string;
  membership: MembershipRow | null;
  shopifyUserId: string;
}) {
  return Boolean(
    membership &&
    membership.status === "active" &&
    membership.shopify_user_id?.trim() === shopifyUserId &&
    normalizeShopOpsEmail(membership.normalized_email) === email,
  );
}

export async function resolveApprovedDuplicateAccess({
  allowAttributedMerge = false,
  ownerMembershipId,
  revokedMembershipId,
  shop,
  shopifyUserId,
  supabase,
  verifiedEmail: rawEmail,
  waitingMembershipId,
}: {
  allowAttributedMerge?: boolean;
  ownerMembershipId: string;
  revokedMembershipId: string;
  shop: string;
  shopifyUserId: string;
  supabase: SupabaseClient;
  verifiedEmail: string;
  waitingMembershipId: string;
}): Promise<DuplicateAccessResolution> {
  const email = normalizeShopOpsEmail(rawEmail);
  if (!email || !shopifyUserId) {
    return { status: "needs_attention", reason: "ambiguous_identity" };
  }

  let memberships: MembershipRow[];
  let aliases: AliasRow[];
  try {
    [memberships, aliases] = await Promise.all([
      loadMemberships({ shop, supabase }),
      loadAliases({ shop, supabase }),
    ]);
  } catch {
    return { status: "needs_attention", reason: "resolution_failed" };
  }

  const revokedMembership = memberships.find(
    (membership) => membership.id === revokedMembershipId,
  );
  const waitingMembership = memberships.find(
    (membership) => membership.id === waitingMembershipId,
  );
  const ownerMembership = memberships.find(
    (membership) => membership.id === ownerMembershipId,
  );
  const hiddenMatches = memberships.filter(
    (membership) => membership.shopify_user_id?.trim() === shopifyUserId,
  );
  const emailMatches = memberships.filter(
    (membership) =>
      normalizeShopOpsEmail(membership.normalized_email) === email,
  );
  if (
    !revokedMembership ||
    !waitingMembership ||
    !ownerMembership?.is_owner ||
    ownerMembership.status !== "active" ||
    revokedMembership.status !== "disabled" ||
    revokedMembership.is_owner ||
    revokedMembership.shopify_user_id?.trim() !== shopifyUserId ||
    !revokedMembership.person_id ||
    waitingMembership.status !== "active" ||
    waitingMembership.is_owner ||
    waitingMembership.shopify_user_id ||
    !waitingMembership.person_id ||
    waitingMembership.person_id === revokedMembership.person_id ||
    normalizeShopOpsEmail(waitingMembership.normalized_email) !== email ||
    hiddenMatches.length !== 1 ||
    emailMatches.length !== 1
  ) {
    const current = await reloadMembership({
      id: revokedMembershipId,
      shop,
      supabase,
    });
    return isCanonicalResolvedMembership({
      email,
      membership: current,
      shopifyUserId,
    })
      ? { status: "resolved", membership: current! }
      : { status: "needs_attention", reason: "ambiguous_identity" };
  }

  const hiddenAliases = aliases.filter(
    (alias) =>
      alias.alias_type === STAFF_ALIAS_TYPES.shopifyAdminUserId &&
      alias.alias_value.trim() === shopifyUserId,
  );
  const emailAliases = aliases.filter(
    (alias) =>
      alias.alias_type === STAFF_ALIAS_TYPES.email &&
      normalizeShopOpsEmail(alias.alias_value) === email,
  );
  if (
    hiddenAliases.length !== 1 ||
    hiddenAliases[0].person_id !== revokedMembership.person_id ||
    emailAliases.length !== 1 ||
    emailAliases[0].person_id !== waitingMembership.person_id
  ) {
    return { status: "needs_attention", reason: "ambiguous_identity" };
  }

  const waitingAliases = aliases.filter(
    (alias) => alias.person_id === waitingMembership.person_id,
  );
  const hasAttributedIdentity = waitingAliases.some(
    (alias) =>
      alias.alias_type !== STAFF_ALIAS_TYPES.email ||
      normalizeShopOpsEmail(alias.alias_value) !== email,
  );
  if (hasAttributedIdentity && !allowAttributedMerge) {
    return { status: "needs_attention", reason: "attribution_conflict" };
  }

  const peopleResult = await supabase
    .from("staff_people")
    .select("id, display_name, email, is_active")
    .eq("shop_domain", shop)
    .in("id", [revokedMembership.person_id, waitingMembership.person_id]);
  if (peopleResult.error || peopleResult.data?.length !== 2) {
    return { status: "needs_attention", reason: "resolution_failed" };
  }
  const people = peopleResult.data as PersonRow[];
  const boundPerson = people.find(
    (person) => person.id === revokedMembership.person_id,
  );
  const waitingPerson = people.find(
    (person) => person.id === waitingMembership.person_id,
  );
  if (!boundPerson || !waitingPerson || !waitingPerson.is_active) {
    return { status: "needs_attention", reason: "ambiguous_identity" };
  }

  const emailPeopleResult = await supabase
    .from("staff_people")
    .select("id, email")
    .eq("shop_domain", shop)
    .ilike("email", email)
    .limit(20);
  const emailPeople = (emailPeopleResult.data ?? []).filter(
    (person) => normalizeShopOpsEmail(person.email) === email,
  );
  if (
    emailPeopleResult.error ||
    emailPeople.length !== 1 ||
    emailPeople[0].id !== waitingPerson.id
  ) {
    return { status: "needs_attention", reason: "ambiguous_identity" };
  }

  let accessRows: LocationAccessRow[];
  try {
    accessRows = await fetchAllSupabasePages<LocationAccessRow>({
      label: "Duplicate access location assignments",
      getRowKey: (row) => row.id,
      fetchPage: (from, to) =>
        supabase
          .from("user_location_access")
          .select(
            "id, membership_id, person_id, user_email, shopify_user_id, shopify_location_id, can_view, can_manage",
          )
          .eq("shop_domain", shop)
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: LocationAccessRow[] | null;
          error: { message: string } | null;
        }>,
    });
  } catch {
    return { status: "needs_attention", reason: "resolution_failed" };
  }
  const allowedMembershipIds = new Set([
    revokedMembership.id,
    waitingMembership.id,
  ]);
  const allowedPersonIds = new Set([boundPerson.id, waitingPerson.id]);
  const thirdAccessClaim = accessRows.some((row) => {
    const claimsIdentity =
      normalizeShopOpsEmail(row.user_email) === email ||
      row.shopify_user_id?.trim() === shopifyUserId;
    if (!claimsIdentity) return false;
    if (row.membership_id && !allowedMembershipIds.has(row.membership_id)) {
      return true;
    }
    if (row.person_id && !allowedPersonIds.has(row.person_id)) return true;
    return !row.membership_id && !row.person_id;
  });
  if (thirdAccessClaim) {
    return { status: "needs_attention", reason: "ambiguous_identity" };
  }
  const locationRows = accessRows.filter(
    (row) => row.membership_id === waitingMembership.id,
  );
  const locationIds = [
    ...new Set(
      locationRows
        .filter((row) => row.can_view || row.can_manage)
        .map((row) => row.shopify_location_id?.trim())
        .filter((value): value is string => Boolean(value && value !== "*")),
    ),
  ];
  if (
    hasShopOpsCapability(waitingMembership.role, "assigned_locations") &&
    locationIds.length === 0
  ) {
    return {
      status: "needs_attention",
      reason: "invalid_access_configuration",
    };
  }

  const resolved = await supabase.rpc("resolve_duplicate_shopops_access", {
    p_shop_domain: shop,
    p_owner_membership_id: ownerMembership.id,
    p_revoked_membership_id: revokedMembership.id,
    p_waiting_membership_id: waitingMembership.id,
    p_shopify_user_id: shopifyUserId,
    p_verified_email: email,
    p_allow_attributed_merge: allowAttributedMerge,
  });
  if (resolved.error) {
    return { status: "needs_attention", reason: "resolution_failed" };
  }

  const resolvedMembership = await reloadMembership({
    id: revokedMembership.id,
    shop,
    supabase,
  });
  return isCanonicalResolvedMembership({
    email,
    membership: resolvedMembership,
    shopifyUserId,
  })
    ? { status: "resolved", membership: resolvedMembership! }
    : { status: "needs_attention", reason: "resolution_failed" };
}

export async function findDuplicateAccessCandidate({
  shop,
  supabase,
  waitingPersonId,
}: {
  shop: string;
  supabase: SupabaseClient;
  waitingPersonId: string;
}): Promise<DuplicateAccessCandidate | null> {
  let memberships: MembershipRow[];
  let aliases: AliasRow[];
  try {
    [memberships, aliases] = await Promise.all([
      loadMemberships({ shop, supabase }),
      loadAliases({ shop, supabase }),
    ]);
  } catch {
    return null;
  }
  const waitingMatches = memberships.filter(
    (membership) =>
      membership.person_id === waitingPersonId &&
      membership.status === "active" &&
      !membership.shopify_user_id &&
      Boolean(normalizeShopOpsEmail(membership.normalized_email)),
  );
  const waiting = waitingMatches[0];
  if (waitingMatches.length !== 1 || !waiting) return null;
  const email = normalizeShopOpsEmail(waiting.normalized_email)!;
  const pendingEmailAliases = aliases.filter(
    (alias) =>
      alias.person_id === waitingPersonId &&
      alias.alias_type === STAFF_ALIAS_TYPES.email &&
      normalizeShopOpsEmail(alias.alias_value) === email &&
      alias.review_status === "pending",
  );
  const attentionTimestamp = pendingEmailAliases[0]?.updated_at;
  const revokedMatches = memberships.filter(
    (membership) =>
      membership.status === "disabled" &&
      Boolean(membership.person_id && membership.shopify_user_id) &&
      aliases.some(
        (alias) =>
          alias.person_id === membership.person_id &&
          alias.alias_type === STAFF_ALIAS_TYPES.shopifyAdminUserId &&
          alias.alias_value.trim() === membership.shopify_user_id?.trim() &&
          alias.review_status === "pending" &&
          alias.updated_at === attentionTimestamp,
      ),
  );
  if (
    pendingEmailAliases.length !== 1 ||
    !attentionTimestamp ||
    revokedMatches.length !== 1
  ) {
    return null;
  }
  return {
    revokedMembershipId: revokedMatches[0].id,
    waitingMembershipId: waiting.id,
    verifiedEmail: email,
    shopifyUserId: revokedMatches[0].shopify_user_id!.trim(),
  };
}
