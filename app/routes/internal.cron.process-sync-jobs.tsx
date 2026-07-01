import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import { processSyncJobsBatch } from "../lib/sync/sync-jobs.server";

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

function parseLimit(value: string | null) {
  const limit = Number(value ?? 5);

  if (!Number.isFinite(limit) || limit < 1) {
    return 5;
  }

  return Math.min(Math.floor(limit), 10);
}

async function processRequest(request: Request) {
  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const summary = await processSyncJobsBatch({
    supabase: getSupabaseAdminClient(),
    limit,
    getAdminClient: getOfflineAdminClient,
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
