import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { processWebhookEventsBatch } from "../lib/sync/webhook-events-processor.server";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${cronSecret}`;
}

async function processRequest(request: Request) {
  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 25);
  const maxAttempts = Number(url.searchParams.get("maxAttempts") ?? 5);
  const maxReconciliationJobs = Number(
    url.searchParams.get("maxReconciliationJobs") ?? 2,
  );
  const maxReconciliationShops = Number(
    url.searchParams.get("maxReconciliationShops") ?? 25,
  );
  const summary = await processWebhookEventsBatch({
    batchSize: Number.isFinite(limit) && limit > 0 ? limit : 25,
    maxAttempts:
      Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 5,
    maxReconciliationJobs:
      Number.isFinite(maxReconciliationJobs) && maxReconciliationJobs > 0
        ? maxReconciliationJobs
        : 2,
    maxReconciliationShops:
      Number.isFinite(maxReconciliationShops) && maxReconciliationShops > 0
        ? maxReconciliationShops
        : 25,
  });

  return jsonResponse({
    ok: true,
    ...summary,
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  return processRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return processRequest(request);
}
