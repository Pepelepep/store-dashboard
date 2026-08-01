export type OwnerBootstrapIdentity = {
  shopifyUserId: string | null;
  email: string | null;
};

export type OwnerBootstrapMembership = {
  id: string;
  shopifyUserId: string | null;
  userEmail: string | null;
  isOwner: boolean;
};

export type OwnerMaterializationIdentifiers = {
  shopifyUserId: string | null;
  normalizedEmail: string | null;
};

export function resolveOwnerMaterializationIdentifiers({
  identity,
  memberships,
}: {
  identity: OwnerBootstrapIdentity;
  memberships: OwnerBootstrapMembership[];
}): OwnerMaterializationIdentifiers | null {
  const owner = memberships.find((membership) => membership.isOwner) ?? null;
  const userIdMatch = memberships.find(
    (membership) =>
      Boolean(identity.shopifyUserId) &&
      membership.shopifyUserId === identity.shopifyUserId,
  );
  const emailMatch = memberships.find(
    (membership) =>
      Boolean(identity.email) && membership.userEmail === identity.email,
  );

  if (!owner) {
    if (userIdMatch && emailMatch && userIdMatch.id !== emailMatch.id) {
      // Shopify's immutable user ID is the stronger identity. Avoid attaching
      // an email already owned by a separate legacy row; the verified owner
      // will still resolve deterministically through the user ID.
      return {
        shopifyUserId: identity.shopifyUserId,
        normalizedEmail: null,
      };
    }
    return {
      shopifyUserId: identity.shopifyUserId,
      normalizedEmail: identity.email,
    };
  }

  const userIdConflicts = Boolean(userIdMatch && userIdMatch.id !== owner.id);
  const emailConflicts = Boolean(emailMatch && emailMatch.id !== owner.id);
  const identifiers = {
    shopifyUserId: userIdConflicts ? null : identity.shopifyUserId,
    normalizedEmail: emailConflicts ? null : identity.email,
  };

  return identifiers.shopifyUserId || identifiers.normalizedEmail
    ? identifiers
    : null;
}
