import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";

import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import {
  createManualSyncJob,
  processSyncJobsBatch,
  type SyncJobRow,
  type SyncJobType,
} from "../lib/sync/sync-jobs.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { authenticate } from "../shopify.server";

type SyncRun = {
  sync_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
};
type AutomationState = {
  last_reconciliation_started_at: string | null;
  last_reconciliation_succeeded_at: string | null;
  next_reconciliation_due_at: string | null;
  last_error: string | null;
};
type LoaderData = {
  runs: SyncRun[];
  jobs: SyncJobRow[];
  activeJob: SyncJobRow | null;
  hasMore: boolean;
  page: number;
  automation: AutomationState | null;
  webhookCounts: Record<string, number>;
};
type ActionData = { ok: boolean; message: string };

const RESOURCES = [
  { type: "orders", label: "Orders" },
  { type: "products", label: "Products" },
  { type: "inventory", label: "Inventory" },
  { type: "locations", label: "Locations" },
] as const;

function formatDate(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Never";
}

function duration(job: SyncJobRow) {
  if (!job.started_at || !job.finished_at) return "—";
  const seconds = Math.max(
    0,
    Math.round(
      (new Date(job.finished_at).getTime() -
        new Date(job.started_at).getTime()) /
        1000,
    ),
  );
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function statusLabel(status: string) {
  if (status === "pending") return "Queued";
  if (status === "running") return "Syncing";
  if (status === "success") return "Completed";
  if (status === "error") return "Failed";
  return "Cancelled";
}

function statusVariant(status: string) {
  if (status === "success") return "success" as const;
  if (status === "error") return "error" as const;
  if (status === "pending" || status === "running") return "info" as const;
  return "neutral" as const;
}

function actionLabel(job: SyncJobRow) {
  if (job.job_type === "full_refresh") return "Rebuild data";
  if (job.job_type === "full") return "Sync now";
  if (job.job_type === "orders_reconciliation_48h") return "Reconcile orders";
  if (job.job_type === "financial_backfill_30d") return "Financial backfill";
  return `Sync ${job.job_type}`;
}

function triggerLabel(job: SyncJobRow) {
  const trigger = job.details?.trigger;
  if (trigger === "initial_setup") return "Initial setup";
  if (trigger === "support") return "Support";
  if (job.details?.source === "cron") return "Automatic";
  if (job.details?.source === "webhook") return "Webhook";
  return "Manual";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.sync",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });
  const url = new URL(request.url);
  const page = Math.max(
    0,
    Math.min(50, Number(url.searchParams.get("activityPage") ?? 0) || 0),
  );
  const from = page * 20;
  const [
    runsResult,
    jobsResult,
    activeResult,
    automationResult,
    webhookResult,
  ] = await Promise.all([
    supabase
      .from("sync_runs")
      .select("sync_type, status, started_at, finished_at, error_message")
      .eq("shop_domain", session.shop)
      .order("started_at", { ascending: false })
      .limit(100),
    supabase
      .from("sync_jobs")
      .select("*")
      .eq("shop_domain", session.shop)
      .order("created_at", { ascending: false })
      .range(from, from + 20),
    supabase
      .from("sync_jobs")
      .select("*")
      .eq("shop_domain", session.shop)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sync_automation_state")
      .select(
        "last_reconciliation_started_at, last_reconciliation_succeeded_at, next_reconciliation_due_at, last_error",
      )
      .eq("shop_domain", session.shop)
      .maybeSingle(),
    supabase
      .from("webhook_events")
      .select("status")
      .eq("shop_domain", session.shop)
      .limit(500),
  ]);
  for (const result of [
    runsResult,
    jobsResult,
    activeResult,
    automationResult,
    webhookResult,
  ])
    if (result.error) throw new Response(result.error.message, { status: 500 });
  const webhookCounts: Record<string, number> = {};
  for (const event of webhookResult.data ?? [])
    webhookCounts[event.status] = (webhookCounts[event.status] ?? 0) + 1;
  return {
    runs: (runsResult.data ?? []) as SyncRun[],
    jobs: ((jobsResult.data ?? []) as SyncJobRow[]).slice(0, 20),
    activeJob: (activeResult.data as SyncJobRow | null) ?? null,
    hasMore: (jobsResult.data ?? []).length > 20,
    page,
    automation: automationResult.data as AutomationState | null,
    webhookCounts,
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.sync.action",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });
  const data = await request.formData();
  const intent = String(data.get("intent") ?? "");
  if (intent === "process_queue") {
    const summary = await processSyncJobsBatch({
      supabase,
      limit: 5,
      getAdminClient: getOfflineAdminClient,
    });
    return {
      ok: summary.failed === 0,
      message: `Processed ${summary.processed} operation${summary.processed === 1 ? "" : "s"}; ${summary.completed} completed and ${summary.failed} failed.`,
    };
  }
  if (intent === "retry") {
    const jobId = String(data.get("job_id") ?? "");
    const { data: failedJob } = await supabase
      .from("sync_jobs")
      .select("job_type")
      .eq("shop_domain", session.shop)
      .eq("id", jobId)
      .eq("status", "error")
      .maybeSingle();
    if (!failedJob)
      return { ok: false, message: "Failed operation not found." };
    const result = await createManualSyncJob({
      supabase,
      shop: session.shop,
      jobType: failedJob.job_type as SyncJobType,
      trigger: "support",
    });
    return {
      ok: true,
      message: result.reused
        ? "An equivalent operation is already active."
        : "Retry queued.",
    };
  }
  const rebuild = intent === "rebuild";
  if (rebuild && data.get("confirmation") !== "confirmed")
    return {
      ok: false,
      message: "Confirm the historical rebuild before continuing.",
    };
  if (intent !== "sync_now" && !rebuild)
    return { ok: false, message: "Unknown sync action." };
  const result = await createManualSyncJob({
    supabase,
    shop: session.shop,
    jobType: rebuild ? "full_refresh" : "full",
    trigger: rebuild ? "support" : "manual",
  });
  return {
    ok: true,
    message: result.reused
      ? "A data synchronization is already queued or running."
      : rebuild
        ? "Historical rebuild queued."
        : "Synchronization queued.",
  };
}

export default function DataSyncPage() {
  const { runs, jobs, activeJob, hasMore, page, automation, webhookCounts } =
    useLoaderData<LoaderData>();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const location = useLocation();
  const activityHref = (nextPage: number) => {
    const params = new URLSearchParams(location.search);
    params.set("activityPage", String(nextPage));
    return `?${params.toString()}`;
  };
  const lastSuccess =
    runs.find((run) => run.status === "success" && run.finished_at) ?? null;
  const latestFailedRun = runs.find((run) => run.status === "error") ?? null;
  const overall = activeJob
    ? "Syncing"
    : latestFailedRun &&
        (!lastSuccess || latestFailedRun.started_at > lastSuccess.finished_at!)
      ? "Needs attention"
      : "Up to date";
  const dueAt = automation?.next_reconciliation_due_at
    ? new Date(automation.next_reconciliation_due_at).getTime()
    : null;
  const automatic = !automation
    ? "Not configured"
    : automation.last_error || (dueAt && dueAt < Date.now() - 15 * 60 * 1000)
      ? "Delayed"
      : "Active";
  const isSubmitting = navigation.state !== "idle";
  return (
    <main className="sync-page">
      <style>{CSS}</style>
      <div className="sync-shell">
        <header>
          <div>
            <h1>Data sync</h1>
            <p>
              ShopOps keeps your Shopify reporting data current automatically.
            </p>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="sync_now" />
            <button className="primary" disabled={isSubmitting} type="submit">
              Sync now
            </button>
          </Form>
        </header>
        {result ? (
          <div className={`result ${result.ok ? "ok" : "bad"}`}>
            {result.message}
          </div>
        ) : null}
        <section className="overview">
          <div>
            <small>Overall status</small>
            <StatusBadge
              variant={
                overall === "Up to date"
                  ? "success"
                  : overall === "Syncing"
                    ? "info"
                    : "warning"
              }
            >
              {overall}
            </StatusBadge>
          </div>
          <div>
            <small>Last successful update</small>
            <b>{formatDate(lastSuccess?.finished_at)}</b>
          </div>
          <div>
            <small>Automatic sync</small>
            <StatusBadge
              variant={
                automatic === "Active"
                  ? "success"
                  : automatic === "Delayed"
                    ? "warning"
                    : "neutral"
              }
            >
              {automatic}
            </StatusBadge>
          </div>
        </section>
        {activeJob ? (
          <div className="progress">
            <span>
              <b>
                {activeJob.status === "pending"
                  ? "Synchronization queued"
                  : "Synchronizing Shopify data"}
              </b>
              <small>
                {actionLabel(activeJob)} · Updates continue automatically.
              </small>
            </span>
            <StatusBadge variant="info">
              {statusLabel(activeJob.status)}
            </StatusBadge>
          </div>
        ) : null}
        <section className="resource-card">
          <h2>Data freshness</h2>
          {RESOURCES.map((resource) => {
            const resourceRuns = runs.filter(
              (run) => run.sync_type === resource.type,
            );
            const success = resourceRuns.find(
              (run) => run.status === "success" && run.finished_at,
            );
            const error = resourceRuns.find((run) => run.status === "error");
            const syncing =
              activeJob &&
              (activeJob.job_type === resource.type ||
                activeJob.job_type === "full" ||
                activeJob.job_type === "full_refresh");
            const status = syncing
              ? "Syncing"
              : error && (!success || error.started_at > success.finished_at!)
                ? "Needs attention"
                : success
                  ? "Up to date"
                  : "Not synced";
            return (
              <div className="resource-row" key={resource.type}>
                <b>{resource.label}</b>
                <StatusBadge
                  variant={
                    status === "Up to date"
                      ? "success"
                      : status === "Needs attention"
                        ? "warning"
                        : status === "Syncing"
                          ? "info"
                          : "neutral"
                  }
                >
                  {status}
                </StatusBadge>
                <span>{formatDate(success?.finished_at)}</span>
                <small>
                  {status === "Needs attention"
                    ? error?.error_message?.slice(0, 120)
                    : ""}
                </small>
              </div>
            );
          })}
        </section>
        <section className="activity">
          <div className="section-title">
            <h2>Recent activity</h2>
            <span>Page {page + 1}</span>
          </div>
          <div className="activity-head">
            <span>Time</span>
            <span>Action</span>
            <span>Trigger</span>
            <span>Result</span>
            <span>Duration</span>
          </div>
          {jobs.map((job) => (
            <details className="activity-row" key={job.id}>
              <summary>
                <span>{formatDate(job.created_at)}</span>
                <b>{actionLabel(job)}</b>
                <span>{triggerLabel(job)}</span>
                <StatusBadge variant={statusVariant(job.status)}>
                  {statusLabel(job.status)}
                </StatusBadge>
                <span>{duration(job)}</span>
              </summary>
              <div className="activity-detail">
                <span>
                  {job.error_message ??
                    "Operation details are available for support."}
                </span>
              </div>
            </details>
          ))}
          {!jobs.length ? (
            <p className="empty">No synchronization activity yet.</p>
          ) : null}
          <div className="pagination">
            {page > 0 ? <a href={activityHref(page - 1)}>Newer</a> : <span />}
            {hasMore ? <a href={activityHref(page + 1)}>Load more</a> : null}
          </div>
        </section>
        <details className="advanced">
          <summary>Advanced diagnostics</summary>
          <div className="advanced-body">
            <section>
              <h3>Rebuild data</h3>
              <p>
                Re-imports complete Shopify history without deleting valid data
                first. This can take considerably longer.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="rebuild" />
                <label>
                  <input
                    type="checkbox"
                    name="confirmation"
                    value="confirmed"
                    required
                  />{" "}
                  I understand this starts a full historical rebuild.
                </label>
                <button type="submit" disabled={isSubmitting}>
                  Rebuild data
                </button>
              </Form>
            </section>
            <section>
              <h3>Queue processing</h3>
              <p>
                Support-only processing. Merchants do not need this for normal
                synchronization.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="process_queue" />
                <button type="submit" disabled={isSubmitting}>
                  Process queue now
                </button>
              </Form>
            </section>
            <section>
              <h3>Webhook processing</h3>
              <p>
                Pending {webhookCounts.pending ?? 0} · Processing{" "}
                {webhookCounts.processing ?? 0} · Failed{" "}
                {webhookCounts.error ?? 0}
              </p>
            </section>
            <section>
              <h3>Raw operation diagnostics</h3>
              {jobs.slice(0, 20).map((job) => (
                <div className="raw" key={`raw-${job.id}`}>
                  <code>{job.id}</code>
                  <span>
                    {job.job_type} · {job.status}
                  </span>
                  {job.status === "error" ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="retry" />
                      <input type="hidden" name="job_id" value={job.id} />
                      <button type="submit">Retry</button>
                    </Form>
                  ) : null}
                </div>
              ))}
            </section>
          </div>
        </details>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

const CSS = `
*{box-sizing:border-box}.sync-page{min-height:100vh;background:#f4f5f4;color:#202223;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:28px}.sync-shell{max-width:1100px;margin:auto}.sync-shell>header{align-items:center;display:flex;justify-content:space-between;margin-bottom:20px}.sync-shell h1{font-size:30px;margin:0}.sync-shell header p{color:#616161;margin:6px 0 0}button,.primary{background:#fff;border:1px solid #b7b9bb;border-radius:8px;cursor:pointer;font-weight:650;padding:9px 13px}.primary{background:#303030;border-color:#303030;color:#fff}button:disabled{cursor:not-allowed;opacity:.6}.result{border-radius:9px;margin-bottom:14px;padding:11px 14px}.result.ok{background:#eaf7ef;color:#166534}.result.bad{background:#fff0f0;color:#b42318}.overview{background:#fff;border:1px solid #dedede;border-radius:13px;display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:14px;padding:18px}.overview>div{display:grid;gap:8px}.overview small{color:#6d7175;font-weight:650}.progress{align-items:center;background:#eef5ff;border:1px solid #c8dcfa;border-radius:10px;display:flex;justify-content:space-between;margin-bottom:14px;padding:12px 14px}.progress span{display:grid;gap:3px}.progress small{color:#516072}.resource-card,.activity,.advanced{background:#fff;border:1px solid #dedede;border-radius:13px;margin-bottom:16px;padding:18px}.resource-card h2,.activity h2{font-size:17px;margin:0 0 12px}.resource-row{align-items:center;border-top:1px solid #ededed;display:grid;gap:14px;grid-template-columns:1fr 130px 180px 1.4fr;min-height:54px}.resource-row small{color:#b42318}.section-title{align-items:center;display:flex;justify-content:space-between}.section-title span{color:#6d7175;font-size:13px}.activity-head,.activity-row summary{align-items:center;display:grid;gap:12px;grid-template-columns:180px 1fr 110px 110px 90px}.activity-head{background:#f7f7f7;color:#616161;font-size:11px;font-weight:700;padding:9px;text-transform:uppercase}.activity-row{border-bottom:1px solid #ededed}.activity-row summary{cursor:pointer;list-style:none;min-height:56px;padding:8px}.activity-row summary::-webkit-details-marker{display:none}.activity-detail{background:#fafafa;color:#616161;font-size:13px;padding:10px 14px}.pagination{display:flex;justify-content:space-between;padding-top:14px}.pagination a{color:#255aa8;text-decoration:none}.advanced>summary{cursor:pointer;font-weight:700}.advanced-body{display:grid;gap:20px;margin-top:18px}.advanced-body>section{border-top:1px solid #e5e5e5;padding-top:16px}.advanced-body h3{font-size:15px;margin:0 0 5px}.advanced-body p{color:#616161;margin:5px 0 12px}.advanced-body form{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.raw{align-items:center;border-top:1px solid #ededed;display:grid;gap:10px;grid-template-columns:1fr 180px auto;padding:9px 0}.raw code{font-size:11px;overflow-wrap:anywhere}.empty{color:#6d7175;text-align:center;padding:20px}
@media(max-width:760px){.sync-page{padding:16px}.overview{grid-template-columns:1fr;gap:18px}.resource-row{grid-template-columns:1fr auto}.resource-row>span,.resource-row>small{grid-column:1/-1}.activity-head{display:none}.activity-row summary{grid-template-columns:1fr auto}.activity-row summary>span:nth-child(3),.activity-row summary>span:nth-child(5){font-size:12px}.raw{grid-template-columns:1fr}.sync-shell>header{align-items:flex-start;gap:12px}}
`;
