import type { ActionFunctionArgs } from "react-router";

import db from "../db.server";
import {
  deleteShopScopedSupabaseData,
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
    const deletedCounts = await deleteShopScopedSupabaseData({
      supabase,
      shop,
      sessionStore: db,
    });

    await recordComplianceWebhookEvent({
      supabase,
      shop,
      topic,
      status: "completed",
      details: {
        deletedCounts,
        sessionsDeleted: true,
        retainedData: "Minimal compliance audit event only.",
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
