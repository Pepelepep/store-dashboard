import { unauthenticated } from "../../shopify.server";

type OfflineAdminResult = {
  admin: {
    graphql: (
      query: string,
      options?: {
        variables?: Record<string, unknown>;
      },
    ) => Promise<Response>;
  };
};

export async function getOfflineAdminClient(shop: string) {
  if (!shop) {
    throw new Error("Missing shop domain.");
  }

  const result = (await unauthenticated.admin(shop)) as OfflineAdminResult;

  if (!result.admin) {
    throw new Error(`Could not create offline admin client for shop ${shop}.`);
  }

  return result.admin;
}
