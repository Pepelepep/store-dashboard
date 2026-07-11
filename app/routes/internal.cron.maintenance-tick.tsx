import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { runMaintenanceTick } from "../lib/sync/maintenance.server";

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  if (!authorized(request))
    return response({ ok: false, error: "Unauthorized" }, 401);
  return response({ ok: false, error: "Method not allowed" }, 405);
}

export async function action({ request }: ActionFunctionArgs) {
  if (!authorized(request))
    return response({ ok: false, error: "Unauthorized" }, 401);
  const summary = await runMaintenanceTick();
  return response(summary, summary.ok || summary.partial ? 200 : 500);
}
