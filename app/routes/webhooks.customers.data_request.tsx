import type { ActionFunctionArgs } from "react-router";

import {
  getComplianceErrorDetails,
  getSafeCustomerRequestDetails,
  recordComplianceWebhookEvent,
} from "../lib/compliance/compliance-webhooks.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const supabase = getSupabaseAdminClient();
  const details = {
    ...getSafeCustomerRequestDetails(payload),
    fulfillmentStatus: "pending_merchant_delivery",
    fulfillmentDeadlineDays: 30,
    nextAction:
      "Use the requested Shopify order IDs to prepare the shop-scoped data export and deliver it directly to the merchant.",
    limitation:
      "Direct customer contact fields are not stored. Requested order reporting records can still be personal data and must be included in the merchant response.",
  };

  console.log(`Received ${topic} compliance webhook for ${shop}.`);

  try {
    await recordComplianceWebhookEvent({
      supabase,
      shop,
      topic,
      status: "received",
      details,
    });
  } catch (error) {
    console.error(`Failed to handle ${topic} compliance webhook for ${shop}.`, error);
    await recordComplianceWebhookEvent({
      supabase,
      shop,
      topic,
      status: "failed",
      details: getComplianceErrorDetails(error),
    });
  }

  return new Response();
};
