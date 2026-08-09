import { getOfflineAdminClient } from "./offline-admin.server";
import { isShopifyAuthenticationRequiredError } from "./offline-authentication";
import { acquireOfflineSession } from "../../shopify.server";

export async function getShopLevelAdminClient({
  shop,
  route,
  sessionToken,
}: {
  shop: string;
  route: string;
  sessionToken?: string;
}) {
  try {
    return await getOfflineAdminClient(shop);
  } catch (error) {
    if (sessionToken && isShopifyAuthenticationRequiredError(error)) {
      try {
        await acquireOfflineSession({ shop, sessionToken });
        return await getOfflineAdminClient(shop);
      } catch (exchangeError) {
        console.error("[shopify-auth] offline token exchange failed", {
          route,
          shop,
          reason:
            exchangeError instanceof Error
              ? exchangeError.name
              : "unknown_exchange_error",
        });
      }
    }
    const reason = isShopifyAuthenticationRequiredError(error)
      ? "offline_authentication_required"
      : "offline_admin_unavailable";
    console.error("[shopify-auth] shop-level client unavailable", {
      route,
      shop,
      reason,
    });
    throw new Response(
      isShopifyAuthenticationRequiredError(error)
        ? "Shopify authentication is required. Reopen ShopOps Studio from Shopify admin."
        : "Shopify store access is temporarily unavailable.",
      { status: 503 },
    );
  }
}
