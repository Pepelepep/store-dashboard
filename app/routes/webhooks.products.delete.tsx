import type { ActionFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { markProductDeletedById } from "../lib/sync/shopify-sync.server";
import { authenticate } from "../shopify.server";

type ProductsDeletePayload = {
  id?: string | number | null;
  admin_graphql_api_id?: string | null;
};

function getProductId(payload: ProductsDeletePayload) {
  if (payload.admin_graphql_api_id) {
    return payload.admin_graphql_api_id;
  }

  return payload.id ? `gid://shopify/Product/${payload.id}` : null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const productId = getProductId(payload as ProductsDeletePayload);

  if (!productId) {
    console.warn(`Skipping ${topic} sync for ${shop}: missing product id.`);
    return new Response();
  }

  try {
    const supabase = getSupabaseAdminClient();

    await markProductDeletedById({
      shop,
      supabase,
      source: "webhook",
      productId,
    });
  } catch (error) {
    console.error(
      `Failed to mark product deleted after ${topic} webhook for ${shop}.`,
      error,
    );
  }

  return new Response();
};
