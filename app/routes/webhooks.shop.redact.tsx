import type { ActionFunctionArgs } from "react-router";

import {
  enqueueShopRedactionJob,
  getComplianceErrorDetails,
  recordComplianceWebhookEvent,
} from "../lib/compliance/compliance-webhooks.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const supabase = getSupabaseAdminClient();

  console.log(`Received ${topic} compliance webhook for ${shop}.`);

  try {
    const webhookId = request.headers.get("x-shopify-webhook-id");
    const enqueueResult = await enqueueShopRedactionJob({
      supabase,
      shop,
      webhookId,
    });

    await recordComplianceWebhookEvent({
      supabase,
      shop,
      topic,
      status: "received",
      details: {
        queued: enqueueResult.enqueued,
        duplicate: enqueueResult.duplicate,
        webhookIdPresent: Boolean(webhookId),
      },
    });
  } catch (error) {
    console.error(`Failed to handle ${topic} compliance webhook for ${shop}.`, {
      message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error",
    });
    await recordComplianceWebhookEvent({
      supabase,
      shop,
      topic,
      status: "failed",
      details: getComplianceErrorDetails(error),
    });

    return new Response("Shop redaction temporarily unavailable.", {
      status: 503,
    });
  }

  return new Response(null, { status: 200 });
};
