import type { ActionFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import { syncOrders } from "../lib/sync/shopify-sync.server";
import { authenticate } from "../shopify.server";

type OrdersUpdatedPayload = {
  updated_at?: string | null;
  created_at?: string | null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const orderPayload = payload as OrdersUpdatedPayload;
    const orderDate =
      orderPayload.updated_at?.slice(0, 10) ??
      orderPayload.created_at?.slice(0, 10);

    if (!orderDate) {
      console.error(
        `Missing updated_at and created_at for ${topic} webhook from ${shop}.`,
      );
      return new Response();
    }

    const admin = await getOfflineAdminClient(shop);
    const supabase = getSupabaseAdminClient();

    await syncOrders({
      admin,
      shop,
      supabase,
      source: "webhook",
      startDate: orderDate,
      endDate: orderDate,
    });
  } catch (error) {
    console.error(
      `Failed to sync orders after ${topic} webhook for ${shop}.`,
      error,
    );
  }

  return new Response();
};
