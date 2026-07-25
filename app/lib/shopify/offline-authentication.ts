export type OfflineAdminContext = {
  session: {
    id: string;
    shop: string;
    isOnline: boolean;
    accessToken: string;
  };
  admin: {
    graphql: (
      query: string,
      options?: {
        variables?: Record<string, unknown>;
      },
    ) => Promise<Response>;
  };
};

type OfflineAdminClientDependencies = {
  loadAdminContext: (shop: string) => Promise<OfflineAdminContext>;
  invalidateSession: (
    session: OfflineAdminContext["session"],
  ) => Promise<void>;
};

export const SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE =
  "Shopify authentication is required. Reopen ShopOps Studio from Shopify admin to reconnect this store, then retry the sync.";

export class ShopifyAuthenticationRequiredError extends Error {
  readonly code = "shopify_authentication_required";

  constructor() {
    super(SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE);
    this.name = "ShopifyAuthenticationRequiredError";
  }
}

export function isShopifyAuthenticationRequiredError(
  error: unknown,
): error is ShopifyAuthenticationRequiredError {
  return (
    error instanceof ShopifyAuthenticationRequiredError ||
    (error !== null &&
      error !== undefined &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "shopify_authentication_required")
  );
}

export function isUnauthorizedShopifyError(error: unknown) {
  if (error instanceof Response) {
    return error.status === 401;
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { code?: unknown; status?: unknown };
  };

  return (
    candidate.status === 401 ||
    candidate.statusCode === 401 ||
    candidate.response?.code === 401 ||
    candidate.response?.status === 401
  );
}

export async function createOfflineAdminClient(
  shop: string,
  {
    loadAdminContext,
    invalidateSession,
  }: OfflineAdminClientDependencies,
) {
  if (!shop) {
    throw new Error("Missing shop domain.");
  }

  let result: OfflineAdminContext;
  try {
    result = await loadAdminContext(shop);
  } catch (error) {
    if (
      isShopifyAuthenticationRequiredError(error) ||
      (error instanceof Error && error.name === "SessionNotFoundError")
    ) {
      throw new ShopifyAuthenticationRequiredError();
    }
    throw error;
  }

  if (
    !result.admin ||
    !result.session ||
    result.session.isOnline ||
    result.session.shop !== shop ||
    result.session.id !== `offline_${shop}` ||
    !result.session.accessToken
  ) {
    throw new ShopifyAuthenticationRequiredError();
  }

  return {
    graphql: async (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => {
      try {
        const response = await result.admin.graphql(query, options);
        if (response.status === 401) {
          await invalidateSession(result.session);
          throw new ShopifyAuthenticationRequiredError();
        }
        return response;
      } catch (error) {
        if (isShopifyAuthenticationRequiredError(error)) {
          throw error;
        }
        if (isUnauthorizedShopifyError(error)) {
          await invalidateSession(result.session);
          throw new ShopifyAuthenticationRequiredError();
        }
        throw error;
      }
    },
  };
}
