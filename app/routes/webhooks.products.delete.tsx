import type { ActionFunctionArgs } from "react-router";

import { enqueueAuthenticatedWebhook } from "../lib/webhooks/webhook-events.server";
import { respondToOperationalWebhook } from "../lib/webhooks/operational-webhook-response.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  return respondToOperationalWebhook({
    request,
    payload,
    shop,
    topic,
    enqueue: enqueueAuthenticatedWebhook,
  });
};
