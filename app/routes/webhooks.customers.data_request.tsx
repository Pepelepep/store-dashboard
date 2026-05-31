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
    limitation: "Customer-level export is not implemented because direct customer profiles are not stored.",
  };

  console.log(`Received ${topic} compliance webhook for ${shop}.`);

  try {
    await recordComplianceWebhookEvent({
      supabase,
      shop,
      topic,
      status: "completed",
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
