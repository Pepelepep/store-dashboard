export type ShopOpsAccessState =
  | "pending"
  | "active"
  | "revoked"
  | "archived"
  | "needs_attention";

export type ShopOpsAccessPresentation = {
  label:
    | "Waiting for first sign-in"
    | "Active"
    | "Access revoked"
    | "Needs attention"
    | "Archived";
  showConfiguredRole: boolean;
  tone: "success" | "info" | "warning" | "neutral";
};

export type ShopifySessionIdentitySource = {
  shop: string;
  userId?: string | number | bigint | null;
  email?: string | null;
  emailVerified?: boolean | null;
  firstName?: string | null;
  lastName?: string | null;
  accountOwner?: boolean | null;
  onlineAccessInfo?: {
    associated_user?: {
      id?: number | string | null;
      email?: string | null;
      email_verified?: boolean | null;
      first_name?: string | null;
      last_name?: string | null;
      account_owner?: boolean | null;
    } | null;
  } | null;
};

export type CurrentUserIdentity = {
  shop: string;
  email: string | null;
  shopifyUserId: string | null;
  displayName: string;
  isShopifyAccountOwner: boolean;
  isEmailVerified: boolean;
};

export function normalizeShopOpsEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

export function isValidShopOpsEmail(value: string | null | undefined) {
  const email = normalizeShopOpsEmail(value);
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function normalizeShopifyUserId(
  userId: string | number | bigint | null | undefined,
) {
  if (userId === undefined || userId === null) return null;
  return String(userId).trim() || null;
}

/** Identity fields come only from Shopify's authenticated online session. */
export function getCurrentShopifyUserIdentity({
  session,
}: {
  request?: Request;
  session: ShopifySessionIdentitySource;
}): CurrentUserIdentity {
  const associatedUser = session.onlineAccessInfo?.associated_user;
  const email = normalizeShopOpsEmail(associatedUser?.email ?? session.email);
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
    isEmailVerified: Boolean(
      associatedUser?.email_verified ?? session.emailVerified,
    ),
  };
}

export function getShopOpsAccessState({
  isOwner,
  isPersonActive,
  membershipStatus,
  shopifyUserId,
  needsAttention = false,
}: {
  isOwner: boolean;
  isPersonActive: boolean;
  membershipStatus: "active" | "disabled" | null;
  shopifyUserId: string | null;
  needsAttention?: boolean;
}): ShopOpsAccessState {
  if (isOwner) return "active";
  if (!isPersonActive) return "archived";
  if (membershipStatus === "disabled") return "revoked";
  if (needsAttention) return "needs_attention";
  if (membershipStatus === "active") {
    return shopifyUserId ? "active" : "pending";
  }
  return "needs_attention";
}

export function getShopOpsAccessPresentation({
  state,
  hasApprovedAccess,
}: {
  state: ShopOpsAccessState;
  hasApprovedAccess: boolean;
}): ShopOpsAccessPresentation {
  if (state === "active") {
    return { label: "Active", showConfiguredRole: true, tone: "success" };
  }
  if (state === "pending") {
    return {
      label: "Waiting for first sign-in",
      showConfiguredRole: true,
      tone: "info",
    };
  }
  if (state === "needs_attention") {
    return {
      label: "Needs attention",
      showConfiguredRole: hasApprovedAccess,
      tone: "warning",
    };
  }
  if (state === "revoked") {
    return {
      label: "Access revoked",
      showConfiguredRole: false,
      tone: "neutral",
    };
  }
  return { label: "Archived", showConfiguredRole: false, tone: "neutral" };
}
