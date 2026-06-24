type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ActiveSubscription = {
  id: string;
  name: string;
  status: string;
  test?: boolean;
};

type CurrentAppInstallationResponse = {
  data?: {
    currentAppInstallation?: {
      activeSubscriptions?: ActiveSubscription[];
    };
  };
};

export const SHOP_OPS_STUDIO_PLAN = {
  name: "ShopOps Studio",
  price: "$59.99/month",
  trialDays: 14,
} as const;

export function isBillingEnabled() {
  return process.env.BILLING_ENABLED?.trim().toLowerCase() === "true";
}

export function getBillingTestShops() {
  return (process.env.BILLING_TEST_SHOPS ?? "")
    .split(",")
    .map((shop) => shop.trim().toLowerCase())
    .filter(Boolean);
}

export function isBillingTestShop(shop: string) {
  return getBillingTestShops().includes(shop.trim().toLowerCase());
}

export async function hasActiveShopifyManagedSubscription({
  admin,
}: {
  admin: AdminGraphqlClient;
}) {
  const response = await admin.graphql(`#graphql
    query CurrentAppInstallationSubscriptions {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
        }
      }
    }
  `);
  const payload = (await response.json()) as CurrentAppInstallationResponse;
  const subscriptions =
    payload.data?.currentAppInstallation?.activeSubscriptions ?? [];

  return subscriptions.some((subscription) => subscription.status === "ACTIVE");
}

export async function getBillingGateState({
  admin,
  shop,
}: {
  admin: AdminGraphqlClient;
  shop: string;
}) {
  if (!isBillingEnabled()) {
    return { billingEnabled: false, requiresBilling: false };
  }

  if (isBillingTestShop(shop)) {
    return { billingEnabled: true, requiresBilling: false };
  }

  return {
    billingEnabled: true,
    requiresBilling: !(await hasActiveShopifyManagedSubscription({ admin })),
  };
}
