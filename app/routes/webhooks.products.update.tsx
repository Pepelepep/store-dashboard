import type { ActionFunctionArgs } from "react-router";

import { enqueueAuthenticatedWebhook } from "../lib/webhooks/webhook-events.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const result = await enqueueAuthenticatedWebhook({
      request,
      payload,
      shop,
      topic,
    });
    console.log(
      result.skipped
        ? `Skipped duplicate ${topic} webhook for ${shop}`
        : `Queued ${topic} webhook for ${shop}`,
    );
  } catch (error) {
    console.error(`Failed to queue ${topic} webhook for ${shop}.`, error);
  }

  return new Response();
};
