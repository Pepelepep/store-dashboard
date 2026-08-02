import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { clearBillingCache } from "../lib/billing.server";
import { deleteShopifySessionsForUninstalledShop } from "../lib/shopify/session-lifecycle.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Authentication can legitimately return no stored session after uninstall.
  // Cleanup must remain idempotent and must remove both offline and online rows.
  // Supabase merchant/reporting data is intentionally not touched here.
  clearBillingCache(shop);
  await deleteShopifySessionsForUninstalledShop({ db, shop });

  return new Response();
};
