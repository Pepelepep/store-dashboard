export const STAFF_ALIAS_TYPES = {
  email: "email",
  shopifyAdminUserId: "shopify_admin_user_id",
  posStaffMemberId: "pos_staff_member_id",
  posUserId: "pos_user_id",
  posAttributedUserId: "pos_attributed_user_id",
  posEffectiveStaffId: "pos_effective_staff_id",
} as const;

export type StaffAliasType =
  (typeof STAFF_ALIAS_TYPES)[keyof typeof STAFF_ALIAS_TYPES];

export type StaffPersonRow = {
  id: string;
  shop_domain: string;
  display_name: string;
  email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffIdentityAliasRow = {
  id: string;
  shop_domain: string;
  person_id: string | null;
  alias_type: StaffAliasType;
  alias_value: string;
  source: string | null;
  review_status?: "pending" | "deferred" | "mapped";
  suggestion_dismissed_at?: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_location_id: string | null;
  last_device_id: string | null;
  last_device_name: string | null;
  created_at: string;
  updated_at: string;
  staff_people?: StaffPersonRow | StaffPersonRow[] | null;
};

export type StaffIdentityOrderLine = {
  created_at_shopify?: string | null;
  shopops_staff_member_id?: string | null;
  shopops_user_id?: string | null;
  shopops_attributed_user_id?: string | null;
  shopops_effective_staff_id?: string | null;
  shopops_attribution_source?: string | null;
  shopops_pos_location_id?: string | null;
  shopops_pos_device_id?: string | null;
  shopops_pos_device_name?: string | null;
};

export type StaffResolution = {
  label: string;
  status: "mapped" | "unmapped" | "unassigned";
  staffKey: string;
  matchedAliasType: StaffAliasType | null;
  matchedAliasValue: string | null;
};

function normalizeAliasValue(value: string | null | undefined) {
  return value?.trim() || null;
}

export function staffIdentityAliasKey(
  aliasType: StaffAliasType,
  aliasValue: string,
) {
  return `${aliasType}:${aliasValue}`;
}

export function getStaffIdentityAliasCandidates(line: StaffIdentityOrderLine) {
  const effectiveId = normalizeAliasValue(line.shopops_effective_staff_id);
  if (!effectiveId) return [];

  switch (line.shopops_attribution_source) {
    case "attributed_user_id":
      return [
        {
          aliasType: STAFF_ALIAS_TYPES.posAttributedUserId,
          aliasValue: effectiveId,
        },
      ];
    case "attributed_staff_member_id":
      return [
        {
          aliasType: STAFF_ALIAS_TYPES.posStaffMemberId,
          aliasValue: effectiveId,
        },
      ];
    // A session id (whoever is logged into the POS register) is not a
    // stable per-person identity — the same register can ring up sales for
    // different real staff. It must never be resolvable through the same
    // alias types as a genuine explicit attribution, so it falls through to
    // the catch-all below instead of pos_staff_member_id/pos_user_id.
    case "pos_session_staff_member":
    case "pos_session_user":
    case "pos_session":
    default:
      return [
        {
          aliasType: STAFF_ALIAS_TYPES.posEffectiveStaffId,
          aliasValue: effectiveId,
        },
      ];
  }
}

export function resolveStaffDisplayNameForOrderLine(
  line: StaffIdentityOrderLine,
  aliasesByKey: Map<string, StaffIdentityAliasRow>,
): StaffResolution {
  const candidates = getStaffIdentityAliasCandidates(line);

  for (const candidate of candidates) {
    const alias = aliasesByKey.get(
      staffIdentityAliasKey(candidate.aliasType, candidate.aliasValue),
    );
    const person = Array.isArray(alias?.staff_people)
      ? alias.staff_people[0]
      : alias?.staff_people;

    if (alias?.person_id && person?.display_name) {
      return {
        label: person.display_name,
        status: "mapped",
        staffKey: `person:${alias.person_id}`,
        matchedAliasType: candidate.aliasType,
        matchedAliasValue: candidate.aliasValue,
      };
    }
  }

  if (candidates.length > 0) {
    return {
      label: "Unmapped POS seller",
      status: "unmapped",
      staffKey: "staff:unmapped",
      matchedAliasType: candidates[0].aliasType,
      matchedAliasValue: candidates[0].aliasValue,
    };
  }

  return {
    label: "Unassigned",
    status: "unassigned",
    staffKey: "staff:unassigned",
    matchedAliasType: null,
    matchedAliasValue: null,
  };
}
