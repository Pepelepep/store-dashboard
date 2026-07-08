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

const POS_ALIAS_PRIORITY: Array<{
  aliasType: StaffAliasType;
  field: keyof StaffIdentityOrderLine;
}> = [
  {
    aliasType: STAFF_ALIAS_TYPES.posEffectiveStaffId,
    field: "shopops_effective_staff_id",
  },
  {
    aliasType: STAFF_ALIAS_TYPES.posAttributedUserId,
    field: "shopops_attributed_user_id",
  },
  {
    aliasType: STAFF_ALIAS_TYPES.posStaffMemberId,
    field: "shopops_staff_member_id",
  },
  {
    aliasType: STAFF_ALIAS_TYPES.posUserId,
    field: "shopops_user_id",
  },
];

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
  return POS_ALIAS_PRIORITY.map(({ aliasType, field }) => ({
    aliasType,
    aliasValue: normalizeAliasValue(line[field]),
  })).filter(
    (candidate): candidate is { aliasType: StaffAliasType; aliasValue: string } =>
      Boolean(candidate.aliasValue),
  );
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

    if (alias?.person_id && person?.display_name && person.is_active !== false) {
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
      label: "Unmapped staff",
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
