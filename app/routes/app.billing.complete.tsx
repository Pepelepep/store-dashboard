import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import {
  isRecognizedPlanHandle,
  isAccessibleBillingState,
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
    throw new Response("Missing plan handle.", { status: 400 });
  }
  if (!isRecognizedPlanHandle(returnedPlanHandle)) {
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
