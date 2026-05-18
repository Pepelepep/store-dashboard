import type { ActionFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import { syncInventoryItems } from "../lib/sync/shopify-sync.server";
import { authenticate } from "../shopify.server";

type InventoryLevelsUpdatePayload = {
  inventory_item_id?: string | number | null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const inventoryItemId = (payload as InventoryLevelsUpdatePayload)
    .inventory_item_id;

  if (!inventoryItemId) {
    console.warn(
      `Skipping ${topic} sync for ${shop}: missing inventory_item_id.`,
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
      inventoryItemIds: [String(inventoryItemId)],
    });
  } catch (error) {
    console.error(
      `Failed to sync inventory after ${topic} webhook for ${shop}.`,
      error,
    );
  }

  return new Response();
};
