import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchAllSupabasePages } from "../db/supabase-pagination.server";
import { normalizeShopOpsEmail } from "./shopops-access";

export type CanonicalMembershipRow = {
  id: string;
  shop_domain: string;
  person_id: string | null;
  shopify_user_id: string | null;
  normalized_email: string | null;
  display_name: string;
  role: "owner" | "admin" | "manager" | "viewer";
  status: "active" | "disabled";
  is_owner: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CanonicalLocationAccessRow = {
  id: string;
  shop_domain: string;
  membership_id: string | null;
  person_id: string | null;
  user_email: string | null;
  shopify_user_id: string | null;
  role: string | null;
  shopify_location_id: string | null;
  location_name: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
};

export type CanonicalAccessIntegrityIssue = {
  reason:
    | "missing_membership_reference"
    | "membership_not_in_shop"
    | "membership_person_missing"
    | "person_mismatch"
    | "email_mismatch"
    | "hidden_identity_mismatch";
  membershipId: string | null;
  membershipPersonId: string | null;
  personId: string | null;
  userEmail: string | null;
};

const MEMBERSHIP_COLUMNS =
  "id, shop_domain, person_id, shopify_user_id, normalized_email, display_name, role, status, is_owner, created_at, updated_at";
const LOCATION_ACCESS_COLUMNS =
  "id, shop_domain, membership_id, person_id, user_email, shopify_user_id, role, shopify_location_id, location_name, can_view, can_manage";

export async function loadCanonicalMembershipRows({
  label,
  shop,
  supabase,
}: {
  label: string;
  shop: string;
  supabase: SupabaseClient;
}) {
  return fetchAllSupabasePages<CanonicalMembershipRow>({
    label,
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("dashboard_memberships")
        .select(MEMBERSHIP_COLUMNS)
        .eq("shop_domain", shop)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: CanonicalMembershipRow[] | null;
        error: { message: string } | null;
      }>,
  });
}

async function loadLocationAccessRows({
  label,
  shop,
  supabase,
}: {
  label: string;
  shop: string;
  supabase: SupabaseClient;
}) {
  return fetchAllSupabasePages<CanonicalLocationAccessRow>({
    label,
    getRowKey: (row) => row.id,
    fetchPage: (from, to) =>
      supabase
        .from("user_location_access")
        .select(LOCATION_ACCESS_COLUMNS)
        .eq("shop_domain", shop)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: CanonicalLocationAccessRow[] | null;
        error: { message: string } | null;
      }>,
  });
}

function getIntegrityIssue(
  row: CanonicalLocationAccessRow,
  memberships: Map<string, CanonicalMembershipRow>,
): CanonicalAccessIntegrityIssue | null {
  const membership = row.membership_id
    ? memberships.get(row.membership_id)
    : null;
  const base = {
    membershipId: row.membership_id,
    membershipPersonId: membership?.person_id ?? null,
    personId: row.person_id,
    userEmail: normalizeShopOpsEmail(row.user_email),
  };
  if (!row.membership_id) {
    return { ...base, reason: "missing_membership_reference" };
  }
  if (!membership || membership.shop_domain !== row.shop_domain) {
    return { ...base, reason: "membership_not_in_shop" };
  }
  if (!membership.person_id) {
    return { ...base, reason: "membership_person_missing" };
  }
  if (row.person_id !== membership.person_id) {
    return { ...base, reason: "person_mismatch" };
  }
  const membershipEmail = normalizeShopOpsEmail(membership.normalized_email);
  const rowEmail = normalizeShopOpsEmail(row.user_email);
  if (membershipEmail && rowEmail !== membershipEmail) {
    return { ...base, reason: "email_mismatch" };
  }
  const membershipUserId = membership.shopify_user_id?.trim() || null;
  const rowUserId = row.shopify_user_id?.trim() || null;
  if (rowUserId && rowUserId !== membershipUserId) {
    return { ...base, reason: "hidden_identity_mismatch" };
  }
  return null;
}

export async function loadCanonicalShopAccess({
  shop,
  supabase,
}: {
  shop: string;
  supabase: SupabaseClient;
}) {
  const [memberships, locationAccessRows] = await Promise.all([
    loadCanonicalMembershipRows({
      label: "Canonical ShopOps memberships",
      shop,
      supabase,
    }),
    loadLocationAccessRows({
      label: "Canonical ShopOps location access",
      shop,
      supabase,
    }),
  ]);
  const membershipsById = new Map(
    memberships.map((membership) => [membership.id, membership]),
  );
  const integrityIssues: CanonicalAccessIntegrityIssue[] = [];
  const canonicalLocationAccess: CanonicalLocationAccessRow[] = [];

  for (const row of locationAccessRows) {
    const issue = getIntegrityIssue(row, membershipsById);
    if (issue) integrityIssues.push(issue);
    else canonicalLocationAccess.push(row);
  }

  return {
    memberships,
    canonicalLocationAccess,
    integrityIssues,
  };
}

export async function loadCanonicalMembershipLocationAccess({
  membership,
  supabase,
}: {
  membership: CanonicalMembershipRow;
  supabase: SupabaseClient;
}) {
  const rows = await loadLocationAccessRows({
    label: "Dashboard location access",
    shop: membership.shop_domain,
    supabase,
  });
  const memberships = new Map([[membership.id, membership]]);
  return rows.filter(
    (row) =>
      row.membership_id === membership.id &&
      !getIntegrityIssue(row, memberships),
  );
}
