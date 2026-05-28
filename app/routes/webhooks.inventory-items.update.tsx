import type { ActionFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import { syncInventoryItems } from "../lib/sync/shopify-sync.server";
import { authenticate } from "../shopify.server";

type InventoryItemsUpdatePayload = {
  id?: string | number | null;
  admin_graphql_api_id?: string | null;
  cost?: string | number | null;
  sku?: string | null;
  tracked?: boolean | null;
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

function hasPayloadCost(payload: InventoryItemsUpdatePayload) {
  return Object.prototype.hasOwnProperty.call(payload, "cost");
}

function parsePayloadCost(cost: InventoryItemsUpdatePayload["cost"]) {
  if (cost === null || cost === undefined || cost === "") {
    return null;
  }

  const amount = Number(cost);
  return Number.isFinite(amount) ? amount : null;
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
    const supabase = getSupabaseAdminClient();
    await supabase.from("sync_runs").insert({
      shop_domain: shop,
      sync_type: "inventory",
      status: "error",
      source: "webhook",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error_message:
        "Missing inventory item id in inventory_items/update payload.",
      details: {
        topic,
        payloadKeys:
          payload && typeof payload === "object" ? Object.keys(payload) : [],
      },
    });
    return new Response();
  }

  try {
    const admin = await getOfflineAdminClient(shop);
    const supabase = getSupabaseAdminClient();
    const inventoryItemPayload = payload as InventoryItemsUpdatePayload;
    const payloadHasCost = hasPayloadCost(inventoryItemPayload);

    await syncInventoryItems({
      admin,
      shop,
      supabase,
      source: "webhook",
      inventoryItemIds: [inventoryItemId],
      inventoryItemUpdates: [
        {
          inventoryItemId,
          sku: inventoryItemPayload.sku ?? null,
          tracked: inventoryItemPayload.tracked ?? null,
          unitCost: parsePayloadCost(inventoryItemPayload.cost),
          hasExplicitUnitCost: payloadHasCost,
        },
      ],
    });
  } catch (error) {
    console.error(
      `Failed to sync inventory item after ${topic} webhook for ${shop}.`,
      error,
    );
    const supabase = getSupabaseAdminClient();
    await supabase.from("sync_runs").insert({
      shop_domain: shop,
      sync_type: "inventory",
      status: "error",
      source: "webhook",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
      details: {
        topic,
        inventoryItemId,
        handler: "webhooks.inventory-items.update",
      },
    });
  }

  return new Response();
};
