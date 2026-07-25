import { unauthenticated } from "../../shopify.server";
import db from "../../db.server";
import {
  createOfflineAdminClient,
  isUnauthorizedShopifyError,
  ShopifyAuthenticationRequiredError,
  type OfflineAdminContext,
} from "./offline-authentication";

export {
  isShopifyAuthenticationRequiredError,
  SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE,
} from "./offline-authentication";

async function invalidateCurrentOfflineSession(
  session: OfflineAdminContext["session"],
) {
  await db.session.deleteMany({
    where: {
      id: session.id,
      shop: session.shop,
      isOnline: false,
      accessToken: session.accessToken,
    },
  });
}

export async function getOfflineAdminClient(shop: string) {
  return createOfflineAdminClient(shop, {
    loadAdminContext: async (shopDomain) => {
      const storedSession = await db.session.findUnique({
        where: { id: `offline_${shopDomain}` },
      });
      if (
        !storedSession ||
        storedSession.shop !== shopDomain ||
        storedSession.isOnline ||
        !storedSession.accessToken
      ) {
        throw new ShopifyAuthenticationRequiredError();
      }

      try {
        return (await unauthenticated.admin(
          shopDomain,
        )) as OfflineAdminContext;
      } catch (error) {
        if (isUnauthorizedShopifyError(error)) {
          await invalidateCurrentOfflineSession(storedSession);
          throw new ShopifyAuthenticationRequiredError();
        }
        throw error;
      }
    },
    invalidateSession: invalidateCurrentOfflineSession,
  });
}
