import type { ActionFunctionArgs } from "react-router";

import {
  getComplianceErrorDetails,
  getSafeCustomerRequestDetails,
  recordComplianceWebhookEvent,
  redactCustomerOrderDisplayFields,
} from "../lib/compliance/compliance-webhooks.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const supabase = getSupabaseAdminClient();

  console.log(`Received ${topic} compliance webhook for ${shop}.`);

  try {
    const redactionResult = await redactCustomerOrderDisplayFields({
      supabase,
      shop,
      payload,
    });

    await recordComplianceWebhookEvent({
      supabase,
      shop,
      topic,
      status: "completed",
      details: {
        ...getSafeCustomerRequestDetails(payload),
        ordersToRedactCount: payload.orders_to_redact?.length ?? 0,
        ...redactionResult,
        limitation: "No direct customer profile fields are stored; matched order display names are anonymized.",
      },
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
