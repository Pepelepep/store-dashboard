import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useLocation } from "react-router";
import { SettingsIcon } from "@shopify/polaris-icons";

import { PlanSetup, type PlanSetupData } from "../components/setup/PlanSetup";
import { SectionTabs } from "../components/ui/SectionTabs";
import { PageHeader, ShopOpsPage } from "../components/ui/ShopOpsPage";
import { assertCapabilityAccess } from "../lib/auth/permissions.server";
import {
  buildHostedPricingUrl,
  getBillingState,
  isAccessibleBillingState,
} from "../lib/billing.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getEntitlementSnapshot } from "../lib/entitlements.server";
import { consumePlanConfirmedFlash } from "../lib/flash.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { getShopLevelAdminClient } from "../lib/shopify/shop-level-admin.server";
import { authenticate } from "../shopify.server";
import DataSyncPage, {
  action as dataSyncAction,
  ErrorBoundary,
  loader as dataSyncLoader,
} from "./app.admin.sync";

type PlanLoaderData = {
  plan: PlanSetupData;
};

export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url);
  if (url.searchParams.get("tab") === "sync") {
    return dataSyncLoader(args);
  }

  const { session } = await authenticate.admin(args.request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.settings.plan",
    shop: session.shop,
    supabase,
  });
  const permissions = await assertCapabilityAccess({
    capability: "manage_settings",
    request: args.request,
    route: "app.settings.plan",
    session,
    supabase,
  });
  const billingAdmin = await getShopLevelAdminClient({
    shop: session.shop,
    route: "settings.plan",
  });
  const billing = await getBillingState({
    admin: billingAdmin,
    shop: session.shop,
  });
  if (billing.state !== "disabled" && !isAccessibleBillingState(billing)) {
    throw new Response("An active ShopOps Studio plan is required.", {
      status: 402,
    });
  }
  const entitlements = await getEntitlementSnapshot({
    supabase,
    shop: session.shop,
    billing,
  });
  const planFlash = await consumePlanConfirmedFlash(args.request);
  const canManagePlan =
    permissions.isOwner && permissions.identity.isShopifyAccountOwner;
  const payload = {
    plan: {
      currentPlanName:
        billing.state === "disabled" ? "Billing disabled" : billing.plan.displayName,
      state: billing.state === "disabled" ? "active" : billing.state,
      trialEndsAt: billing.state === "disabled" ? null : billing.trialEndsAt,
      cycleEndsAt:
        billing.state === "disabled"
          ? null
          : (billing.currentBillingCycle?.endTime ?? null),
      pendingPlanName:
        billing.state === "disabled" ? null : (billing.pendingPlan?.displayName ?? null),
      activeLocations: {
        usage: entitlements.activeReportingLocations,
        limit: entitlements.limits.activeLocations,
      },
      dashboardUsers: {
        usage: entitlements.activeDashboardUsers,
        limit: entitlements.limits.dashboardUsers,
      },
      managePlanUrl:
        canManagePlan && billing.state !== "disabled"
          ? buildHostedPricingUrl({ shop: session.shop })
          : null,
      canManagePlan: canManagePlan && billing.state !== "disabled",
      owner: entitlements.owner,
      resolutionRequired: entitlements.resolutionRequired,
      userLimitExceeded: entitlements.userLimitExceeded,
      locationLimitExceeded: entitlements.locationLimitExceeded,
      locationSelectionRequired: entitlements.locationSelectionRequired,
      flashMessage: planFlash.message,
    },
  } satisfies PlanLoaderData;

  return planFlash.setCookie
    ? data(payload, { headers: { "Set-Cookie": planFlash.setCookie } })
    : payload;
}

export async function action(args: ActionFunctionArgs) {
  return dataSyncAction(args);
}

export { ErrorBoundary };

export default function SettingsPage() {
  const location = useLocation();
  const tab =
    new URLSearchParams(location.search).get("tab") === "sync"
      ? "sync"
      : "plan";

  return (
    <ShopOpsPage>
      <PageHeader
        description="Manage plan, billing, and data synchronization."
        icon={SettingsIcon}
        title="Settings"
      />
      <SectionTabs
        activeTab={tab}
        ariaLabel="Settings sections"
        tabs={[
          { value: "plan", label: "Plan & billing" },
          { value: "sync", label: "Data sync" },
        ]}
      />
      {tab === "sync" ? <DataSyncPage embedded /> : <PlanBillingContent />}
    </ShopOpsPage>
  );
}

function PlanBillingContent() {
  const { plan } = useLoaderData<PlanLoaderData>();
  return <PlanSetup data={plan} />;
}
