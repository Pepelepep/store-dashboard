import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import {
  enqueueFinancialBackfill30dJob,
  getRunnableFinancialBackfill30dJobs,
  processManualSyncJobBatch,
} from "../lib/sync/sync-jobs.server";

type BackfillMode = "enqueue" | "process" | "enqueue-and-process";

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

function parseBoolean(value: string | null | undefined) {
  return value === "true";
}

function parseLimit(value: string | null | undefined) {
  const limit = Number(value ?? 1);

  if (!Number.isFinite(limit) || limit < 1) {
    return 1;
  }

  return Math.min(Math.floor(limit), 5);
}

async function getRequestParams(request: Request) {
  const url = new URL(request.url);
  const queryParams = url.searchParams;
  const contentType = request.headers.get("content-type") ?? "";
  let bodyParams = new Map<string, string>();

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    bodyParams = new Map(
      Object.entries(body ?? {}).map(([key, value]) => [key, String(value)]),
    );
  } else if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const formData = await request.formData();
    bodyParams = new Map(
      Array.from(formData.entries()).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  }

  const getParam = (name: string) =>
    queryParams.get(name) ?? bodyParams.get(name);

  return {
    shop: getParam("shop")?.trim() ?? "",
    mode: (getParam("mode") ?? "") as BackfillMode,
    limit: parseLimit(getParam("limit")),
    force: parseBoolean(getParam("force")),
  };
}

function isValidMode(mode: string): mode is BackfillMode {
  return (
    mode === "enqueue" || mode === "process" || mode === "enqueue-and-process"
  );
}

async function processBackfillBatches({
  shop,
  limit,
  supabase,
}: {
  shop: string;
  limit: number;
  supabase: ReturnType<typeof getSupabaseAdminClient>;
}) {
  const admin = await getOfflineAdminClient(shop);
  const results = [];

  for (let index = 0; index < limit; index += 1) {
    const [job] = await getRunnableFinancialBackfill30dJobs({
      supabase,
      shop,
      limit: 1,
    });

    if (!job) {
      break;
    }

    const result = await processManualSyncJobBatch({
      admin,
      supabase,
      shop,
      jobId: job.id,
    });

    results.push({
      jobId: result.job.id,
      status: result.job.status,
      processed: result.processed,
      counts: result.job.counts,
      progress: result.job.progress,
      errorMessage: result.job.error_message,
    });

    if (["success", "error", "cancelled"].includes(result.job.status)) {
      break;
    }
  }

  return {
    requestedBatches: limit,
    processedBatches: results.filter((result) => result.processed).length,
    results,
  };
}

async function handleRequest(request: Request) {
  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const { shop, mode, limit, force } = await getRequestParams(request);

  if (!shop) {
    return jsonResponse({ ok: false, error: "Missing required shop." }, 400);
  }

  if (!mode) {
    return jsonResponse({ ok: false, error: "Missing required mode." }, 400);
  }

  if (!isValidMode(mode)) {
    return jsonResponse({ ok: false, error: `Invalid mode: ${mode}` }, 400);
  }

  const supabase = getSupabaseAdminClient();
  const summary: Record<string, unknown> = {
    ok: true,
    shop,
    mode,
    limit,
    force,
  };

  if (mode === "enqueue" || mode === "enqueue-and-process") {
    summary.enqueue = await enqueueFinancialBackfill30dJob({
      supabase,
      shop,
      force,
    });
  }

  if (mode === "process" || mode === "enqueue-and-process") {
    summary.processing = await processBackfillBatches({
      shop,
      limit,
      supabase,
    });
  }

  return jsonResponse(summary);
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  return jsonResponse({ ok: false, error: "Use POST." }, 405);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleRequest(request);
}
