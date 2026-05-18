import type { ActionFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import { syncOrders } from "../lib/sync/shopify-sync.server";
import { authenticate } from "../shopify.server";

type OrdersCreatePayload = {
  created_at?: string | null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const createdAt = (payload as OrdersCreatePayload).created_at;
    const orderDate = createdAt?.slice(0, 10);

    if (!orderDate) {
      console.error(`Missing created_at for ${topic} webhook from ${shop}.`);
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
