import type { LoaderFunctionArgs } from "react-router";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";

type OperationalHealth = {
  checked_at: string;
  maintenance_last_succeeded_at: string | null;
  maintenance_lease_expires_at: string | null;
  webhooks_pending: number;
  webhooks_processing: number;
  webhooks_terminal_error: number;
  oldest_webhook_pending_at: string | null;
  sync_jobs_pending: number;
  sync_jobs_running: number;
  oldest_sync_job_pending_at: string | null;
  redactions_pending: number;
  oldest_redaction_pending_at: string | null;
  reconciliations_due: number;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

function ageMs(value: string | null, now: number) {
  if (!value) return 0;
  return Math.max(0, now - new Date(value).getTime());
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_shopops_operational_health");
  if (error) {
    return Response.json(
      { ok: false, error: "Operational health unavailable" },
      { status: 503 },
    );
  }

  const health = data as OperationalHealth;
  const now = Date.now();
  const issues: string[] = [];
  if (
    !health.maintenance_last_succeeded_at ||
    ageMs(health.maintenance_last_succeeded_at, now) > 10 * 60 * 1000
  ) {
    issues.push("maintenance_delayed");
  }
  if (ageMs(health.oldest_webhook_pending_at, now) > 15 * 60 * 1000) {
    issues.push("webhook_backlog");
  }
  if (ageMs(health.oldest_sync_job_pending_at, now) > 30 * 60 * 1000) {
    issues.push("sync_backlog");
  }
  if (ageMs(health.oldest_redaction_pending_at, now) > 60 * 60 * 1000) {
    issues.push("redaction_backlog");
  }
  if (Number(health.webhooks_terminal_error ?? 0) > 0) {
    issues.push("webhook_terminal_errors");
  }

  return Response.json(
    { ok: issues.length === 0, issues, health },
    {
      status: issues.length === 0 ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
