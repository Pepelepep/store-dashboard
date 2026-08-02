import type { LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  redirect,
  useLocation,
  useRouteError,
} from "react-router";

import { PageNotice } from "../components/ui/PageNotice";
import {
  isRecognizedPlanHandle,
  isAccessibleBillingState,
  logBillingCallbackInputRejection,
  logBillingCallbackVerification,
  refreshBillingState,
  verifyBillingCallbackPlan,
} from "../lib/billing.server";
import {
  assertOwnerAccess,
  OwnerBootstrapError,
} from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { setPlanConfirmedFlash } from "../lib/flash.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { authenticate } from "../shopify.server";

function buildVerifiedRedirect(url: URL) {
  const searchParams = new URLSearchParams(url.search);
  searchParams.delete("plan_handle");
  searchParams.delete("billing_state");
  searchParams.delete("retry");
  searchParams.delete("billing");
  searchParams.set("tab", "plan");
  const search = searchParams.toString();
  return `/app/settings${search ? `?${search}` : ""}`;
}

function buildBillingRecoveryPath(search: string) {
  const searchParams = new URLSearchParams(search);
  searchParams.delete("plan_handle");
  searchParams.delete("billing_state");
  searchParams.delete("retry");
  searchParams.delete("billing");
  const query = searchParams.toString();
  return `/app/billing-required${query ? `?${query}` : ""}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  try {
    await assertOwnerAccess({
      request,
      session,
      supabase,
      route: "billing-complete",
    });
  } catch (error) {
    if (!(error instanceof OwnerBootstrapError)) throw error;
    throw new Response("Owner setup is temporarily unavailable.", {
      status: 503,
    });
  }
  await ensureShopInitialized({
    route: "billing-complete",
    shop: session.shop,
    supabase,
  });
  const url = new URL(request.url);
  const returnedPlanHandle = url.searchParams.get("plan_handle");

  if (!returnedPlanHandle) {
    logBillingCallbackInputRejection({
      shop: session.shop,
      reason: "missing_plan_handle",
    });
    throw new Response("Missing plan handle.", { status: 400 });
  }
  if (!isRecognizedPlanHandle(returnedPlanHandle)) {
    logBillingCallbackInputRejection({
      shop: session.shop,
      reason: "unrecognized_plan_handle",
    });
    throw new Response("Unrecognized plan handle.", { status: 400 });
  }

  const billing = await refreshBillingState({
    admin,
    shop: session.shop,
  });
  if (billing.state === "billing_unavailable") {
    logBillingCallbackVerification({
      shop: session.shop,
      billing,
      matched: false,
    });
    throw new Response("Billing verification is temporarily unavailable.", {
      status: 503,
    });
  }
  if (!isAccessibleBillingState(billing)) {
    logBillingCallbackVerification({
      shop: session.shop,
      billing,
      matched: false,
    });
    throw new Response("No matching active subscription was found.", {
      status: 409,
    });
  }

  const matched = verifyBillingCallbackPlan({
    billing,
    returnedPlanHandle,
  });
  logBillingCallbackVerification({
    shop: session.shop,
    billing,
    matched,
  });
  if (!matched) {
    throw new Response("The active subscription does not match this plan.", {
      status: 409,
    });
  }

  throw redirect(buildVerifiedRedirect(url), {
    headers: { "Set-Cookie": await setPlanConfirmedFlash(request) },
  });
}

export default function BillingComplete() {
  return null;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const location = useLocation();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const temporarilyUnavailable = status === 503;
  const ownerRequired = status === 401 || status === 403;
  const confirmationRejected = status === 400 || status === 409;
  const retryPath = `${location.pathname}${location.search}`;
  const recoveryPath = buildBillingRecoveryPath(location.search);

  return (
    <main style={{ background: "#f6f6f7", minHeight: "100vh", padding: 24 }}>
      <PageNotice
        cta={{
          label: temporarilyUnavailable
            ? "Retry confirmation"
            : "Continue to plan selection",
          reloadDocument: true,
          to: temporarilyUnavailable ? retryPath : recoveryPath,
        }}
        message={
          temporarilyUnavailable
            ? "Shopify could not confirm the store's current plan right now. Nothing was changed. Retry in a moment."
            : ownerRequired
              ? "Only the Shopify store owner can confirm or manage the ShopOps Studio plan."
              : confirmationRejected
                ? "Shopify did not confirm the plan from this return link. ShopOps did not assign a plan from the link."
                : "ShopOps could not finish confirming the plan. Nothing was changed."
        }
        style={{ margin: "0 auto", maxWidth: 720 }}
        title={
          temporarilyUnavailable
            ? "Plan confirmation temporarily unavailable"
            : ownerRequired
              ? "Store owner action required"
              : "Plan not confirmed"
        }
        tone={temporarilyUnavailable || ownerRequired ? "warning" : "critical"}
      >
        <div>
          <a href="/support">Contact support</a>
        </div>
      </PageNotice>
    </main>
  );
}
