export function buildShopifyOrderUrl(
  shopDomain: string,
  shopifyOrderId: string,
) {
  const storeHandle = shopDomain
    .trim()
    .toLowerCase()
    .replace(/\.myshopify\.com$/, "");
  const orderId = shopifyOrderId.trim().split("/").pop();

  if (
    !/^[a-z0-9][a-z0-9-]*$/.test(storeHandle) ||
    !/^\d+$/.test(orderId ?? "")
  ) {
    return null;
  }

  return `https://admin.shopify.com/store/${storeHandle}/orders/${orderId}`;
}
