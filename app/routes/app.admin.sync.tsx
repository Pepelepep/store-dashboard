import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
  useRevalidator,
} from "react-router";
import { useEffect } from "react";

import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { ContentCard } from "../components/ui/ShopOpsPage";
import { StatusBadge } from "../components/ui/StatusBadge";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { formatStoreDateTime } from "../lib/dashboard/dashboard-metrics";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import {
  getOfflineAdminClient,
  isShopifyAuthenticationRequiredError,
  SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE,
} from "../lib/shopify/offline-admin.server";
import {
  createManualSyncJob,
  markSyncJobAuthenticationRequired,
  processManualSyncJobBatch,
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
type MaintenanceHealth = {
  last_started_at: string | null;
  last_completed_at: string | null;
  last_succeeded_at: string | null;
  last_error: string | null;
};
type LoaderData = {
  runs: SyncRun[];
  jobs: SyncJobRow[];
  activeJob: SyncJobRow | null;
  hasMore: boolean;
  page: number;
  viewAllActivity: boolean;
  maintenance: MaintenanceHealth | null;
  webhookCounts: Record<string, number>;
  managePlanUrl: string;
};
type ActionData = { ok: boolean; message: string; operationStatus?: string };

const RESOURCES = [
  { type: "orders", label: "Orders" },
  { type: "products", label: "Products" },
  { type: "inventory", label: "Inventory" },
  { type: "locations", label: "Locations" },
] as const;

function formatDate(value?: string | null) {
  return value ? formatStoreDateTime(value) : "Never";
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
  if (status === "pending") return "Waiting";
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
  if (job.details?.trigger === "initial_setup") return "Initial import";
  if (job.job_type === "full_refresh") return "Historical rebuild";
  if (job.job_type === "full") return "Manual sync";
  if (job.job_type === "orders_reconciliation_48h")
    return "Automatic reconciliation";
  if (job.details?.source === "webhook") return "Shopify update";
  if (job.job_type === "financial_backfill_30d") return "Reporting repair";
  return "Shopify data update";
}

function triggerLabel(job: SyncJobRow) {
  const trigger = job.details?.trigger;
  if (trigger === "initial_setup") return "Initial setup";
  if (trigger === "support") return "Support";
  if (job.details?.source === "cron") return "Automatic";
  if (job.details?.source === "webhook") return "Webhook";
  return "Manual";
}

function isLocationPlanLimitMessage(value: string | null | undefined) {
  return Boolean(
    value?.includes("allows") && value.includes("active location"),
  );
}

function isLocationPlanLimitJob(job: SyncJobRow) {
  const errorDetails = job.details?.errorDetails;
  return (
    errorDetails !== null &&
    errorDetails !== undefined &&
    typeof errorDetails === "object" &&
    "code" in errorDetails &&
    errorDetails.code === "plan_capacity" &&
    "resource" in errorDetails &&
    errorDetails.resource === "active_locations"
  );
}

function locationLimitAction(errorMessage: string | null | undefined) {
  return errorMessage?.startsWith("Multi-location allows 10 active locations.")
    ? { href: "/support", label: "Contact support" }
    : { href: null, label: "Review plan limits" };
}

function LocationPlanLimitAction({
  errorMessage,
  managePlanUrl,
}: {
  errorMessage: string | null | undefined;
  managePlanUrl: string;
}) {
  const action = locationLimitAction(errorMessage);
  return (
    <a
      href={action.href ?? managePlanUrl}
      target={action.href ? undefined : "_top"}
    >
      {action.label}
    </a>
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.pathname === "/app/admin/sync") {
    url.searchParams.set("tab", "sync");
    throw redirect(`/app/settings?${url.searchParams.toString()}`);
  }
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.sync",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });
  const viewAllActivity = url.searchParams.get("activity") === "all";
  const page = Math.max(
    0,
    viewAllActivity
      ? Math.min(50, Number(url.searchParams.get("activityPage") ?? 0) || 0)
      : 0,
  );
  const activityLimit = viewAllActivity ? 20 : 5;
  const from = viewAllActivity ? page * 20 : 0;
  const [
    runsResult,
    jobsResult,
    activeResult,
    maintenanceResult,
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
      .range(from, from + activityLimit),
    supabase
      .from("sync_jobs")
      .select("*")
      .eq("shop_domain", session.shop)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("maintenance_tick_state")
      .select(
        "last_started_at, last_completed_at, last_succeeded_at, last_error",
      )
      .eq("singleton", true)
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
    maintenanceResult,
    webhookResult,
  ])
    if (result.error) throw new Response(result.error.message, { status: 500 });
  const webhookCounts: Record<string, number> = {};
  for (const event of webhookResult.data ?? [])
    webhookCounts[event.status] = (webhookCounts[event.status] ?? 0) + 1;
  return {
    runs: (runsResult.data ?? []) as SyncRun[],
    jobs: ((jobsResult.data ?? []) as SyncJobRow[]).slice(0, activityLimit),
    activeJob: (activeResult.data as SyncJobRow | null) ?? null,
    hasMore: (jobsResult.data ?? []).length > activityLimit,
    page,
    viewAllActivity,
    maintenance: maintenanceResult.data as MaintenanceHealth | null,
    webhookCounts,
    managePlanUrl: "/app/settings?tab=plan",
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
  let updatedJob = result.job;
  let immediatePassDeferred = false;
  try {
    const admin = await getOfflineAdminClient(session.shop);
    const immediate = await processManualSyncJobBatch({
      admin,
      supabase,
      shop: session.shop,
      jobId: result.job.id,
      preserveQueuedOnFailure: true,
    });
    updatedJob = immediate.job;
    immediatePassDeferred = Boolean(
      immediate.job.details?.immediatePassFailedAt,
    );
    if (immediate.job.details?.authenticationRequired === true) {
      return {
        ok: false,
        message: SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE,
        operationStatus: "authentication_required",
      };
    }
  } catch (error) {
    if (isShopifyAuthenticationRequiredError(error)) {
      await markSyncJobAuthenticationRequired({
        supabase,
        job: updatedJob,
      });
      return {
        ok: false,
        message: SHOPIFY_AUTHENTICATION_REQUIRED_MESSAGE,
        operationStatus: "authentication_required",
      };
    }
    immediatePassDeferred = true;
  }
  const completed = updatedJob.status === "success";
  return {
    ok: true,
    operationStatus: updatedJob.status,
    message: completed
      ? rebuild
        ? "Historical rebuild completed."
        : "Shopify data updated."
      : immediatePassDeferred
        ? "Synchronization will continue automatically."
        : result.reused
          ? "The active synchronization is continuing."
          : rebuild
            ? "Historical rebuild started and will continue automatically."
            : "Synchronization started and will continue automatically.",
  };
}

export default function DataSyncPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const {
    runs,
    jobs,
    activeJob,
    hasMore,
    page,
    viewAllActivity,
    maintenance,
    webhookCounts,
    managePlanUrl,
  } = useLoaderData<LoaderData>();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const location = useLocation();
  useEffect(() => {
    if (!activeJob) return;
    const interval = window.setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [activeJob, revalidator]);
  const activityHref = (nextPage: number) => {
    const params = new URLSearchParams(location.search);
    params.set("activityPage", String(nextPage));
    return `?${params.toString()}`;
  };
  const activityViewHref = (viewAll: boolean) => {
    const params = new URLSearchParams(location.search);
    if (viewAll) params.set("activity", "all");
    else params.delete("activity");
    params.delete("activityPage");
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
  const lastMaintenanceAt = maintenance?.last_succeeded_at ?? null;
  const maintenanceAge = lastMaintenanceAt
    ? Date.now() - new Date(lastMaintenanceAt).getTime()
    : null;
  const automatic = !lastMaintenanceAt
    ? "Not configured"
    : maintenanceAge !== null && maintenanceAge > 15 * 60 * 1000
      ? "Delayed"
      : "Active";
  const automaticVariant =
    automatic === "Active"
      ? ("success" as const)
      : automatic === "Delayed"
        ? ("warning" as const)
        : ("neutral" as const);
  const isSubmitting = navigation.state !== "idle";
  const Root = embedded ? "div" : "main";
  return (
    <Root className={`sync-page${embedded ? " sync-page--embedded" : ""}`}>
      <style>{CSS}</style>
      <style>{COMPACT_CSS}</style>
      <div className="sync-shell">
        {!embedded ? (
          <header>
            <div>
              <h1>Data sync</h1>
              <p>
                ShopOps keeps your Shopify reporting data current automatically.
              </p>
            </div>
          </header>
        ) : null}
        {embedded ? (
          <div className="sync-section-intro">
            <h2>Data sync</h2>
            <p>
              ShopOps keeps your Shopify reporting data current automatically.
            </p>
          </div>
        ) : null}
        {result ? (
          <div className={`result ${result.ok ? "ok" : "bad"}`}>
            {result.message}
          </div>
        ) : null}
        <ContentCard
          action={
            <Form className="sync-status-action" method="post">
              <input type="hidden" name="intent" value="sync_now" />
              <button className="primary" disabled={isSubmitting} type="submit">
                Sync now
              </button>
            </Form>
          }
          className="sync-status-card"
          description="Updates orders, products, inventory, and locations without rebuilding your complete order history."
          title="Synchronization status"
        >
          <div className="sync-status-grid">
            <div className="sync-status-item">
              <span>Current data status</span>
              <StatusBadge
                style={{ justifySelf: "start" }}
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
            <div className="sync-status-item">
              <span>Last successful update</span>
              <strong>{formatDate(lastSuccess?.finished_at)}</strong>
            </div>
            <div className="sync-status-item">
              <span>Automatic synchronization</span>
              <StatusBadge
                style={{ justifySelf: "start" }}
                variant={automaticVariant}
              >
                {automatic}
              </StatusBadge>
            </div>
          </div>
          <div
            className="sync-check-row"
            data-tone={automatic === "Delayed" ? "warning" : "neutral"}
          >
            <div className="sync-check-row__timing">
              <span>
                {automatic === "Delayed"
                  ? "Delayed automatic check"
                  : "Automatic check timing"}
              </span>
              <strong>
                {automatic === "Delayed"
                  ? `Last completed ${formatDate(lastMaintenanceAt)}`
                  : automatic === "Active"
                    ? "Scheduled automatically"
                    : "Waiting for first check"}
              </strong>
            </div>
            <small>
              {automatic === "Delayed"
                ? "Current data can still be up to date; the background scheduler has not completed a successful check on schedule."
                : automatic === "Active"
                  ? `Last completed ${formatDate(lastMaintenanceAt)}.`
                  : "No successful automatic check yet."}
            </small>
          </div>
        </ContentCard>
        {activeJob ? (
          <div className="progress">
            <span>
              <b>
                {activeJob.status === "pending"
                  ? "Synchronization scheduled"
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
        <ContentCard className="resource-card" title="Data freshness">
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
            const planLimitAction = locationLimitAction(error?.error_message);
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
                  {status === "Needs attention" &&
                  isLocationPlanLimitMessage(error?.error_message) ? (
                    <>
                      {" "}
                      <a
                        href={planLimitAction.href ?? managePlanUrl}
                        target={planLimitAction.href ? undefined : "_top"}
                      >
                        {planLimitAction.label}
                      </a>
                    </>
                  ) : null}
                </small>
              </div>
            );
          })}
        </ContentCard>
        <ContentCard className="activity">
          <div className="section-title">
            <h2>{viewAllActivity ? "All activity" : "Recent activity"}</h2>
            {viewAllActivity ? (
              <span>Page {page + 1}</span>
            ) : (
              <a href={activityViewHref(true)}>View all activity</a>
            )}
          </div>
          {viewAllActivity ? (
            <div className="activity-head">
              <span>Time</span>
              <span>Action</span>
              <span>Trigger</span>
              <span>Result</span>
              <span>Duration</span>
            </div>
          ) : (
            <div className="activity-head compact">
              <span>Time</span>
              <span>Action</span>
              <span>Result</span>
            </div>
          )}
          {jobs.map((job) =>
            viewAllActivity ? (
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
                  {isLocationPlanLimitJob(job) ||
                  isLocationPlanLimitMessage(job.error_message) ? (
                    <LocationPlanLimitAction
                      errorMessage={job.error_message}
                      managePlanUrl={managePlanUrl}
                    />
                  ) : null}
                </div>
              </details>
            ) : (
              <div
                className={`activity-compact-row ${job.status === "error" ? "failed" : ""}`}
                key={job.id}
              >
                <span>{formatDate(job.created_at)}</span>
                <b>{actionLabel(job)}</b>
                <StatusBadge variant={statusVariant(job.status)}>
                  {statusLabel(job.status)}
                </StatusBadge>
              </div>
            ),
          )}
          {!jobs.length ? (
            <p className="empty">No synchronization activity yet.</p>
          ) : null}
          {viewAllActivity ? (
            <div className="pagination">
              {page > 0 ? (
                <a href={activityHref(page - 1)}>Newer</a>
              ) : (
                <a href={activityViewHref(false)}>Back to recent</a>
              )}
              {hasMore ? <a href={activityHref(page + 1)}>Load more</a> : null}
            </div>
          ) : null}
        </ContentCard>
        <details className="advanced shopops-content-card">
          <summary>Advanced diagnostics</summary>
          <div className="advanced-body">
            <section>
              <h3>Rebuild data</h3>
              <p>
                Reimports complete historical data. Use only to repair or
                reinitialize reporting.
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
                Runs pending background tasks immediately. Automatic sync
                normally handles this.
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
                    {actionLabel(job)} · {statusLabel(job.status)}
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
    </Root>
  );
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

const COMPACT_CSS = `
.sync-shell>header{margin-bottom:16px}
.sync-section-intro{margin:0 0 16px}
.sync-section-intro h2{font-size:20px;line-height:1.25;margin:0}
.sync-section-intro p{color:var(--shopops-muted,#616161);font-size:13px;line-height:1.45;margin:5px 0 0}
.sync-status-card{margin-bottom:16px}
.sync-status-card .shopops-content-card__header{align-items:center}
.sync-status-action{margin:0}
.sync-status-grid{display:grid;gap:16px;grid-template-columns:repeat(3,minmax(0,1fr));min-width:0}
.sync-status-item{align-content:start;display:grid;gap:7px;min-width:0}
.sync-status-item>span{color:var(--shopops-muted,#616161);font-size:12px;font-weight:700;line-height:1.35}
.sync-status-item>strong{font-size:14px;font-variant-numeric:tabular-nums;line-height:1.4}
.sync-check-row{align-items:center;background:#f8fafc;border:1px solid #d9dee5;border-radius:10px;display:grid;gap:14px;grid-template-columns:minmax(180px,.7fr) minmax(0,1.3fr);margin-top:16px;padding:9px 11px}
.sync-check-row[data-tone="warning"]{background:#fff8e5;border-color:#e5c07b;color:#5c4813}
.sync-check-row__timing{display:grid;gap:3px;min-width:0}
.sync-check-row__timing>span{color:var(--shopops-muted,#616161);font-size:11px;font-weight:750;line-height:1.35}
.sync-check-row[data-tone="warning"] .sync-check-row__timing>span{color:#725b19}
.sync-check-row__timing>strong{font-size:13px;font-variant-numeric:tabular-nums;line-height:1.35}
.sync-check-row>small{color:var(--shopops-muted,#616161);font-size:11px;line-height:1.4}
.sync-check-row[data-tone="warning"]>small{color:#725b19}
.resource-row{min-height:48px}
.section-title a{color:#255aa8;font-size:13px;text-decoration:none}
.activity-head.compact,.activity-compact-row{align-items:center;display:grid;gap:12px;grid-template-columns:180px 1fr 110px}
.activity-compact-row{border-bottom:1px solid #ededed;min-height:52px;padding:8px}
.activity-compact-row.failed{background:#fff8f7}
@media(max-width:760px){.sync-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sync-status-item:last-child{grid-column:1/-1}.sync-check-row{align-items:start;grid-template-columns:1fr}.activity-head.compact{display:none}.activity-compact-row{grid-template-columns:1fr auto}.activity-compact-row>b{grid-column:1/-1;grid-row:1}.activity-compact-row>span:first-child{grid-column:1;grid-row:2}.activity-compact-row>span:last-child{grid-column:2;grid-row:2}}
@media(max-width:640px){.sync-status-card .shopops-content-card__header{align-items:stretch}.sync-status-action,.sync-status-action button{width:100%}}
@media(max-width:520px){.sync-status-grid{grid-template-columns:1fr}.sync-status-item:last-child{grid-column:auto}}
`;

const CSS = `
*{box-sizing:border-box}.sync-page{min-height:100vh;background:transparent;color:#202223;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:28px}.sync-page--embedded{min-height:0;padding:0}.sync-shell{max-width:1100px;margin:auto}.sync-page--embedded .sync-shell{margin:0;max-width:none;width:100%}.sync-shell>header{align-items:center;display:flex;justify-content:space-between;margin-bottom:20px}.sync-shell h1{font-size:30px;margin:0}.sync-shell header p{color:#616161;margin:6px 0 0}.sync-page button,.sync-page .primary{background:#fff;border:1px solid #b7b9bb;border-radius:10px;cursor:pointer;font-weight:650;padding:9px 13px}.sync-page .primary{background:var(--shopops-accent,#2563eb);border-color:var(--shopops-accent,#2563eb);color:#fff}.sync-page button:disabled{cursor:not-allowed;opacity:.6}.sync-page .primary:disabled{background:#e5e7eb;border-color:#d1d5db;color:#6b7280;opacity:1}.result{border-radius:12px;margin-bottom:14px;padding:11px 14px}.result.ok{background:#eaf7ef;color:#166534}.result.bad{background:#fff0f0;color:#b42318}.overview{background:#fff;border:1px solid var(--shopops-border,#dedede);border-radius:16px;display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:14px;padding:20px}.overview>div{display:grid;gap:8px}.overview small{color:#6d7175;font-weight:650}.progress{align-items:center;background:#eef5ff;border:1px solid #c8dcfa;border-radius:12px;display:flex;justify-content:space-between;margin-bottom:14px;padding:12px 14px}.progress span{display:grid;gap:3px}.progress small{color:#516072}.resource-card,.activity,.advanced{background:#fff;border:1px solid var(--shopops-border,#dedede);border-radius:16px;margin-bottom:16px;padding:20px}.activity h2{font-size:17px;margin:0 0 12px}.resource-row{align-items:center;border-top:1px solid #ededed;display:grid;gap:14px;grid-template-columns:1fr 130px 180px 1.4fr;min-height:54px}.resource-row small{color:#b42318}.section-title{align-items:center;display:flex;justify-content:space-between}.section-title span{color:#6d7175;font-size:13px}.activity-head,.activity-row summary{align-items:center;display:grid;gap:12px;grid-template-columns:180px 1fr 110px 110px 90px}.activity-head{background:#f7f7f7;color:#616161;font-size:11px;font-weight:700;padding:9px;text-transform:uppercase}.activity-row{border-bottom:1px solid #ededed}.activity-row summary{cursor:pointer;list-style:none;min-height:56px;padding:8px}.activity-row summary::-webkit-details-marker{display:none}.activity-detail{background:#fafafa;color:#616161;font-size:13px;padding:10px 14px}.pagination{display:flex;justify-content:space-between;padding-top:14px}.pagination a{color:#255aa8;text-decoration:none}.advanced>summary{cursor:pointer;font-weight:700}.advanced-body{display:grid;gap:20px;margin-top:18px}.advanced-body>section{border-top:1px solid #e5e5e5;padding-top:16px}.advanced-body h3{font-size:15px;margin:0 0 5px}.advanced-body p{color:#616161;margin:5px 0 12px}.advanced-body form{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.raw{align-items:center;border-top:1px solid #ededed;display:grid;gap:10px;grid-template-columns:1fr 180px auto;padding:9px 0}.raw code{font-size:11px;overflow-wrap:anywhere}.empty{color:#6d7175;text-align:center;padding:20px}
@media(max-width:760px){.sync-page:not(.sync-page--embedded){padding:16px}.sync-page--embedded{padding:0}.overview{grid-template-columns:1fr;gap:18px}.resource-row{grid-template-columns:1fr auto}.resource-row>span,.resource-row>small{grid-column:1/-1}.activity-head{display:none}.activity-row summary{grid-template-columns:1fr auto}.activity-row summary>span:nth-child(3),.activity-row summary>span:nth-child(5){font-size:12px}.raw{grid-template-columns:1fr}.sync-shell>header{align-items:flex-start;gap:12px}}
`;
