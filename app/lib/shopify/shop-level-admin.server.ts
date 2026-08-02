import { getOfflineAdminClient } from "./offline-admin.server";
import { isShopifyAuthenticationRequiredError } from "./offline-authentication";

export async function getShopLevelAdminClient({
  shop,
  route,
}: {
  shop: string;
  route: string;
}) {
  try {
    return await getOfflineAdminClient(shop);
  } catch (error) {
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
