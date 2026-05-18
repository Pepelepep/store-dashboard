import type { ActionFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import { syncInventoryItems } from "../lib/sync/shopify-sync.server";
import { authenticate } from "../shopify.server";

type InventoryItemsUpdatePayload = {
  id?: string | number | null;
  admin_graphql_api_id?: string | null;
};

function getInventoryItemId(payload: InventoryItemsUpdatePayload) {
  if (payload.admin_graphql_api_id) {
    return payload.admin_graphql_api_id;
  }

  if (payload.id) {
    return `gid://shopify/InventoryItem/${payload.id}`;
  }

  return null;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const inventoryItemId = getInventoryItemId(
    payload as InventoryItemsUpdatePayload,
  );

  if (!inventoryItemId) {
    console.warn(
      `Skipping ${topic} sync for ${shop}: missing inventory item id.`,
    );
    return new Response();
  }

  try {
    const admin = await getOfflineAdminClient(shop);
    const supabase = getSupabaseAdminClient();

    await syncInventoryItems({
      admin,
      shop,
      supabase,
      source: "webhook",
      inventoryItemIds: [inventoryItemId],
    });
  } catch (error) {
    console.error(
      `Failed to sync inventory item after ${topic} webhook for ${shop}.`,
      error,
    );
  }

  return new Response();
};
