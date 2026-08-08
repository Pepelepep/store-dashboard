import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getDataSyncPath } from "../app/lib/navigation/sync-status.ts";
import {
  createOfflineAdminClient,
  ShopifyAuthenticationRequiredError,
} from "../app/lib/shopify/offline-authentication.ts";
import { deleteShopifySessionsForUninstalledShop } from "../app/lib/shopify/session-lifecycle.server.ts";
import {
  getSyncFailureBannerState,
  getUnresolvedSyncFailureState,
  SYNC_FAILURE_WARNING_THRESHOLD_MS,
} from "../app/lib/sync/sync-failure-resolution.ts";
import {
  calculateReportedProfit,
  calculateRemainingLineCogs,
  getPreDiscountUnitPrice,
  isValidEstimatePercent,
  previewEstimateImpact,
  resolveLineCogs,
  summarizeCogs,
} from "../app/lib/financial/cogs.ts";
import { formatRelativeUpdatedAt } from "../app/lib/financial/cogs-setup.ts";
import { allocateExpensesByLocation } from "../app/lib/financial/expense-allocation.ts";
import { calculateNetSalesAfterCashRefunds } from "../app/lib/financial/net-sales.ts";
import { fetchAllSupabasePages } from "../app/lib/db/supabase-pagination.server.ts";
import { respondToOperationalWebhook } from "../app/lib/webhooks/operational-webhook-response.server.ts";
import {
  deleteShopScopedSupabaseData,
  getSafeCustomerRequestDetails,
  recordComplianceWebhookEvent,
  SHOP_REDACTION_TABLES,
} from "../app/lib/compliance/compliance-webhooks.server.ts";
import { validateExpenseMonthRange } from "../app/lib/financial/expense-validation.ts";
import { getRecentOrderChips } from "../app/lib/dashboard/recent-order-flags.ts";
import { resolveReportingScope } from "../app/lib/auth/location-performance-access.ts";
import {
  ASSIGNABLE_SHOP_OPS_ROLES,
  SHOP_OPS_ROLE_DEFINITIONS,
  getShopOpsDefaultPath,
  getShopOpsNavigation,
  normalizeShopOpsAccessConfiguration,
} from "../app/lib/auth/role-capabilities.ts";
import { buildDrilldownResetKey } from "../app/lib/dashboard/drilldown-reset-key.ts";
import { reconcileTrendRowsWithCashRefunds } from "../app/lib/dashboard/location-trend-reconciliation.ts";
import { limitRankedBreakdownRows } from "../app/lib/dashboard/ranked-breakdown.ts";
import {
  formatCurrencyAxis,
  formatIntegerAxis,
  formatNonZeroCurrencyLabel,
  formatNonZeroIntegerLabel,
  formatTrendPeriodLabel,
  hasMirrorChartActivity,
} from "../app/lib/dashboard/chart-formatters.ts";
import { computeHourlySalesRows } from "../app/lib/dashboard/hourly-sales.ts";
import {
  EXPECTED_SHOPIFY_APP_HANDLE,
  PLAN_DEFINITIONS,
  PRIVATE_PLAN_HANDLES,
  PUBLIC_PLAN_HANDLES,
  buildHostedPricingUrl,
  clearBillingCache,
  getActiveSubscription,
  getBillingEnvironment,
  getBillingState,
  refreshBillingState,
  requireBillingAccess,
  resolveCurrentPlan,
  verifyBillingCallbackPlan,
} from "../app/lib/billing.server.ts";
import {
  getCapacityState,
  summarizeEntitlements,
} from "../app/lib/entitlement-model.ts";
import { resolveOwnerMaterializationIdentifiers } from "../app/lib/auth/owner-bootstrap.ts";
import {
  getCurrentShopifyUserIdentity,
  getShopOpsAccessPresentation,
  getShopOpsAccessState,
  isValidShopOpsEmail,
  normalizeShopOpsEmail,
} from "../app/lib/auth/shopops-access.ts";
import {
  buildAccessAudit,
  maskEmail,
  parseAccessMaintenanceArgs,
} from "../scripts/shopops-access-maintenance.mjs";

const shop = "shopops-fresh-qa.myshopify.com";

const enabledBillingEnvironment = {
  enabled: true,
  organizationId: "123456",
  accessToken: "partner-test-token",
  appGid: "gid://shopify/App/123456",
  apiVersion: "2026-07",
  appHandle: "shopops-studio",
};

function billingAdmin(shopGid = "gid://shopify/Shop/123456", onCall) {
  return {
    async graphql() {
      onCall?.();
      return Response.json({ data: { shop: { id: shopGid } } });
    },
  };
}

function activeSubscriptionPayload({
  shopDomain,
  handle = "solo",
  shopGid = "gid://shopify/Shop/123456",
  trialEndsAt = null,
  cancelAtEndOfCycle = false,
  currentBillingCycle = {
    startTime: "2026-07-01T00:00:00.000Z",
    endTime: "2026-08-01T00:00:00.000Z",
  },
  pendingHandle = null,
} = {}) {
  return {
    data: {
      activeSubscription: {
        shop: {
          id: shopGid,
          myshopifyDomain: shopDomain,
        },
        billingPeriod: "EVERY_30_DAYS",
        cancelAtEndOfCycle,
        trialEndsAt,
        currentBillingCycle,
        items: [{ handle }],
        pendingUpdate: pendingHandle
          ? {
              billingPeriod: "EVERY_30_DAYS",
              items: [{ handle: pendingHandle }],
            }
          : null,
      },
    },
  };
}

function subscriptionFetch(payload, onCall) {
  return async (url, init) => {
    onCall?.({ url: String(url), init });
    return Response.json(payload);
  };
}

function offlineContext(accessToken, graphql) {
  return {
    session: {
      id: `offline_${shop}`,
      shop,
      isOnline: false,
      accessToken,
    },
    admin: { graphql },
  };
}

test("uninstall deletes every Shopify session for the shop even without a loaded webhook session", async () => {
  const calls = [];
  const db = {
    session: {
      async deleteMany(args) {
        calls.push(args);
        return { count: 2 };
      },
    },
  };

  const result = await deleteShopifySessionsForUninstalledShop({ db, shop });

  assert.deepEqual(calls, [{ where: { shop } }]);
  assert.equal(result.count, 2);
});

test("background clients reject online sessions and select the canonical offline session", async () => {
  let graphqlCalled = false;

  await assert.rejects(
    createOfflineAdminClient(shop, {
      loadAdminContext: async () => ({
        session: {
          id: `${shop}_123`,
          shop,
          isOnline: true,
          accessToken: "online-token",
        },
        admin: {
          async graphql() {
            graphqlCalled = true;
            return new Response();
          },
        },
      }),
      invalidateSession: async () => {},
    }),
    ShopifyAuthenticationRequiredError,
  );

  assert.equal(graphqlCalled, false);
});

test("a stale 401 invalidates only that offline session and a reinstall uses the replacement", async () => {
  const invalidatedSessionIds = [];
  const staleClient = await createOfflineAdminClient(shop, {
    loadAdminContext: async () =>
      offlineContext(
        "revoked-token",
        async () => new Response(null, { status: 401 }),
      ),
    invalidateSession: async (session) => {
      invalidatedSessionIds.push(session.id);
    },
  });

  await assert.rejects(
    staleClient.graphql("{ shop { name } }"),
    ShopifyAuthenticationRequiredError,
  );
  assert.deepEqual(invalidatedSessionIds, [`offline_${shop}`]);

  let replacementUsed = false;
  const replacementClient = await createOfflineAdminClient(shop, {
    loadAdminContext: async () =>
      offlineContext("replacement-token", async () => {
        replacementUsed = true;
        return new Response(
          JSON.stringify({ data: { shop: { name: "QA" } } }),
          {
            status: 200,
          },
        );
      }),
    invalidateSession: async () => {
      assert.fail("the replacement session must not be invalidated");
    },
  });

  const response = await replacementClient.graphql("{ shop { name } }");
  assert.equal(response.status, 200);
  assert.equal(replacementUsed, true);
});

test("sync warning CTA retains Shopify embedded-app navigation context", () => {
  const search =
    "?shop=shopops-fresh-qa.myshopify.com&host=encoded-host&id_token=encoded-token";

  assert.equal(
    getDataSyncPath(search),
    "/app/settings?shop=shopops-fresh-qa.myshopify.com&host=encoded-host&id_token=encoded-token&tab=sync",
  );
  assert.equal(
    getDataSyncPath("host=encoded-host"),
    "/app/settings?host=encoded-host&tab=sync",
  );
});

test("old authentication failure followed by a successful full sync hides the banner", () => {
  const result = getUnresolvedSyncFailureState({
    runs: [
      {
        sync_type: "locations",
        status: "error",
        started_at: "2026-07-25T10:00:00.000Z",
        finished_at: "2026-07-25T10:01:00.000Z",
        details: { jobId: "failed-full-job" },
      },
    ],
    jobs: [
      {
        job_type: "full",
        status: "error",
        current_step: "locations",
        created_at: "2026-07-25T10:00:00.000Z",
        updated_at: "2026-07-25T10:01:00.000Z",
        finished_at: "2026-07-25T10:01:00.000Z",
      },
      {
        job_type: "full",
        status: "success",
        current_step: "orders",
        created_at: "2026-07-25T11:00:00.000Z",
        updated_at: "2026-07-25T11:10:00.000Z",
        finished_at: "2026-07-25T11:10:00.000Z",
        details: {
          completedSteps: ["locations", "products", "inventory", "orders"],
        },
      },
    ],
    webhookEvents: [],
  });

  assert.equal(result.hasUnresolvedFailure, false);
  assert.equal(result.latestUnresolvedFailureAt, null);
});

test("failure newer than the most recent successful sync shows the banner", () => {
  const result = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        job_type: "full",
        status: "success",
        created_at: "2026-07-25T10:00:00.000Z",
        updated_at: "2026-07-25T10:10:00.000Z",
        finished_at: "2026-07-25T10:10:00.000Z",
      },
      {
        job_type: "orders",
        status: "error",
        created_at: "2026-07-25T11:00:00.000Z",
        updated_at: "2026-07-25T11:01:00.000Z",
        finished_at: "2026-07-25T11:01:00.000Z",
      },
    ],
    webhookEvents: [],
  });

  assert.equal(result.hasUnresolvedFailure, true);
  assert.equal(result.latestUnresolvedFailureAt, "2026-07-25T11:01:00.000Z");
});

test("partial success leaves another resource failure unresolved", () => {
  const result = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        job_type: "inventory",
        status: "error",
        created_at: "2026-07-25T10:00:00.000Z",
        updated_at: "2026-07-25T10:01:00.000Z",
        finished_at: "2026-07-25T10:01:00.000Z",
      },
      {
        job_type: "products",
        status: "success",
        created_at: "2026-07-25T11:00:00.000Z",
        updated_at: "2026-07-25T11:05:00.000Z",
        finished_at: "2026-07-25T11:05:00.000Z",
      },
    ],
    webhookEvents: [],
  });

  assert.equal(result.hasUnresolvedFailure, true);
});

test("catalog success does not clear an unresolved order webhook failure", () => {
  const result = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        job_type: "products",
        status: "success",
        created_at: "2026-07-25T11:00:00.000Z",
        updated_at: "2026-07-25T11:05:00.000Z",
        finished_at: "2026-07-25T11:05:00.000Z",
      },
    ],
    webhookEvents: [
      {
        topic: "orders/updated",
        status: "error",
        received_at: "2026-07-25T10:00:00.000Z",
        processed_at: "2026-07-25T10:01:00.000Z",
      },
    ],
  });

  assert.equal(result.hasUnresolvedFailure, true);
});

test("pending and running work is not presented as a failure", () => {
  const result = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        job_type: "full",
        status: "pending",
        created_at: "2026-07-25T10:00:00.000Z",
        updated_at: "2026-07-25T10:00:00.000Z",
      },
      {
        job_type: "orders",
        status: "running",
        created_at: "2026-07-25T11:00:00.000Z",
        started_at: "2026-07-25T11:01:00.000Z",
        updated_at: "2026-07-25T11:02:00.000Z",
      },
    ],
    webhookEvents: [],
  });

  assert.equal(result.hasUnresolvedFailure, false);
});

test("single recent transient unresolved failure has no global warning", () => {
  const now = new Date("2026-07-25T12:00:00.000Z").getTime();
  const resolution = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        id: "recent-orders-failure",
        job_type: "orders",
        status: "error",
        created_at: "2026-07-25T11:55:00.000Z",
        updated_at: "2026-07-25T11:56:00.000Z",
        finished_at: "2026-07-25T11:56:00.000Z",
      },
    ],
    webhookEvents: [],
  });

  assert.equal(
    getSyncFailureBannerState({ resolution, canAdmin: true, now }).kind,
    "hidden",
  );
});

test("failure unresolved for the threshold shows calm delayed-data copy", () => {
  const failureAt = new Date("2026-07-25T11:45:00.000Z").getTime();
  const resolution = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        id: "persistent-inventory-failure",
        job_type: "inventory",
        status: "error",
        created_at: "2026-07-25T11:44:00.000Z",
        updated_at: "2026-07-25T11:45:00.000Z",
        finished_at: "2026-07-25T11:45:00.000Z",
      },
    ],
    webhookEvents: [],
  });
  const banner = getSyncFailureBannerState({
    resolution,
    canAdmin: true,
    now: failureAt + SYNC_FAILURE_WARNING_THRESHOLD_MS,
  });

  assert.equal(banner.kind, "delayed_data");
  assert.equal(banner.title, "Some Shopify data may be delayed.");
  assert.equal(
    banner.message,
    "ShopOps is retrying automatically. No action is required.",
  );
  assert.equal(banner.showReconnectAction, false);
});

test("repeated recent failed attempts show the delayed-data warning", () => {
  const resolution = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        id: "orders-attempt-1",
        job_type: "orders",
        status: "error",
        created_at: "2026-07-25T11:55:00.000Z",
        updated_at: "2026-07-25T11:56:00.000Z",
        finished_at: "2026-07-25T11:56:00.000Z",
      },
      {
        id: "orders-attempt-2",
        job_type: "orders",
        status: "error",
        created_at: "2026-07-25T11:57:00.000Z",
        updated_at: "2026-07-25T11:58:00.000Z",
        finished_at: "2026-07-25T11:58:00.000Z",
      },
    ],
    webhookEvents: [],
  });

  assert.equal(
    getSyncFailureBannerState({
      resolution,
      canAdmin: true,
      now: new Date("2026-07-25T12:00:00.000Z").getTime(),
    }).kind,
    "delayed_data",
  );
});

test("recovered failure has no merchant-facing warning", () => {
  const resolution = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        id: "failed-full",
        job_type: "full",
        status: "error",
        created_at: "2026-07-25T10:00:00.000Z",
        updated_at: "2026-07-25T10:01:00.000Z",
        finished_at: "2026-07-25T10:01:00.000Z",
      },
      {
        id: "recovered-full",
        job_type: "full",
        status: "success",
        created_at: "2026-07-25T11:00:00.000Z",
        updated_at: "2026-07-25T11:10:00.000Z",
        finished_at: "2026-07-25T11:10:00.000Z",
      },
    ],
    webhookEvents: [],
  });

  assert.equal(
    getSyncFailureBannerState({
      resolution,
      canAdmin: true,
      now: new Date("2026-07-25T12:00:00.000Z").getTime(),
    }).kind,
    "hidden",
  );
});

test("missing Shopify authentication exposes reconnect only to admins", () => {
  const resolution = getUnresolvedSyncFailureState({
    runs: [],
    jobs: [
      {
        id: "authentication-failure",
        job_type: "full",
        status: "error",
        created_at: "2026-07-25T11:59:00.000Z",
        updated_at: "2026-07-25T12:00:00.000Z",
        finished_at: "2026-07-25T12:00:00.000Z",
        details: {
          authenticationRequired: true,
          errorCode: "shopify_authentication_required",
        },
      },
    ],
    webhookEvents: [],
  });

  const adminBanner = getSyncFailureBannerState({
    resolution,
    canAdmin: true,
  });
  const staffBanner = getSyncFailureBannerState({
    resolution,
    canAdmin: false,
  });

  assert.equal(adminBanner.kind, "authentication_required");
  assert.equal(adminBanner.showReconnectAction, true);
  assert.equal(staffBanner.kind, "authentication_required");
  assert.equal(staffBanner.showReconnectAction, false);
});

test("missing product and custom-sale costs remain missing without a fallback", () => {
  assert.equal(
    calculateRemainingLineCogs({
      quantity: 1,
      returned_quantity: 0,
      unit_cost: null,
    }),
    null,
  );
  assert.equal(
    calculateRemainingLineCogs({
      quantity: 2,
      returned_quantity: 0,
      cost_at_sale: null,
      unit_cost: null,
    }),
    null,
  );
  assert.equal(
    calculateRemainingLineCogs({
      quantity: 1,
      returned_quantity: 1,
      unit_cost: null,
    }),
    0,
  );
});

test("explicit zero and known Shopify costs are actual costs", () => {
  assert.equal(calculateRemainingLineCogs({ quantity: 3, unit_cost: 0 }), 0);
  assert.equal(calculateRemainingLineCogs({ quantity: 2, unit_cost: 10 }), 20);
});

test("returned product quantity proportionally reverses COGS", () => {
  assert.equal(
    calculateRemainingLineCogs({
      quantity: 2,
      returned_quantity: 1,
      cost_at_sale: 10,
    }),
    10,
  );
  assert.equal(
    calculateRemainingLineCogs({
      quantity: 2,
      returned_quantity: 2,
      cost_at_sale: 10,
    }),
    0,
  );
});

test("cash-only refund does not reverse product COGS", () => {
  const originalCogs = calculateRemainingLineCogs({
    quantity: 2,
    returned_quantity: 0,
    cost_at_sale: 10,
  });
  const afterCashRefundCogs = calculateRemainingLineCogs({
    quantity: 2,
    returned_quantity: 0,
    cost_at_sale: 10,
  });

  assert.equal(originalCogs, 20);
  assert.equal(afterCashRefundCogs, 20);
  assert.equal(
    calculateNetSalesAfterCashRefunds({
      lineNetSales: 100,
      merchandiseReturns: 0,
      totalRefunds: 25,
    }),
    75,
  );
  assert.equal(
    calculateNetSalesAfterCashRefunds({
      lineNetSales: 50,
      merchandiseReturns: 50,
      totalRefunds: 50,
    }),
    50,
  );
});

const estimatesDisabled = {
  enabled: false,
  percent: null,
  estimateCustomSales: false,
};

test("COGS estimates are disabled by default and missing cost stays missing", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260726120000_add_shop_cogs_estimates.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /cogs_estimate_enabled boolean NOT NULL DEFAULT false/,
  );
  assert.equal(
    resolveLineCogs(
      { quantity: 1, shopify_variant_id: "variant-1" },
      estimatesDisabled,
    ).kind,
    "missing",
  );
});

test("actual at-sale and current Shopify costs take priority over estimates", () => {
  assert.deepEqual(
    resolveLineCogs(
      {
        quantity: 2,
        cost_at_sale: 4,
        unit_cost: 9,
        gross_sales: 100,
        shopify_variant_id: "variant-1",
      },
      { enabled: true, percent: 50, estimateCustomSales: true },
    ),
    {
      kind: "actual",
      cogs: 8,
      unitCost: 4,
      estimatePercent: null,
    },
  );
  assert.equal(
    resolveLineCogs(
      {
        quantity: 3,
        unit_cost: 0,
        gross_sales: 90,
        shopify_variant_id: "variant-1",
      },
      { enabled: true, percent: 50, estimateCustomSales: false },
    ).kind,
    "actual",
  );
});

test("missing product cost uses the shop percentage before discounts", () => {
  const line = {
    quantity: 2,
    returned_quantity: 0,
    gross_sales: 100,
    net_sales: 70,
    unit_price: 35,
    shopify_variant_id: "variant-1",
  };
  const result = resolveLineCogs(line, {
    enabled: true,
    percent: 40,
    estimateCustomSales: false,
  });

  assert.equal(getPreDiscountUnitPrice(line), 50);
  assert.deepEqual(result, {
    kind: "estimated",
    cogs: 40,
    unitCost: 20,
    estimatePercent: 40,
  });
});

test("custom sales estimate only when the custom-sale option is enabled", () => {
  const customLine = { quantity: 1, gross_sales: 100 };

  assert.equal(
    resolveLineCogs(customLine, {
      enabled: true,
      percent: 40,
      estimateCustomSales: false,
    }).kind,
    "missing",
  );
  assert.equal(
    resolveLineCogs(customLine, {
      enabled: true,
      percent: 40,
      estimateCustomSales: true,
    }).cogs,
    40,
  );
});

test("estimate percentage boundaries are inclusive and reject invalid values", () => {
  assert.equal(isValidEstimatePercent(0), true);
  assert.equal(isValidEstimatePercent(100), true);
  assert.equal(isValidEstimatePercent(-0.01), false);
  assert.equal(isValidEstimatePercent(100.01), false);
  assert.equal(isValidEstimatePercent(Number.NaN), false);
});

test("partial and full returns reverse estimated COGS proportionally", () => {
  const settings = {
    enabled: true,
    percent: 50,
    estimateCustomSales: false,
  };

  assert.equal(
    resolveLineCogs(
      {
        quantity: 2,
        returned_quantity: 1,
        gross_sales: 40,
        shopify_variant_id: "variant-1",
      },
      settings,
    ).cogs,
    10,
  );
  assert.equal(
    resolveLineCogs(
      {
        quantity: 2,
        returned_quantity: 2,
        gross_sales: 40,
        shopify_variant_id: "variant-1",
      },
      settings,
    ).cogs,
    0,
  );
});

test("fully returned missing-cost line does not block profit", () => {
  const summary = summarizeCogs([
    {
      quantity: 1,
      returned_quantity: 1,
      cost_source: "MISSING_COST",
    },
  ]);

  assert.equal(
    calculateRemainingLineCogs({
      quantity: 1,
      returned_quantity: 1,
    }),
    0,
  );
  assert.equal(summary.cogs, 0);
  assert.equal(summary.cogsIncomplete, false);
  assert.equal(summary.missingCogsLineCount, 0);
  assert.deepEqual(
    calculateReportedProfit({
      netSales: 0,
      knownCogs: summary.cogs,
      expenses: 0,
      cogsIncomplete: summary.cogsIncomplete,
    }),
    {
      grossProfit: 0,
      grossMarginPct: null,
      netProfit: 0,
    },
  );
});

test("fully returned lines are excluded from coverage and preview", () => {
  const returnedLines = [
    {
      quantity: 1,
      returned_quantity: 1,
      unit_cost: 10,
      cost_source: "ACTUAL_SHOPIFY_COST",
      net_sales: 0,
    },
    {
      quantity: 1,
      returned_quantity: 1,
      unit_cost: 40,
      cogs: 40,
      cost_source: "SHOP_PERCENT_ESTIMATE",
      gross_sales: 100,
      net_sales: 0,
      shopify_variant_id: "variant-1",
    },
    {
      quantity: 1,
      returned_quantity: 1,
      cost_source: "MISSING_COST",
      gross_sales: 100,
      net_sales: 0,
      shopify_variant_id: "variant-2",
    },
  ];
  const summary = summarizeCogs(returnedLines);
  const preview = previewEstimateImpact(returnedLines, estimatesDisabled);

  assert.equal(summary.actualCogsLineCount, 0);
  assert.equal(summary.estimatedCogsLineCount, 0);
  assert.equal(summary.missingCogsLineCount, 0);
  assert.deepEqual(preview, {
    affectedLineCount: 0,
    estimatedCogs: 0,
    estimatedProfit: 0,
    missingLineCount: 0,
  });
});

test("stored actual order-line cost survives a missing variant", () => {
  assert.deepEqual(
    resolveLineCogs(
      {
        quantity: 2,
        unit_cost: 12,
        cost_source: "ACTUAL_SHOPIFY_COST",
        shopify_variant_id: "deleted-variant",
      },
      estimatesDisabled,
    ),
    {
      kind: "actual",
      cogs: 24,
      unitCost: 12,
      estimatePercent: null,
    },
  );
});

test("stored estimated unit cost is never promoted to actual", () => {
  const line = {
    quantity: 1,
    unit_cost: 40,
    cogs: 40,
    cost_source: "SHOP_PERCENT_ESTIMATE",
    gross_sales: 100,
    shopify_variant_id: "variant-1",
  };

  assert.equal(resolveLineCogs(line, estimatesDisabled).kind, "missing");
  assert.deepEqual(
    resolveLineCogs(line, {
      enabled: true,
      percent: 20,
      estimateCustomSales: false,
    }),
    {
      kind: "estimated",
      cogs: 20,
      unitCost: 20,
      estimatePercent: 20,
    },
  );
});

test("percentage changes recalculate estimates and disabling returns them to missing", () => {
  const line = {
    quantity: 1,
    gross_sales: 100,
    shopify_variant_id: "variant-1",
  };

  assert.equal(
    resolveLineCogs(line, {
      enabled: true,
      percent: 30,
      estimateCustomSales: false,
    }).cogs,
    30,
  );
  assert.equal(
    resolveLineCogs(line, {
      enabled: true,
      percent: 45,
      estimateCustomSales: false,
    }).cogs,
    45,
  );
  assert.equal(resolveLineCogs(line, estimatesDisabled).kind, "missing");
});

test("a later Shopify cost replaces an estimate", () => {
  const settings = {
    enabled: true,
    percent: 40,
    estimateCustomSales: false,
  };
  const estimated = resolveLineCogs(
    { quantity: 1, gross_sales: 100, shopify_variant_id: "variant-1" },
    settings,
  );
  const actual = resolveLineCogs(
    {
      quantity: 1,
      gross_sales: 100,
      unit_cost: 25,
      shopify_variant_id: "variant-1",
    },
    settings,
  );

  assert.equal(estimated.kind, "estimated");
  assert.deepEqual(actual, {
    kind: "actual",
    cogs: 25,
    unitCost: 25,
    estimatePercent: null,
  });
});

test("coverage distinguishes actual, estimated, and missing COGS", () => {
  const result = summarizeCogs([
    { quantity: 1, unit_cost: 10, cost_source: "ACTUAL_SHOPIFY_COST" },
    {
      quantity: 1,
      cogs: 20,
      cost_source: "SHOP_PERCENT_ESTIMATE",
    },
    { quantity: 1, cost_source: "MISSING_COST" },
  ]);

  assert.equal(result.actualCogs, 10);
  assert.equal(result.estimatedCogs, 20);
  assert.equal(result.actualCogsLineCount, 1);
  assert.equal(result.estimatedCogsLineCount, 1);
  assert.equal(result.missingCogsLineCount, 1);
  assert.equal(result.includesEstimatedCogs, true);
});

test("profit is unavailable with missing COGS and marked when estimates are used", () => {
  assert.deepEqual(
    calculateReportedProfit({
      netSales: 100,
      knownCogs: 20,
      expenses: 10,
      cogsIncomplete: true,
    }),
    {
      grossProfit: null,
      grossMarginPct: null,
      netProfit: null,
    },
  );

  const dashboardCards = readFileSync(
    new URL("../app/components/dashboard/KpiCards.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dashboardCards, /missing[\s\n]+product costs\./);
  assert.match(dashboardCards, /Includes estimated product costs/);
  assert.match(dashboardCards, /Review product costs/);
  assert.equal(dashboardCards.includes("Profit unavailable"), false);
});

test("estimate preview changes without persistence", () => {
  const lines = [
    {
      quantity: 1,
      gross_sales: 100,
      net_sales: 80,
      shopify_variant_id: "variant-1",
    },
  ];
  const preview = previewEstimateImpact(lines, {
    enabled: true,
    percent: 40,
    estimateCustomSales: false,
  });

  assert.deepEqual(preview, {
    affectedLineCount: 1,
    estimatedCogs: 40,
    estimatedProfit: 40,
    missingLineCount: 0,
  });
});

test("merchant navigation is the exact capability-aware information architecture", () => {
  const costsRoute = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );
  const appRoute = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );

  assert.deepEqual(
    getShopOpsNavigation("viewer").map((item) => item.label),
    ["Overview"],
  );
  assert.deepEqual(
    getShopOpsNavigation("manager").map((item) => item.label),
    ["Overview", "Compare Locations"],
  );
  const operationalNavigation = [
    "Overview",
    "Compare Locations",
    "Costs",
    "People",
    "Settings",
  ];
  assert.deepEqual(
    getShopOpsNavigation("admin").map((item) => item.label),
    operationalNavigation,
  );
  assert.deepEqual(
    getShopOpsNavigation("owner").map((item) => item.label),
    operationalNavigation,
  );
  for (const role of ["viewer", "manager", "admin", "owner"]) {
    assert.equal(getShopOpsDefaultPath(role), "/app/db-dashboard");
  }
  assert.match(costsRoute, /capability: "manage_costs"/);
  assert.match(appRoute, /getShopOpsNavigation\(permissions\.role\)/);
  assert.match(appRoute, /navigationItems\.map\(\(item\) =>/);
  for (const removedLabel of [
    ">Setup<",
    ">Staff<",
    ">Plan<",
    ">Location Performance<",
  ]) {
    assert.equal(appRoute.includes(removedLabel), false);
  }
});

test("ShopOps roles use one exact merchant-facing capability matrix", () => {
  const expectedCapabilities = {
    viewer: {
      view_dashboard: true,
      view_locations: false,
      assigned_locations: true,
      manage_people: false,
      manage_costs: false,
      view_data_quality: false,
      manage_sync: false,
      manage_settings: false,
      manage_billing: false,
      all_locations: false,
    },
    manager: {
      view_dashboard: true,
      view_locations: true,
      assigned_locations: true,
      manage_people: false,
      manage_costs: false,
      view_data_quality: false,
      manage_sync: false,
      manage_settings: false,
      manage_billing: false,
      all_locations: false,
    },
    admin: {
      view_dashboard: true,
      view_locations: true,
      assigned_locations: false,
      manage_people: true,
      manage_costs: true,
      view_data_quality: true,
      manage_sync: true,
      manage_settings: true,
      manage_billing: false,
      all_locations: true,
    },
    owner: {
      view_dashboard: true,
      view_locations: true,
      assigned_locations: false,
      manage_people: true,
      manage_costs: true,
      view_data_quality: true,
      manage_sync: true,
      manage_settings: true,
      manage_billing: true,
      all_locations: true,
    },
  };

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(SHOP_OPS_ROLE_DEFINITIONS).map(([role, definition]) => [
        role,
        definition.capabilities,
      ]),
    ),
    expectedCapabilities,
  );
  assert.equal(SHOP_OPS_ROLE_DEFINITIONS.viewer.label, "Location viewer");
  assert.equal(
    SHOP_OPS_ROLE_DEFINITIONS.viewer.description,
    "View performance for assigned locations only.",
  );
  assert.equal(SHOP_OPS_ROLE_DEFINITIONS.manager.label, "Reporting manager");
  assert.equal(
    SHOP_OPS_ROLE_DEFINITIONS.manager.description,
    "View the Dashboard and performance for assigned locations.",
  );
  assert.equal(
    SHOP_OPS_ROLE_DEFINITIONS.admin.description,
    "Manage reporting, people, costs, synchronization, and settings. Billing remains owner-only.",
  );
  assert.deepEqual(ASSIGNABLE_SHOP_OPS_ROLES, ["viewer", "manager", "admin"]);
  assert.equal(ASSIGNABLE_SHOP_OPS_ROLES.includes("owner"), false);
});

test("ShopOps access configuration requires assignments only for scoped roles", () => {
  assert.equal(
    normalizeShopOpsAccessConfiguration({ role: "viewer", locationIds: [] }),
    null,
  );
  assert.equal(
    normalizeShopOpsAccessConfiguration({ role: "manager", locationIds: [] }),
    null,
  );
  assert.deepEqual(
    normalizeShopOpsAccessConfiguration({
      role: "manager",
      locationIds: ["location-a", "location-a", " location-b "],
    }),
    { role: "manager", locationIds: ["location-a", "location-b"] },
  );
  assert.deepEqual(
    normalizeShopOpsAccessConfiguration({
      role: "admin",
      locationIds: ["location-a"],
    }),
    { role: "admin", locationIds: [] },
  );
  assert.equal(
    normalizeShopOpsAccessConfiguration({
      role: "owner",
      locationIds: ["location-a"],
    }),
    null,
  );
});

test("shared reporting scope cannot be expanded by client location IDs", () => {
  const locations = [
    { shopify_location_id: "location-a", name: "A" },
    { shopify_location_id: "location-b", name: "B" },
    { shopify_location_id: "location-c", name: "C" },
  ];
  const viewer = resolveReportingScope({
    locations,
    permissions: {
      allowedLocationIds: new Set(["location-b"]),
      capabilities: SHOP_OPS_ROLE_DEFINITIONS.viewer.capabilities,
    },
    route: "test.viewer",
    shop,
  });
  const manager = resolveReportingScope({
    locations,
    permissions: {
      allowedLocationIds: new Set(["location-a", "location-c"]),
      capabilities: SHOP_OPS_ROLE_DEFINITIONS.manager.capabilities,
    },
    route: "test.manager",
    shop,
  });
  const admin = resolveReportingScope({
    locations,
    permissions: {
      allowedLocationIds: new Set(),
      capabilities: SHOP_OPS_ROLE_DEFINITIONS.admin.capabilities,
    },
    route: "test.admin",
    shop,
  });

  assert.deepEqual(viewer.accessibleLocations, [locations[1]]);
  assert.deepEqual(viewer.selectedLocations, [locations[1]]);
  assert.deepEqual(manager.accessibleLocations, [locations[0], locations[2]]);
  assert.deepEqual(manager.selectedLocations, [locations[0], locations[2]]);
  assert.deepEqual(admin.accessibleLocations, locations);
  assert.deepEqual(admin.selectedLocations, locations);

  let denied;
  try {
    resolveReportingScope({
      locations,
      permissions: {
        allowedLocationIds: new Set(["location-b"]),
        capabilities: SHOP_OPS_ROLE_DEFINITIONS.viewer.capabilities,
      },
      requestedLocationIds: ["location-a"],
      route: "test.viewer-query",
      shop,
    });
  } catch (error) {
    denied = error;
  }
  assert.equal(denied instanceof Response, true);
  assert.equal(denied.status, 403);
  assert.equal(
    denied.headers.get("X-ShopOps-Denial-Reason"),
    "location_restricted",
  );
});

test("direct route guards and reporting queries derive from canonical capabilities", () => {
  const source = (path) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const guardedRoutes = [
    ["app/routes/app.db-dashboard.tsx", 'requiredCapability: "view_dashboard"'],
    ["app/routes/app.locations.tsx", 'requiredCapability: "view_locations"'],
    ["app/routes/app.admin.staff.tsx", 'capability: "manage_people"'],
    ["app/routes/app.admin.setup.tsx", 'capability: "manage_costs"'],
    ["app/routes/app.data-quality.tsx", 'capability: "manage_sync"'],
    [
      "app/routes/app.admin.financial-qa.tsx",
      'requiredCapability: "view_data_quality"',
    ],
    ["app/routes/app.admin.sync.tsx", 'capability: "manage_sync"'],
    ["app/routes/app.settings.tsx", 'capability: "manage_settings"'],
  ];
  for (const [path, guard] of guardedRoutes) {
    assert.match(source(path), new RegExp(guard));
  }

  const dashboard = source("app/routes/app.db-dashboard.tsx");
  const locationsRoute = source("app/routes/app.locations.tsx");
  const permissions = source("app/lib/auth/permissions.server.ts");
  const scope = source("app/lib/auth/location-performance-access.ts");
  const billingComplete = source("app/routes/app.billing.complete.tsx");

  assert.match(dashboard, /deniedRedirectTo: "\/app\/locations"/);
  assert.match(dashboard, /resolveReportingScope\(/);
  assert.match(locationsRoute, /resolveReportingScope\(/);
  assert.match(dashboard, /\.in\("retail_location_id", selectedLocationIds\)/);
  assert.match(dashboard, /\.in\("shopify_location_id", selectedLocationIds\)/);
  assert.match(
    dashboard,
    /selectedLocationIds\.reduce\([\s\S]*?computeExpensesForRange/,
  );
  assert.match(
    dashboard,
    /onboarding: permissions\.capabilities\.manage_settings/,
  );
  assert.match(billingComplete, /assertOwnerAccess/);
  assert.match(permissions, /capability: "manage_billing"/);
  assert.match(permissions, /X-ShopOps-Denial-Reason": "role_restricted"/);
  assert.match(scope, /X-ShopOps-Denial-Reason": "location_restricted"/);
  assert.match(permissions, /ShopOps access required\./);
});

test("People access UX presents merchant roles and canonical location scope", () => {
  const people = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const locations = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );

  for (const text of [
    "Assigned locations",
    "This user will only see reporting data for the selected locations.",
    "All reporting locations",
  ]) {
    assert.match(
      people,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(
    people,
    /Admins can access and manage reporting across all configured\s+locations\./,
  );
  assert.match(people, /ASSIGNABLE_SHOP_OPS_ROLES\.map/);
  assert.match(people, /definition\.label/);
  assert.match(people, /definition\.description/);
  assert.match(people, /capabilities\.all_locations \? \(/);
  assert.match(people, /normalizeShopOpsAccessConfiguration/);
  assert.match(people, /return "All locations"/);
  assert.match(locations, /Overview access is not included/);
  assert.match(
    locations,
    /Your ShopOps role provides access to assigned locations only\./,
  );
  assert.match(locations, /label: "View locations"/);
  assert.doesNotMatch(people, /<option value="owner">/);
});

test("COGS recompute functions and settings update are service-role-only", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260726120000_add_shop_cogs_estimates.sql",
      import.meta.url,
    ),
    "utf8",
  );

  for (const signature of [
    "recompute_order_line_cogs_for_shop\\(text\\)",
    "recompute_order_line_cogs_for_variants\\(text, text\\[\\]\\)",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO service_role`,
      ),
    );
  }

  assert.match(
    migration,
    /order_line\.cost_at_sale,[\s\S]*?variant\.unit_cost,[\s\S]*?order_line\.cost_source IS DISTINCT FROM[\s\S]*?'SHOP_PERCENT_ESTIMATE'[\s\S]*?order_line\.unit_cost/,
  );
});

test("product-cost save disables and reports pending recalculation", () => {
  const component = readFileSync(
    new URL("../app/components/setup/ProductCostsSetup.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /useNavigation/);
  assert.match(
    component,
    /navigation\.formData\?\.get\("intent"\) === "save-product-costs"/,
  );
  assert.match(
    component,
    /disabled=\{[\s\S]*?isSaving[\s\S]*?!settingsChanged/,
  );
  assert.match(component, /Saving and recalculating\.\.\./);
});

test("Costs defaults to Product costs and keeps the two operations separate", () => {
  const setupRoute = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );
  const productCostsIndex = setupRoute.indexOf(
    '{ value: "products", label: "Product costs" }',
  );
  const expensesIndex = setupRoute.indexOf(
    '{ value: "expenses", label: "Operating expenses" }',
  );

  assert.ok(productCostsIndex >= 0);
  assert.ok(productCostsIndex < expensesIndex);
  assert.match(
    setupRoute,
    /requestedTab === "expenses" \? "expenses" : "products"/,
  );
  assert.match(setupRoute, /<ProductCostsSetup/);
  assert.match(setupRoute, /expense_name/);
  assert.doesNotMatch(setupRoute, /<PlanSetup/);
});

test("tab-only Setup navigation does not revalidate the route loader", () => {
  const setupRoute = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );

  assert.match(setupRoute, /export function shouldRevalidate/);
  assert.match(setupRoute, /currentSearch\.delete\("tab"\)/);
  assert.match(setupRoute, /nextSearch\.delete\("tab"\)/);
  assert.match(
    setupRoute,
    /currentSearch\.toString\(\) === nextSearch\.toString\(\)[\s\S]*?return false/,
  );
});

test("Product costs uses bounded SQL aggregation instead of loading order lines", () => {
  const setupServer = readFileSync(
    new URL("../app/lib/financial/cogs-setup.server.ts", import.meta.url),
    "utf8",
  );

  assert.equal(setupServer.includes("fetchAllOrderLines"), false);
  assert.equal(setupServer.includes('.from("order_lines")'), false);
  assert.match(setupServer, /get_product_cost_coverage_summary/);
  assert.match(setupServer, /get_missing_product_costs_page/);
  assert.match(setupServer, /PRODUCT_COST_PAGE_SIZE = 25/);
});

test("Product-cost SQL provides summary, pagination, search, and exact count", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260727120000_add_product_cost_setup_aggregation.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /get_product_cost_coverage_summary/);
  assert.match(migration, /actual_line_count bigint/);
  assert.match(migration, /estimated_line_count bigint/);
  assert.match(migration, /missing_line_count bigint/);
  assert.match(migration, /affected_product_count bigint/);
  assert.match(migration, /remaining_quantity > 0/);
  assert.match(migration, /get_missing_product_costs_page/);
  assert.match(migration, /ILIKE '%' \|\| TRIM\(p_search\) \|\| '%'/);
  assert.match(migration, /COUNT\(\*\) OVER \(\) AS total_count/);
  assert.match(migration, /ORDER BY grouped_line\.sales_affected DESC/);
  assert.match(migration, /LIMIT LEAST\(GREATEST\(p_limit, 1\), 25\)/);
  assert.match(migration, /OFFSET GREATEST\(p_offset, 0\)/);
});

test("Product-cost aggregation RPCs are service-role-only", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260727120000_add_product_cost_setup_aggregation.sql",
      import.meta.url,
    ),
    "utf8",
  );

  for (const signature of [
    "get_product_cost_coverage_summary\\(text\\)",
    "get_missing_product_costs_page\\([\\s\\S]*?text,[\\s\\S]*?text,[\\s\\S]*?integer,[\\s\\S]*?integer[\\s\\S]*?\\)",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO service_role`,
      ),
    );
  }
});

test("relative Product-cost update timestamps are merchant-friendly", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  assert.equal(
    formatRelativeUpdatedAt("2026-07-27T11:59:40.000Z", now),
    "Updated just now",
  );
  assert.equal(
    formatRelativeUpdatedAt("2026-07-27T11:55:00.000Z", now),
    "Updated 5 minutes ago",
  );
  assert.equal(
    formatRelativeUpdatedAt("2026-07-26T11:59:00.000Z", now),
    "Updated yesterday",
  );
});

test("Product-cost controls use selection cards and hide preview in Shopify-only mode", () => {
  const component = readFileSync(
    new URL("../app/components/setup/ProductCostsSetup.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /className="shopops-selectable-grid"/);
  assert.match(component, /<SelectableCard/);
  assert.match(component, /title: "Shopify costs only"/);
  assert.match(component, /title: "Estimate missing costs"/);
  const settingsCard = component.slice(
    component.indexOf('<ContentCard title="How to handle missing costs">'),
    component.indexOf("</ContentCard>", component.indexOf("<FormActions")),
  );
  assert.match(settingsCard, /\{enabled \? \([\s\S]*?Estimated impact preview/);
  assert.match(settingsCard, /className="product-cost-preview-grid"/);
  assert.match(component, /fontVariantNumeric: "tabular-nums"/);
  assert.match(settingsCard, /<FormActions/);
  for (const label of [
    "Affected sales lines",
    "Estimated COGS",
    "Estimated profit",
  ]) {
    assert.match(settingsCard, new RegExp(label));
  }
  assert.match(component, /!settingsChanged/);
  assert.match(
    component,
    /Profit remains unavailable while relevant product costs are/,
  );
});

test("missing-product table uses a bounded fetcher with pagination", () => {
  const component = readFileSync(
    new URL("../app/components/setup/ProductCostsSetup.tsx", import.meta.url),
    "utf8",
  );
  const resourceRoute = readFileSync(
    new URL(
      "../app/routes/app.admin.setup.missing-products.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(component, /useFetcher<MissingProductCostsPageData>/);
  assert.match(component, /Search product or variant/);
  assert.match(component, /Showing \$\{formatNumber\(showingStart\)\}/);
  assert.match(component, />\s*Previous\s*</);
  assert.match(component, />\s*Next\s*</);
  assert.match(component, /position: "sticky"/);
  assert.match(resourceRoute, /capability: "manage_costs"/);
  assert.match(resourceRoute, /loadMissingProductCostsPage/);
});

test("dashboard notices live only in their relevant profit KPI cards", () => {
  const dashboardCards = readFileSync(
    new URL("../app/components/dashboard/KpiCards.tsx", import.meta.url),
    "utf8",
  );
  const grossProfitStart = dashboardCards.indexOf("const grossProfitDetail =");
  const netProfitStart = dashboardCards.indexOf("const netProfitDetail =");
  const detailsStart = dashboardCards.indexOf("const details:", netProfitStart);
  const grossProfitSection = dashboardCards.slice(
    grossProfitStart,
    netProfitStart,
  );
  const netProfitSection = dashboardCards.slice(netProfitStart, detailsStart);
  const detailsSection = dashboardCards.slice(
    detailsStart,
    dashboardCards.indexOf("const items =", detailsStart),
  );

  assert.ok(grossProfitStart >= 0 && netProfitStart > grossProfitStart);
  assert.match(dashboardCards, /sales[\s\S]*?missing[\s\n]+product costs\./);
  assert.equal(
    dashboardCards.match(/Includes estimated product costs/g)?.length,
    1,
  );
  assert.match(grossProfitSection, /Review product costs/);
  assert.match(netProfitSection, /No operating expenses configured\./);
  assert.match(netProfitSection, /Add expenses/);
  assert.match(detailsSection, /grossProfit: grossProfitDetail/);
  assert.match(detailsSection, /netProfit: netProfitDetail/);
  assert.doesNotMatch(
    detailsSection,
    /grossMargin:[\s\S]*?Review product costs/,
  );
});

test("old expense route redirects to Costs operating expenses with context", () => {
  const oldExpenseRoute = readFileSync(
    new URL("../app/routes/app.admin.expenses.tsx", import.meta.url),
    "utf8",
  );

  assert.match(oldExpenseRoute, /new URLSearchParams\(url\.searchParams\)/);
  assert.match(oldExpenseRoute, /searchParams\.set\("tab", "expenses"\)/);
  assert.match(
    oldExpenseRoute,
    /redirect\(`\/app\/costs\?\$\{searchParams\.toString\(\)\}`\)/,
  );
});

function expense(overrides = {}) {
  return {
    expense_name: "Rent",
    expense_category: "Rent",
    monthly_amount: 1000,
    shopify_location_id: null,
    location_name: null,
    start_month: "2026-01-01",
    end_month: null,
    is_active: true,
    ...overrides,
  };
}

function allocate(expenses, activeLocationIds, startDate, endDate) {
  return allocateExpensesByLocation({
    expenses,
    activeLocationIds,
    startDate,
    endDate,
  });
}

test("1000 global expense reconciles exactly across one, two, and three locations", () => {
  for (const locationIds of [
    ["location-a"],
    ["location-a", "location-b"],
    ["location-a", "location-b", "location-c"],
  ]) {
    const allocation = allocate(
      [expense()],
      locationIds,
      "2026-07-01",
      "2026-07-31",
    );
    const total = Array.from(allocation.values()).reduce(
      (sum, amount) => sum + amount,
      0,
    );

    assert.equal(total, 1000);
  }

  assert.deepEqual(
    Array.from(
      allocate(
        [expense()],
        ["location-a", "location-b", "location-c"],
        "2026-07-01",
        "2026-07-31",
      ).values(),
    ),
    [333.34, 333.33, 333.33],
  );
});

test("global expense full-month totals reconcile for 28, 30, and 31-day months", () => {
  for (const [startDate, endDate] of [
    ["2026-02-01", "2026-02-28"],
    ["2026-04-01", "2026-04-30"],
    ["2026-07-01", "2026-07-31"],
  ]) {
    const allocation = allocate(
      [expense()],
      ["location-a", "location-b", "location-c"],
      startDate,
      endDate,
    );

    assert.equal(
      Array.from(allocation.values()).reduce((sum, amount) => sum + amount, 0),
      1000,
    );
  }
});

test("partial-month expenses are prorated by deterministic calendar-day cents", () => {
  const partial = allocate(
    [expense()],
    ["location-a", "location-b", "location-c"],
    "2026-07-01",
    "2026-07-15",
  );

  assert.deepEqual(Array.from(partial.values()), [161.29, 161.29, 161.29]);
});

test("Profit Dashboard and Location Performance use the same expense share", () => {
  const locationIds = ["location-a", "location-b", "location-c"];
  const locationReport = allocate(
    [expense()],
    locationIds,
    "2026-07-01",
    "2026-07-31",
  );
  const dashboard = allocate(
    [expense()],
    locationIds,
    "2026-07-01",
    "2026-07-31",
  ).get("location-b");

  assert.equal(dashboard, locationReport.get("location-b"));
});

test("Staff access does not change the global expense allocation divisor", () => {
  const allActiveLocationIds = ["location-a", "location-b", "location-c"];
  const staffVisibleShare = allocate(
    [expense()],
    allActiveLocationIds,
    "2026-07-01",
    "2026-07-31",
  ).get("location-b");

  assert.equal(staffVisibleShare, 333.33);
  assert.notEqual(staffVisibleShare, 1000);
});

test("location-specific expense remains fully assigned to its location", () => {
  const allocation = allocate(
    [expense({ shopify_location_id: "location-b" })],
    ["location-a", "location-b", "location-c"],
    "2026-07-01",
    "2026-07-31",
  );

  assert.deepEqual(Array.from(allocation.values()), [0, 1000, 0]);
});

test("bounded dashboard pagination includes rows beyond the PostgREST page limit", async () => {
  const sourceRows = Array.from({ length: 2_105 }, (_, index) => ({
    id: String(index + 1).padStart(5, "0"),
    amount: 1,
  }));
  const requestedRanges = [];
  const rows = await fetchAllSupabasePages({
    pageSize: 1000,
    label: "Test financial rows",
    getRowKey: (row) => row.id,
    async fetchPage(from, to) {
      requestedRanges.push([from, to]);
      return {
        data: sourceRows.slice(from, to + 1),
        error: null,
      };
    },
  });

  assert.equal(
    rows.reduce((total, row) => total + row.amount, 0),
    2_105,
  );
  assert.deepEqual(requestedRanges, [
    [0, 999],
    [1000, 1999],
    [2000, 2999],
  ]);
});

test("pagination rejects duplicate stable keys instead of double-counting", async () => {
  await assert.rejects(
    fetchAllSupabasePages({
      pageSize: 2,
      label: "Test deterministic rows",
      getRowKey: (row) => row.id,
      async fetchPage(from) {
        return {
          data: from === 0 ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }],
          error: null,
        };
      },
    }),
    /duplicate stable row key/,
  );
});

test("a failed later page never returns partial dashboard totals", async () => {
  let completed = false;

  await assert.rejects(
    fetchAllSupabasePages({
      pageSize: 2,
      label: "Test failing rows",
      getRowKey: (row) => row.id,
      async fetchPage(from) {
        if (from === 0) {
          return { data: [{ id: "a" }, { id: "b" }], error: null };
        }
        return { data: null, error: { message: "temporary failure" } };
      },
    }).then(() => {
      completed = true;
    }),
    /page 2 could not be loaded/,
  );

  assert.equal(completed, false);
});

test("Dashboard financial and Staff inputs use paged stable reads", () => {
  const dashboard = readFileSync(
    new URL("../app/routes/app.db-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const staffResolution = readFileSync(
    new URL(
      "../app/lib/staff-identity/staff-identity.server.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(dashboard, /fetchAllSupabasePages/);
  assert.match(
    dashboard,
    /order\("created_at_shopify",[\s\S]*?order\("id",[\s\S]*?range\(from, to\)/,
  );
  for (const table of [
    "order_lines",
    "order_transactions",
    "inventory_levels",
    "variants",
    "products",
    "fixed_expenses",
  ]) {
    assert.match(dashboard, new RegExp(`from\\("${table}"\\)`));
  }
  assert.match(staffResolution, /fetchAllSupabasePages/);
  assert.match(staffResolution, /order\("id"[\s\S]*?range\(from, to\)/);
});

test("operational webhook queue insert and duplicate both return success", async () => {
  const request = new Request("https://example.com/webhooks/orders/create", {
    method: "POST",
  });
  const logs = [];
  const logger = {
    log(...args) {
      logs.push(args);
    },
    error() {
      assert.fail("successful webhook handling must not log an error");
    },
  };

  const inserted = await respondToOperationalWebhook({
    request,
    payload: { id: 1 },
    shop,
    topic: "orders/create",
    enqueue: async () => ({ skipped: false }),
    logger,
  });
  const duplicate = await respondToOperationalWebhook({
    request,
    payload: { id: 1 },
    shop,
    topic: "orders/create",
    enqueue: async () => ({ skipped: true }),
    logger,
  });

  assert.equal(inserted.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(logs.length, 2);
});

test("transient operational webhook queue failure returns retryable non-2xx", async () => {
  const errorLogs = [];
  const response = await respondToOperationalWebhook({
    request: new Request("https://example.com/webhooks/products/update", {
      method: "POST",
    }),
    payload: { secret: "must-not-be-logged" },
    shop,
    topic: "products/update",
    enqueue: async () => {
      throw new Error("database temporarily unavailable");
    },
    logger: {
      log() {},
      error(...args) {
        errorLogs.push(args);
      },
    },
  });

  assert.equal(response.status, 503);
  assert.equal(errorLogs.length, 1);
  assert.equal(JSON.stringify(errorLogs).includes("must-not-be-logged"), false);
});

test("webhook retry followed by duplicate acknowledgment processes exactly once", async () => {
  let firstAttempt = true;
  let durableInsertCount = 0;
  let eventExists = false;
  const enqueue = async () => {
    if (firstAttempt) {
      firstAttempt = false;
      throw new Error("transient queue failure");
    }
    if (eventExists) return { skipped: true };
    eventExists = true;
    durableInsertCount += 1;
    return { skipped: false };
  };
  const input = {
    request: new Request("https://example.com/webhooks/orders/updated", {
      method: "POST",
    }),
    payload: { id: 2 },
    shop,
    topic: "orders/updated",
    enqueue,
    logger: { log() {}, error() {} },
  };

  assert.equal((await respondToOperationalWebhook(input)).status, 503);
  assert.equal((await respondToOperationalWebhook(input)).status, 200);
  assert.equal((await respondToOperationalWebhook(input)).status, 200);
  assert.equal(durableInsertCount, 1);
});

test("shop redaction inventory covers every current merchant-scoped table", () => {
  assert.deepEqual(SHOP_REDACTION_TABLES, [
    "webhook_events",
    "sync_jobs",
    "sync_runs",
    "order_transactions",
    "fixed_expenses",
    "user_location_access",
    "dashboard_memberships",
    "staff_identity_aliases",
    "staff_people",
    "order_lines",
    "orders",
    "inventory_levels",
    "inventory_items",
    "variants",
    "products",
    "locations",
    "staff_members",
    "sync_automation_state",
    "pos_attribution_setup",
    "shops",
  ]);
  assert.equal(
    SHOP_REDACTION_TABLES.includes("compliance_webhook_events"),
    false,
  );
});

test("shop redaction deletes all table rows and Prisma sessions idempotently", async () => {
  const deletedTables = [];
  const sessionCalls = [];
  const supabase = {
    from(table) {
      return {
        select() {
          return {
            async eq() {
              return { count: 0, error: null };
            },
          };
        },
        delete() {
          return {
            async eq() {
              deletedTables.push(table);
              return { error: null };
            },
          };
        },
      };
    },
  };
  const sessionStore = {
    session: {
      async deleteMany(args) {
        sessionCalls.push(args);
        return { count: 0 };
      },
    },
  };

  await deleteShopScopedSupabaseData({ supabase, shop, sessionStore });
  await deleteShopScopedSupabaseData({ supabase, shop, sessionStore });

  assert.deepEqual(deletedTables, [
    ...SHOP_REDACTION_TABLES,
    ...SHOP_REDACTION_TABLES,
  ]);
  assert.deepEqual(sessionCalls, [{ where: { shop } }, { where: { shop } }]);
});

test("expense month validation rejects an end month before the start month", () => {
  assert.deepEqual(
    validateExpenseMonthRange({
      startMonth: "2026-07",
      endMonth: "2026-06",
    }),
    {
      end_month: "End month cannot be earlier than start month.",
    },
  );
  assert.deepEqual(
    validateExpenseMonthRange({
      startMonth: "2026-07",
      endMonth: "2026-07",
    }),
    {},
  );
});

test("expense location validation fails before any expense write and deletion confirms impact", () => {
  const setupRoute = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );
  const invalidLocationReturn = setupRoute.indexOf(
    "Select a location that belongs to this Shopify store.",
  );
  const expensePayload = setupRoute.indexOf("const payload = {");

  assert.match(
    setupRoute,
    /\.eq\("shop_domain", session\.shop\)[\s\S]*?\.eq\("shopify_location_id", shopifyLocationId\)/,
  );
  assert.ok(invalidLocationReturn >= 0);
  assert.ok(invalidLocationReturn < expensePayload);
  assert.match(
    setupRoute,
    /Delete “\$\{expense\.expense_name\}”\? Reporting will update to remove this expense\./,
  );
  assert.match(setupRoute, /event\.preventDefault\(\)/);
});

function recentLine(overrides = {}) {
  return {
    quantity: 2,
    gross_sales: 100,
    discounts: 0,
    returns: 0,
    returned_quantity: 0,
    refunded_amount: 0,
    ...overrides,
  };
}

test("recent order badges use exact refund and return precedence", () => {
  assert.deepEqual(
    getRecentOrderChips(
      recentLine({
        discounts: 10,
        refunded_amount: 25,
        returned_quantity: 1,
      }),
    ),
    ["Discounted", "Partial return", "Partial refund"],
  );
  assert.deepEqual(
    getRecentOrderChips(
      recentLine({ refunded_amount: 100, returned_quantity: 2 }),
    ),
    ["Returned", "Refunded"],
  );
  assert.deepEqual(getRecentOrderChips(recentLine({ returns: 25 })), [
    "Return",
  ]);
  assert.deepEqual(
    getRecentOrderChips(recentLine({ gross_sales: 0, refunded_amount: 25 })),
    ["Refund"],
  );
});

test("Location financial summary exposes completeness and expense setup states once", () => {
  const locationRoute = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );

  const presentation = readFileSync(
    new URL("../app/lib/dashboard/kpi-presentation.ts", import.meta.url),
    "utf8",
  );

  assert.match(locationRoute, /buildSharedReportKpiItems/);
  assert.match(locationRoute, /buildLocationOnlyReportKpiItems/);
  for (const label of [
    "Net Sales",
    "COGS",
    "Gross profit",
    "Gross margin",
    "Expenses",
    "Net profit",
  ]) {
    assert.match(presentation, new RegExp(`"${label}"`));
  }
  assert.equal(
    locationRoute.match(/Includes estimated product costs/g)?.length,
    1,
  );
  assert.match(locationRoute, /missing[\s\n]+product costs\./);
  assert.match(locationRoute, /No operating expenses configured\./);
  assert.match(locationRoute, /Add expenses/);
  assert.match(locationRoute, /expensesSearch\.set\("tab", "expenses"\)/);
});

test("Dashboard and Location filters expose pending labels and disable repeat submits", () => {
  const dashboardFilters = readFileSync(
    new URL(
      "../app/components/dashboard/DashboardFilters.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const locations = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );

  for (const source of [dashboardFilters, locations]) {
    assert.match(source, /useNavigation/);
    assert.match(source, /Applying\.\.\./);
    assert.match(source, /disabled=\{isApplying/);
  }
});

test("Marketplace Shopify App Pricing identity is canonical", () => {
  const marketplaceConfig = readFileSync(
    new URL("../shopify.app.shopops-marketplace.toml", import.meta.url),
    "utf8",
  );
  const billing = readFileSync(
    new URL("../app/lib/billing.server.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    marketplaceConfig,
    /^client_id = "751df93cb283cb05edc5b46b35de06be"$/m,
  );
  assert.match(marketplaceConfig, /^name = "ShopOps Studio"$/m);
  assert.match(marketplaceConfig, /^handle = "shopops-studio"$/m);
  assert.match(billing, /BILLING_ENABLED/);
  assert.match(billing, /EXPECTED_PARTNER_API_VERSION = "2026-07"/);
  assert.equal(EXPECTED_SHOPIFY_APP_HANDLE, "shopops-studio");
  assert.doesNotMatch(billing, /SHOPIFY_APP_ENVIRONMENT/);
  assert.doesNotMatch(billing, /BILLING_TEST_SHOPS/);
  assert.deepEqual(Object.keys(PLAN_DEFINITIONS), [
    "solo",
    "growth",
    "multi-location",
    "qa-pilot",
  ]);
  assert.deepEqual(PLAN_DEFINITIONS.solo, {
    displayName: "Solo",
    activeLocations: 1,
    dashboardUsers: 1,
  });
  assert.deepEqual(PLAN_DEFINITIONS.growth, {
    displayName: "Growth",
    activeLocations: 5,
    dashboardUsers: 5,
  });
  assert.deepEqual(PLAN_DEFINITIONS["multi-location"], {
    displayName: "Multi-location",
    activeLocations: 10,
    dashboardUsers: null,
  });
  assert.deepEqual(PLAN_DEFINITIONS["qa-pilot"], {
    displayName: "QA Pilot",
    activeLocations: null,
    dashboardUsers: null,
  });
  assert.deepEqual(PUBLIC_PLAN_HANDLES, ["solo", "growth", "multi-location"]);
  assert.deepEqual(PRIVATE_PLAN_HANDLES, ["qa-pilot"]);
});

test("billing-disabled mode is local-only and requires no Partner lookup", async () => {
  let adminCalls = 0;
  let partnerCalls = 0;
  const environment = getBillingEnvironment({
    BILLING_ENABLED: "false",
    NODE_ENV: "development",
  });
  const admin = billingAdmin("gid://shopify/Shop/disabled", () => {
    adminCalls += 1;
  });
  const fetchImpl = async () => {
    partnerCalls += 1;
    throw new Error("Partner API must not be called");
  };

  const state = await getBillingState({
    admin,
    shop: "billing-disabled.myshopify.com",
    environment,
    fetchImpl,
  });
  const access = await requireBillingAccess({
    admin,
    shop: "billing-disabled.myshopify.com",
    environment,
    fetchImpl,
  });
  assert.deepEqual(state, { state: "disabled", billingEnabled: false });
  assert.equal(access.access, "allowed");
  assert.equal(adminCalls, 0);
  assert.equal(partnerCalls, 0);
});

test("production fails closed when billing is missing or disabled", async () => {
  assert.throws(
    () =>
      getBillingEnvironment({
        BILLING_ENABLED: "false",
        NODE_ENV: "production",
      }),
    /BILLING_ENABLED must be true in production/,
  );
  assert.throws(
    () => getBillingEnvironment({ NODE_ENV: "production" }),
    /BILLING_ENABLED must be true in production/,
  );

  let adminCalls = 0;
  let partnerCalls = 0;
  const args = {
    admin: billingAdmin("gid://shopify/Shop/production-disabled", () => {
      adminCalls += 1;
    }),
    shop: "production-disabled.myshopify.com",
    environmentSource: {
      BILLING_ENABLED: "false",
      NODE_ENV: "production",
    },
    fetchImpl: async () => {
      partnerCalls += 1;
      throw new Error("Partner API must not be called for invalid config");
    },
  };
  const state = await getBillingState(args);
  const access = await requireBillingAccess(args);

  assert.deepEqual(state, {
    state: "billing_unavailable",
    billingEnabled: true,
    reason: "configuration",
  });
  assert.equal(access.access, "billing_unavailable");
  assert.equal(adminCalls, 0);
  assert.equal(partnerCalls, 0);
});

test("billing environment validates enabled Partner API settings server-side", () => {
  assert.throws(
    () => getBillingEnvironment({ BILLING_ENABLED: "true" }),
    /SHOPIFY_PARTNER_ORG_ID/,
  );
  assert.deepEqual(
    getBillingEnvironment({
      BILLING_ENABLED: "true",
      SHOPIFY_PARTNER_ORG_ID: "123456",
      SHOPIFY_PARTNER_ACCESS_TOKEN: "secret",
      SHOPIFY_PARTNER_APP_GID: "gid://shopify/App/123456",
      SHOPIFY_PARTNER_API_VERSION: "2026-07",
      SHOPIFY_APP_HANDLE: "shopops-studio",
    }),
    {
      enabled: true,
      organizationId: "123456",
      accessToken: "secret",
      appGid: "gid://shopify/App/123456",
      apiVersion: "2026-07",
      appHandle: "shopops-studio",
    },
  );

  const common = {
    BILLING_ENABLED: "true",
    SHOPIFY_PARTNER_ORG_ID: "123456",
    SHOPIFY_PARTNER_ACCESS_TOKEN: "secret",
    SHOPIFY_PARTNER_APP_GID: "gid://shopify/App/123456",
    SHOPIFY_PARTNER_API_VERSION: "2026-07",
  };
  assert.throws(
    () =>
      getBillingEnvironment({
        ...common,
        SHOPIFY_APP_HANDLE: "wrong-handle",
      }),
    /SHOPIFY_APP_HANDLE must be shopops-studio/,
  );
});

test("hosted pricing URL uses the validated canonical Marketplace registration", () => {
  assert.equal(
    buildHostedPricingUrl({
      shop: "example-store.myshopify.com",
      environment: enabledBillingEnvironment,
    }),
    "https://admin.shopify.com/store/example-store/charges/shopops-studio/pricing_plans",
  );
  assert.throws(
    () =>
      buildHostedPricingUrl({
        shop: "example.com",
        environment: enabledBillingEnvironment,
      }),
    /canonical myshopify\.com domain/,
  );
  assert.throws(
    () =>
      buildHostedPricingUrl({
        shop: "example-store.myshopify.com",
        environment: {
          ...enabledBillingEnvironment,
          appHandle: "wrong-handle",
        },
      }),
    /configured Shopify app identity is invalid/,
  );
});

test("subscription item handles resolve only exact configured plans", () => {
  for (const handle of ["solo", "growth", "multi-location", "qa-pilot"]) {
    assert.equal(resolveCurrentPlan([{ handle }]), handle);
  }
  assert.equal(resolveCurrentPlan([{ handle: "unknown" }]), null);
  assert.equal(resolveCurrentPlan([{ handle: "toString" }]), null);
  assert.equal(resolveCurrentPlan([]), null);
  assert.equal(
    resolveCurrentPlan([{ handle: "solo" }, { handle: "growth" }]),
    null,
  );
});

test("Partner activeSubscription resolves all plans, trials, cancellation, and pending changes", async () => {
  const cases = [
    { handle: "solo", expectedState: "active" },
    { handle: "growth", expectedState: "active" },
    { handle: "multi-location", expectedState: "active" },
    { handle: "qa-pilot", expectedState: "active" },
    {
      handle: "growth",
      expectedState: "trial",
      trialEndsAt: "2026-08-15T00:00:00.000Z",
      currentBillingCycle: null,
    },
    {
      handle: "growth",
      expectedState: "canceling",
      cancelAtEndOfCycle: true,
      pendingHandle: "solo",
    },
  ];

  for (const [index, billingCase] of cases.entries()) {
    const shopDomain = `billing-state-${index}.myshopify.com`;
    const payload = activeSubscriptionPayload({
      shopDomain,
      ...billingCase,
    });
    const state = await getBillingState({
      admin: billingAdmin(),
      shop: shopDomain,
      environment: enabledBillingEnvironment,
      fetchImpl: subscriptionFetch(payload),
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      bypassCache: true,
    });

    assert.equal(state.state, billingCase.expectedState);
    assert.equal(state.planHandle, billingCase.handle);
    if (billingCase.pendingHandle) {
      assert.equal(state.pendingPlanHandle, billingCase.pendingHandle);
    }
  }
});

test("missing, unsupported, malformed, and unavailable Partner responses remain distinct", async () => {
  const fixtures = [
    {
      name: "missing",
      payload: { data: { activeSubscription: null } },
      expectedState: "missing_subscription",
    },
    {
      name: "unsupported",
      payload: activeSubscriptionPayload({
        shopDomain: "billing-unsupported.myshopify.com",
        handle: "legacy-plan",
      }),
      expectedState: "unsupported_plan",
    },
    {
      name: "malformed",
      payload: { data: { activeSubscription: { items: [] } } },
      expectedState: "billing_unavailable",
      expectedReason: "malformed_response",
    },
  ];

  for (const fixture of fixtures) {
    const shopDomain = `billing-${fixture.name}.myshopify.com`;
    const state = await getBillingState({
      admin: billingAdmin(),
      shop: shopDomain,
      environment: enabledBillingEnvironment,
      fetchImpl: subscriptionFetch(fixture.payload),
      bypassCache: true,
    });
    assert.equal(state.state, fixture.expectedState);
    if (fixture.expectedReason)
      assert.equal(state.reason, fixture.expectedReason);
  }

  const unavailable = await getBillingState({
    admin: billingAdmin(),
    shop: "billing-partner-down.myshopify.com",
    environment: enabledBillingEnvironment,
    fetchImpl: async () => new Response("service unavailable", { status: 503 }),
    bypassCache: true,
  });
  assert.deepEqual(unavailable, {
    state: "billing_unavailable",
    billingEnabled: true,
    reason: "http",
  });
  assert.notEqual(unavailable.state, "missing_subscription");
});

test("missing and unsupported subscriptions are gated while temporary failures stay retryable", async () => {
  for (const fixture of [
    {
      shop: "billing-gated-missing.myshopify.com",
      payload: { data: { activeSubscription: null } },
    },
    {
      shop: "billing-gated-unsupported.myshopify.com",
      payload: activeSubscriptionPayload({
        shopDomain: "billing-gated-unsupported.myshopify.com",
        handle: "inactive-or-legacy",
      }),
    },
  ]) {
    const result = await requireBillingAccess({
      admin: billingAdmin(),
      shop: fixture.shop,
      environment: enabledBillingEnvironment,
      fetchImpl: subscriptionFetch(fixture.payload),
      bypassCache: true,
    });
    assert.equal(result.access, "billing_required");
  }

  const unavailable = await requireBillingAccess({
    admin: billingAdmin(),
    shop: "billing-gated-unavailable.myshopify.com",
    environment: enabledBillingEnvironment,
    fetchImpl: async () => new Response("service unavailable", { status: 503 }),
    bypassCache: true,
  });
  assert.equal(unavailable.access, "billing_unavailable");
});

test("Partner API timeout, throttling, authentication, and GraphQL failures are controlled unavailable states", async () => {
  const common = {
    environment: enabledBillingEnvironment,
    shop: "billing-errors.myshopify.com",
    shopGid: "gid://shopify/Shop/123456",
  };
  const throttled = await getActiveSubscription({
    ...common,
    fetchImpl: async () => Response.json({}, { status: 429 }),
  });
  const authentication = await getActiveSubscription({
    ...common,
    fetchImpl: async () => Response.json({}, { status: 401 }),
  });
  const graphql = await getActiveSubscription({
    ...common,
    fetchImpl: async () =>
      Response.json({ errors: [{ message: "temporary failure" }] }),
  });
  const timeout = await getActiveSubscription({
    ...common,
    timeoutMs: 1,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
  });

  assert.deepEqual(throttled, {
    kind: "unavailable",
    reason: "throttled",
  });
  assert.deepEqual(authentication, {
    kind: "unavailable",
    reason: "authentication",
  });
  assert.deepEqual(graphql, { kind: "unavailable", reason: "graphql" });
  assert.deepEqual(timeout, { kind: "unavailable", reason: "timeout" });
});

test("Partner request uses versioned endpoint, app/shop variables, and server token header", async () => {
  const shopDomain = "billing-request.myshopify.com";
  let request;
  const state = await getBillingState({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl: subscriptionFetch(
      activeSubscriptionPayload({ shopDomain }),
      (value) => {
        request = value;
      },
    ),
    bypassCache: true,
  });

  assert.equal(state.state, "active");
  assert.equal(
    request.url,
    "https://partners.shopify.com/123456/api/2026-07/graphql.json",
  );
  assert.equal(
    request.init.headers["X-Shopify-Access-Token"],
    "partner-test-token",
  );
  assert.deepEqual(JSON.parse(request.init.body).variables, {
    appId: "gid://shopify/App/123456",
    shopId: "gid://shopify/Shop/123456",
  });
});

test("billing cache reuses reads and explicit refresh paths bypass it", async () => {
  const shopDomain = "billing-cache.myshopify.com";
  let partnerCalls = 0;
  const fetchImpl = subscriptionFetch(
    activeSubscriptionPayload({ shopDomain }),
    () => {
      partnerCalls += 1;
    },
  );
  clearBillingCache(shopDomain);

  await getBillingState({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
  });
  await getBillingState({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
  });
  await getBillingState({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
    bypassCache: true,
  });

  assert.equal(partnerCalls, 2);
});

test("Shopify refresh replaces a disagreeing cached paid plan", async () => {
  const shopDomain = "billing-cache-disagreement.myshopify.com";
  let partnerCalls = 0;
  let payload = activeSubscriptionPayload({
    shopDomain,
    handle: "growth",
  });
  const fetchImpl = subscriptionFetch(payload, () => {
    partnerCalls += 1;
  });
  clearBillingCache(shopDomain);

  const cachedPaidPlan = await getBillingState({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
  });
  assert.equal(cachedPaidPlan.state, "active");
  assert.equal(cachedPaidPlan.planHandle, "growth");

  payload.data.activeSubscription = null;
  const refreshed = await refreshBillingState({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
  });
  const access = await requireBillingAccess({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
  });

  assert.equal(refreshed.state, "missing_subscription");
  assert.equal(access.access, "billing_required");
  assert.equal(partnerCalls, 2);
});

test("uninstall cache invalidation makes reinstall without a subscription gated", async () => {
  const shopDomain = "billing-reinstall.myshopify.com";
  let payload = activeSubscriptionPayload({ shopDomain, handle: "solo" });
  const fetchImpl = subscriptionFetch(payload);
  clearBillingCache(shopDomain);

  const installed = await getBillingState({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
  });
  assert.equal(installed.state, "active");

  clearBillingCache(shopDomain);
  payload.data.activeSubscription = null;
  const reinstalled = await requireBillingAccess({
    admin: billingAdmin(),
    shop: shopDomain,
    environment: enabledBillingEnvironment,
    fetchImpl,
  });
  assert.equal(reinstalled.access, "billing_required");

  const uninstallRoute = readFileSync(
    new URL("../app/routes/webhooks.app.uninstalled.tsx", import.meta.url),
    "utf8",
  );
  assert.match(uninstallRoute, /clearBillingCache\(shop\)/);
});

test("billing callback matching rejects forged and mismatched plan handles", () => {
  const active = {
    state: "active",
    billingEnabled: true,
    planHandle: "solo",
    plan: PLAN_DEFINITIONS.solo,
    billingPeriod: "EVERY_30_DAYS",
    cancelAtEndOfCycle: false,
    trialEndsAt: null,
    currentBillingCycle: {
      startTime: "2026-07-01T00:00:00.000Z",
      endTime: "2026-08-01T00:00:00.000Z",
    },
    pendingPlanHandle: null,
    pendingPlan: null,
  };

  assert.equal(
    verifyBillingCallbackPlan({
      billing: active,
      returnedPlanHandle: "solo",
    }),
    true,
  );
  assert.equal(
    verifyBillingCallbackPlan({
      billing: active,
      returnedPlanHandle: "multi-location",
    }),
    false,
  );
  assert.equal(
    verifyBillingCallbackPlan({
      billing: { state: "missing_subscription", billingEnabled: true },
      returnedPlanHandle: "solo",
    }),
    false,
  );
  assert.equal(
    verifyBillingCallbackPlan({
      billing: active,
      returnedPlanHandle: "qa-pilot",
    }),
    false,
  );
  assert.equal(
    verifyBillingCallbackPlan({
      billing: active,
      returnedPlanHandle: "malformed",
    }),
    false,
  );
  assert.equal(
    verifyBillingCallbackPlan({
      billing: active,
      returnedPlanHandle: "solo",
    }),
    true,
    "a replay is idempotent because verification only compares the refreshed state",
  );
});

function membership(id, role, overrides = {}) {
  return {
    id,
    personId: id,
    displayName: id,
    userEmail: `${id}@example.com`,
    role,
    status: "active",
    isOwner: role === "owner",
    ...overrides,
  };
}

function reportingLocation(id, overrides = {}) {
  return {
    id,
    shopifyLocationId: id,
    name: id,
    shopifyIsActive: true,
    reportingEnabled: true,
    ...overrides,
  };
}

test("ShopOps access normalizes merchant email and requires verified Shopify email for initial linking", () => {
  assert.equal(
    normalizeShopOpsEmail("  Viewer@Example.COM "),
    "viewer@example.com",
  );
  assert.equal(isValidShopOpsEmail("viewer@example.com"), true);
  assert.equal(isValidShopOpsEmail("not-an-email"), false);

  const verified = getCurrentShopifyUserIdentity({
    session: {
      shop,
      onlineAccessInfo: {
        associated_user: {
          id: 7788,
          email: " Viewer@Example.COM ",
          email_verified: true,
          first_name: "Shop",
          last_name: "Viewer",
          account_owner: false,
        },
      },
    },
  });
  const unverified = getCurrentShopifyUserIdentity({
    session: {
      shop,
      onlineAccessInfo: {
        associated_user: {
          id: 8899,
          email: "viewer@example.com",
          email_verified: false,
          account_owner: false,
        },
      },
    },
  });
  const missingEmail = getCurrentShopifyUserIdentity({
    session: {
      shop,
      onlineAccessInfo: {
        associated_user: {
          id: 9900,
          email_verified: true,
          account_owner: false,
        },
      },
    },
  });

  assert.equal(verified.email, "viewer@example.com");
  assert.equal(verified.shopifyUserId, "7788");
  assert.equal(verified.isEmailVerified, true);
  assert.equal(unverified.isEmailVerified, false);
  assert.equal(missingEmail.email, null);
  assert.equal(missingEmail.isEmailVerified, true);
});

test("ShopOps access states distinguish pending, active, revoked, archived, and attention", () => {
  assert.equal(
    getShopOpsAccessState({
      isOwner: false,
      isPersonActive: true,
      membershipStatus: "active",
      shopifyUserId: null,
    }),
    "pending",
  );
  assert.equal(
    getShopOpsAccessState({
      isOwner: false,
      isPersonActive: true,
      membershipStatus: "active",
      shopifyUserId: "7788",
    }),
    "active",
  );
  assert.equal(
    getShopOpsAccessState({
      isOwner: false,
      isPersonActive: true,
      membershipStatus: "disabled",
      shopifyUserId: "7788",
      needsAttention: true,
    }),
    "revoked",
  );
  assert.equal(
    getShopOpsAccessState({
      isOwner: false,
      isPersonActive: false,
      membershipStatus: "disabled",
      shopifyUserId: "7788",
    }),
    "archived",
  );
  assert.equal(
    getShopOpsAccessState({
      isOwner: false,
      isPersonActive: true,
      membershipStatus: null,
      shopifyUserId: null,
    }),
    "needs_attention",
  );

  assert.deepEqual(
    getShopOpsAccessPresentation({
      state: "pending",
      hasApprovedAccess: true,
    }),
    {
      label: "Waiting for first sign-in",
      showConfiguredRole: true,
      tone: "info",
    },
  );
  assert.equal(
    getShopOpsAccessPresentation({
      state: "revoked",
      hasApprovedAccess: false,
    }).showConfiguredRole,
    false,
  );
  assert.equal(
    getShopOpsAccessPresentation({
      state: "archived",
      hasApprovedAccess: false,
    }).label,
    "Archived",
  );
});

test("canonical memberships count every dashboard role exactly once and exclude Staff/POS-only profiles", () => {
  const limits = {
    planHandle: "qa-pilot",
    planName: "QA Pilot",
    activeLocations: null,
    dashboardUsers: null,
  };
  const summary = summarizeEntitlements({
    memberships: [
      membership("owner", "owner"),
      membership("admin", "admin"),
      membership("manager", "manager"),
      membership("viewer", "viewer"),
      membership("disabled", "viewer", { status: "disabled" }),
    ],
    locations: [reportingLocation("a")],
    limits,
  });

  assert.equal(summary.activeDashboardUsers, 4);
  assert.equal(summary.activeReportingLocations, 1);
  assert.equal(summary.resolutionRequired, false);
  assert.equal([{ id: "pos-only" }, { id: "staff-only" }].length, 2);
});

test("Solo owner consumes its only seat and explicit location selection resolves access", () => {
  const limits = {
    planHandle: "solo",
    planName: "Solo",
    activeLocations: 1,
    dashboardUsers: 1,
  };
  const compliant = summarizeEntitlements({
    memberships: [membership("owner", "owner")],
    locations: [
      reportingLocation("selected"),
      reportingLocation("stored", { reportingEnabled: false }),
    ],
    limits,
  });
  assert.equal(compliant.activeDashboardUsers, 1);
  assert.equal(compliant.activeReportingLocations, 1);
  assert.equal(compliant.resolutionRequired, false);

  const extraUser = summarizeEntitlements({
    memberships: [
      membership("owner", "owner"),
      membership("shopify-admin", "admin"),
    ],
    locations: [reportingLocation("selected")],
    limits,
  });
  assert.equal(extraUser.userLimitExceeded, true);
  assert.equal(extraUser.resolutionRequired, true);
});

test("verified owner bootstrap reuses matching identities without creating a duplicate", () => {
  const identity = {
    shopifyUserId: "42",
    email: "owner@example.com",
  };

  assert.deepEqual(
    resolveOwnerMaterializationIdentifiers({ identity, memberships: [] }),
    { shopifyUserId: "42", normalizedEmail: "owner@example.com" },
  );

  const existing = membership("existing", "admin", {
    shopifyUserId: "42",
    userEmail: "owner@example.com",
  });
  assert.deepEqual(
    resolveOwnerMaterializationIdentifiers({
      identity,
      memberships: [existing],
    }),
    { shopifyUserId: "42", normalizedEmail: "owner@example.com" },
  );

  const splitIdentity = resolveOwnerMaterializationIdentifiers({
    identity,
    memberships: [
      membership("by-user-id", "admin", { shopifyUserId: "42" }),
      membership("by-email", "viewer", {
        userEmail: "owner@example.com",
      }),
    ],
  });
  assert.deepEqual(splitIdentity, {
    shopifyUserId: "42",
    normalizedEmail: null,
  });
});

test("capacity messaging distinguishes below, exactly at, and above the limit", () => {
  assert.equal(getCapacityState({ usage: 0, limit: 1 }), "available");
  assert.equal(getCapacityState({ usage: 1, limit: 1 }), "at_limit");
  assert.equal(getCapacityState({ usage: 2, limit: 1 }), "over_limit");
  assert.equal(getCapacityState({ usage: 20, limit: null }), "unlimited");
});

test("finite reporting-location limits block over-limit states without changing detected locations", () => {
  for (const { planHandle, limit } of [
    { planHandle: "solo", limit: 1 },
    { planHandle: "growth", limit: 5 },
    { planHandle: "multi-location", limit: 10 },
  ]) {
    const locations = Array.from({ length: limit + 1 }, (_, index) =>
      reportingLocation(`${planHandle}-${index}`),
    );
    const summary = summarizeEntitlements({
      memberships: [membership("owner", "owner")],
      locations,
      limits: {
        planHandle,
        planName: planHandle,
        activeLocations: limit,
        dashboardUsers: null,
      },
    });
    assert.equal(summary.locationLimitExceeded, true);
    assert.equal(locations.length, limit + 1);
  }
});

test("approved dashboard-user limits enforce Growth and leave Multi-location unlimited", () => {
  const growthAtLimit = summarizeEntitlements({
    memberships: Array.from({ length: 5 }, (_, index) =>
      membership(`growth-${index}`, index === 0 ? "owner" : "viewer"),
    ),
    locations: [reportingLocation("growth-location")],
    limits: {
      planHandle: "growth",
      planName: "Growth",
      activeLocations: 5,
      dashboardUsers: 5,
    },
  });
  const growthOverLimit = summarizeEntitlements({
    memberships: [
      ...Array.from({ length: 5 }, (_, index) =>
        membership(`growth-${index}`, index === 0 ? "owner" : "viewer"),
      ),
      membership("growth-extra", "viewer"),
    ],
    locations: [reportingLocation("growth-location")],
    limits: {
      planHandle: "growth",
      planName: "Growth",
      activeLocations: 5,
      dashboardUsers: 5,
    },
  });
  const multiLocation = summarizeEntitlements({
    memberships: Array.from({ length: 25 }, (_, index) =>
      membership(`multi-${index}`, index === 0 ? "owner" : "viewer"),
    ),
    locations: [reportingLocation("multi-location")],
    limits: {
      planHandle: "multi-location",
      planName: "Multi-location",
      activeLocations: 10,
      dashboardUsers: null,
    },
  });

  assert.equal(growthAtLimit.userLimitExceeded, false);
  assert.equal(growthOverLimit.userLimitExceeded, true);
  assert.equal(multiLocation.activeDashboardUsers, 25);
  assert.equal(multiLocation.userLimitExceeded, false);
});

test("billing route safety excludes OAuth, webhooks, charge creation, and client secrets", () => {
  const appRoute = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );
  const callbackRoute = readFileSync(
    new URL("../app/routes/app.billing.complete.tsx", import.meta.url),
    "utf8",
  );
  const billingRequiredRoute = readFileSync(
    new URL("../app/routes/app.billing-required.tsx", import.meta.url),
    "utf8",
  );
  const billingServer = readFileSync(
    new URL("../app/lib/billing.server.ts", import.meta.url),
    "utf8",
  );
  const allBillingSources = [
    appRoute,
    callbackRoute,
    billingRequiredRoute,
    billingServer,
  ].join("\n");

  assert.match(appRoute, /export const middleware/);
  assert.match(appRoute, /isBillingRoutePath/);
  assert.match(appRoute, /isBillingRoute \? \(/);
  assert.match(
    appRoute,
    /if \(isBillingRoutePath\(url\.pathname\)\)[\s\S]*?accessState: "allowed"/,
  );
  assert.match(callbackRoute, /authenticate\.admin\(request\)/);
  assert.match(callbackRoute, /refreshBillingState/);
  assert.match(callbackRoute, /isRecognizedPlanHandle/);
  assert.match(callbackRoute, /if \(!returnedPlanHandle\)/);
  assert.match(callbackRoute, /logBillingCallbackInputRejection/);
  assert.match(callbackRoute, /No matching active subscription was found\./);
  assert.match(callbackRoute, /export function ErrorBoundary/);
  assert.match(callbackRoute, /Plan not confirmed/);
  assert.match(callbackRoute, /Nothing was changed/);
  assert.match(callbackRoute, /buildBillingRecoveryPath/);
  assert.match(callbackRoute, /searchParams\.delete\("plan_handle"\)/);
  assert.doesNotMatch(
    callbackRoute,
    /redirect_uri|return_url|window\.location/,
  );
  assert.doesNotMatch(allBillingSources, /appSubscriptionCreate/);
  assert.doesNotMatch(allBillingSources, /charge_id/);
  assert.doesNotMatch(billingRequiredRoute, /SHOPIFY_PARTNER_ACCESS_TOKEN/);
  assert.doesNotMatch(callbackRoute, /SHOPIFY_PARTNER_ACCESS_TOKEN/);
  assert.doesNotMatch(appRoute, /SHOPIFY_PARTNER_ACCESS_TOKEN/);
});

test("billing UX presents active, trial, canceling, inactive, and unavailable states", () => {
  const plan = readFileSync(
    new URL("../app/components/setup/PlanSetup.tsx", import.meta.url),
    "utf8",
  );
  const billingRequired = readFileSync(
    new URL("../app/routes/app.billing-required.tsx", import.meta.url),
    "utf8",
  );
  const callback = readFileSync(
    new URL("../app/routes/app.billing.complete.tsx", import.meta.url),
    "utf8",
  );

  assert.match(plan, /state: "active" \| "trial" \| "canceling"/);
  assert.match(plan, /\? "Canceling"/);
  assert.match(plan, /\? "Trial"/);
  assert.match(plan, /: "Active"/);
  assert.match(plan, /Trial ends/);
  assert.match(plan, /Cancels at the end of the billing cycle/);
  assert.match(billingRequired, /Choose a plan to continue/);
  assert.match(billingRequired, /An active ShopOps Studio plan is required/);
  assert.match(billingRequired, /Billing temporarily unavailable/);
  assert.match(callback, /Plan confirmation temporarily unavailable/);
  assert.match(callback, /Plan not confirmed/);
});

test("POS merchant modal has automatic attribution state and no diagnostics", () => {
  const modal = readFileSync(
    new URL(
      "../extensions/shopops-pos-attribution/src/Modal.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  const locale = readFileSync(
    new URL(
      "../extensions/shopops-pos-attribution/locales/en.default.json",
      import.meta.url,
    ),
    "utf8",
  );

  assert.equal(modal.includes("DiagnosticsPanel"), false);
  assert.equal(modal.includes("ENABLE_DEV_DIAGNOSTICS"), false);
  assert.equal(modal.includes("JSON.stringify"), false);
  assert.equal(modal.includes("staffMemberId"), false);
  assert.match(locale, /automatically attributes eligible POS sales/);
  assert.match(locale, /Staff attribution is active/);
});

test("Locations performance remains role-filtered while reporting management is admin-only", () => {
  const locationRoute = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );
  const appShell = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(locationRoute, /assertReportingEntitlements/);
  assert.match(locationRoute, /requiredCapability: "view_locations"/);
  assert.match(
    locationRoute,
    /url\.searchParams\.get\("tab"\) === "reporting"[\s\S]*?capability: "manage_settings"/,
  );
  assert.match(locationRoute, /resolveReportingScope\(/);
  assert.match(locationRoute, /value: "performance", label: "Performance"/);
  assert.match(
    locationRoute,
    /value: "reporting"[\s\S]*?label: "Reporting locations"/,
  );
  assert.match(locationRoute, /select_reporting_locations/);
  assert.match(locationRoute, /getFreshPlanLimits/);
  assert.match(appShell, /getShopOpsNavigation\(permissions\.role\)/);
});

test("verified Shopify owner bootstrap has no implicit Shopify-admin or token-decoding bypass", () => {
  const shopifyServer = readFileSync(
    new URL("../app/shopify.server.ts", import.meta.url),
    "utf8",
  );
  const permissions = readFileSync(
    new URL("../app/lib/auth/permissions.server.ts", import.meta.url),
    "utf8",
  );
  const shopOpsAccess = readFileSync(
    new URL("../app/lib/auth/shopops-access.ts", import.meta.url),
    "utf8",
  );
  const appRoute = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );
  const billingRequired = readFileSync(
    new URL("../app/routes/app.billing-required.tsx", import.meta.url),
    "utf8",
  );
  const billingComplete = readFileSync(
    new URL("../app/routes/app.billing.complete.tsx", import.meta.url),
    "utf8",
  );

  assert.match(shopifyServer, /useOnlineTokens:\s*true/);
  assert.match(shopOpsAccess, /associatedUser\?\.account_owner/);
  assert.match(permissions, /materialize_dashboard_owner/);
  assert.match(permissions, /owner_setup_required/);
  assert.match(permissions, /ShopOps access required\./);
  assert.match(shopOpsAccess, /associatedUser\?\.email_verified/);
  assert.doesNotMatch(permissions, /decodeJwtPayload|id_token/);
  assert.doesNotMatch(
    permissions,
    /ADMIN_EMAILS|ADMIN_SHOPIFY_USER_IDS|fresh_install/,
  );
  assert.ok(
    appRoute.indexOf("await getPermissionContext") <
      appRoute.indexOf("await requireBillingAccess"),
    "Owner bootstrap must run before the middleware billing gate",
  );
  assert.match(appRoute, /error instanceof OwnerBootstrapError/);
  assert.match(permissions, /resolveOwnerMaterializationIdentifiers/);
  assert.match(permissions, /for \(let attempt = 0; attempt < 2/);
  assert.match(permissions, /\[owner-bootstrap\] controlled failure/);
  assert.doesNotMatch(
    permissions,
    /authorization headers|complete query strings|Partner API token/,
  );
  assert.ok(
    billingRequired.indexOf("const identity = getCurrentUserIdentity") <
      billingRequired.indexOf("const billing ="),
  );
  assert.ok(
    billingRequired.indexOf("await getPermissionContext") <
      billingRequired.indexOf("await ensureShopInitialized"),
  );
  assert.match(billingRequired, /view: "owner_setup"/);
  assert.match(
    billingRequired,
    /Only the Shopify store owner can choose or manage the ShopOps/,
  );
  assert.match(billingRequired, /error instanceof OwnerBootstrapError/);
  assert.ok(
    billingComplete.indexOf("await assertOwnerAccess") <
      billingComplete.indexOf("const billing = await refreshBillingState"),
  );
  assert.ok(
    billingComplete.indexOf("await assertOwnerAccess") <
      billingComplete.indexOf("await ensureShopInitialized"),
  );
  assert.match(billingComplete, /Owner setup is temporarily unavailable\./);
});

test("membership RPCs lock each shop and enforce owner, last-admin, archived-staff, and concurrent capacity rules", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260731120000_dashboard_memberships_and_reporting_locations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const staffRoute = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const canonicalMigration = readFileSync(
    new URL(
      "../supabase/migrations/20260802120000_canonical_shopops_access.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const legacyRoute = readFileSync(
    new URL("../app/routes/app.admin.permissions.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS public\.dashboard_memberships/,
  );
  assert.match(migration, /dashboard_memberships_one_owner_per_shop_uidx/);
  assert.match(migration, /dashboard_memberships_shop_person_uidx/);
  assert.match(migration, /pg_advisory_xact_lock/g);
  assert.match(migration, /dashboard_plan_capacity/);
  assert.match(migration, /owner_membership_locked/);
  assert.match(migration, /last_admin_required/);
  assert.match(migration, /people\.is_active = true/);
  assert.match(migration, /expand migration can be applied safely/);
  assert.match(staffRoute, /getFreshPlanLimits/);
  assert.match(staffRoute, /grant_or_update_shopops_access/);
  assert.match(staffRoute, /disable_dashboard_membership/);
  assert.match(staffRoute, /archive_staff_with_dashboard_protection/);
  assert.match(
    staffRoute,
    /Solo includes dashboard access for the store owner\. Upgrade to Growth to add another dashboard user\./,
  );
  assert.match(staffRoute, /intent === "create_from_alias"/);
  assert.match(staffRoute, /intent === "add_person"/);
  assert.match(staffRoute, /Dashboard access was not changed\./);
  assert.doesNotMatch(staffRoute, /replace_staff_dashboard_access/);
  assert.match(canonicalMigration, /grant_or_update_shopops_access/);
  assert.match(canonicalMigration, /p_restore_archived boolean/);
  assert.match(
    canonicalMigration,
    /Location configuration is deliberately preserved/,
  );
  assert.match(legacyRoute, /\/app\/people/);
  assert.match(legacyRoute, /url\.searchParams\.set\("tab", "access"\)/);
  assert.doesNotMatch(legacyRoute, /\.rpc\(/);
});

test("Shopify location state, reporting selection, report filters, and full sync remain separate", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260731120000_dashboard_memberships_and_reporting_locations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../app/routes/app.db-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const locations = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );
  const dataQuality = readFileSync(
    new URL("../app/routes/app.data-quality.tsx", import.meta.url),
    "utf8",
  );
  const dataQualityReport = readFileSync(
    new URL(
      "../app/lib/data-quality/data-quality-report.server.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const financialQa = readFileSync(
    new URL("../app/routes/app.admin.financial-qa.tsx", import.meta.url),
    "utf8",
  );
  const sync = readFileSync(
    new URL("../app/lib/sync/shopify-sync.server.ts", import.meta.url),
    "utf8",
  );

  assert.match(migration, /shopify_is_active boolean/);
  assert.match(migration, /reporting_enabled boolean/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.select_reporting_locations/,
  );
  assert.match(
    migration,
    /reporting_enabled = shopify_is_active AND shopify_location_id = ANY\(v_ids\)/,
  );
  for (const source of [dashboard, locations, dataQualityReport, financialQa]) {
    assert.match(source, /\.eq\("shopify_is_active", true\)/);
    assert.match(source, /\.eq\("reporting_enabled", true\)/);
  }
  for (const source of [dashboard, locations, financialQa]) {
    assert.match(source, /assertReportingEntitlements/);
  }
  // Data quality checks are now a capability-gated section embedded in
  // Data Sync (/app/settings?tab=sync); the standalone route only redirects.
  assert.match(dataQuality, /assertCapabilityAccess/);
  assert.match(dataQuality, /capability: "manage_sync"/);
  assert.match(locations, /const shouldFilterOrderLinesByLocation = true/);
  assert.match(
    financialQa,
    /\.in\("retail_location_id", selectedLocationIds\)/,
  );
  assert.match(sync, /shopify_is_active: location\.isActive/);
  assert.match(
    sync,
    /!billingEnabled[\s\S]*reporting_enabled: location\.isActive/,
  );
  assert.match(sync, /reporting_enabled: false/);
  assert.doesNotMatch(sync, /applyActiveLocationLimit|PlanCapacityError/);
});

test("legacy merchant URLs redirect to the final section tabs without duplicating editors", () => {
  const setup = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );
  const staff = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const sync = readFileSync(
    new URL("../app/routes/app.admin.sync.tsx", import.meta.url),
    "utf8",
  );
  const costs = readFileSync(
    new URL("../app/routes/app.costs.tsx", import.meta.url),
    "utf8",
  );
  const people = readFileSync(
    new URL("../app/routes/app.people.tsx", import.meta.url),
    "utf8",
  );

  assert.match(setup, /legacyTab === "plan"[\s\S]*?\/app\/settings/);
  assert.match(setup, /legacyTab === "product-costs"[\s\S]*?\/app\/costs/);
  assert.match(
    setup,
    /legacyTab === "reporting-locations"[\s\S]*?\/app\/locations/,
  );
  assert.match(staff, /url\.pathname === "\/app\/admin\/staff"/);
  assert.match(staff, /\/app\/people/);
  assert.match(sync, /url\.pathname === "\/app\/admin\/sync"/);
  assert.match(sync, /\/app\/settings/);
  assert.match(costs, /from "\.\/app\.admin\.setup"/);
  assert.match(people, /from "\.\/app\.admin\.staff"/);
});

test("People separates sales attribution from active ShopOps membership", () => {
  const people = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../app/components/ui/ShopOpsPage.tsx", import.meta.url),
    "utf8",
  );
  const accessPresentation = readFileSync(
    new URL("../app/lib/auth/shopops-access.ts", import.meta.url),
    "utf8",
  );
  const appButton = readFileSync(
    new URL("../app/components/ui/AppButton.tsx", import.meta.url),
    "utf8",
  );
  const dashboardFilters = readFileSync(
    new URL(
      "../app/components/dashboard/DashboardFilters.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(people, /label: "Sales attribution"/);
  assert.match(people, /label: "ShopOps access"/);
  assert.match(people, /<SectionTabs/);
  assert.match(
    people,
    /Manage who can open ShopOps Studio and which locations they can[\s\n]+view\./,
  );
  assert.match(people, /tab === "attribution" && data\.pending\.length/);
  assert.match(people, /tab === "access" \? "ShopOps role" : "POS sales"/);
  assert.match(accessPresentation, /Waiting for first sign-in/);
  assert.match(accessPresentation, /Needs attention/);
  assert.match(accessPresentation, /Access revoked/);
  assert.match(people, /getFreshPlanLimits/);
  assert.match(people, /loadCanonicalShopAccess/);
  assert.match(people, /grant_or_update_shopops_access/);
  assert.match(people, /p_dashboard_user_limit/);
  assert.match(people, /function AddPersonForm/);
  assert.match(people, /name="intent" value="add_person"/);
  assert.match(people, /name="capability_sales"/);
  assert.match(people, /name="capability_access"/);
  assert.match(
    people,
    /defaultCapability=\{tab === "access" \? "access" : "sales"\}/,
  );
  assert.match(people, /Email is required for ShopOps access\./);
  assert.match(people, /if \(shopOpsAccess\)/);
  assert.doesNotMatch(people, /p_shopify_user_ids/);
  assert.match(people, /<Button primary onClick=\{\(\) => open\("add"\)\}>/);
  assert.match(people, /Add person/);
  assert.doesNotMatch(people, /Add staff|Add ShopOps user|add_shopops_user/);
  assert.match(people, /displayedShopOpsRole/);
  assert.match(people, /!presentation\.showConfiguredRole/);
  assert.match(people, /<FilterPills/);
  assert.match(people, /label: "Waiting \("/);
  assert.match(people, /if \(selectedFilter === "all"\) return true/);
  assert.match(
    people,
    /if \(selectedFilter === "all"\) return true;[\s\S]*?if \(selectedFilter === "archived"\) return !profile\.is_active/,
  );
  assert.match(people, /Re-enable access/);
  assert.match(people, /Archive person/);

  assert.match(people, /import \{ AppButton \}/);
  assert.match(people, /variant=\{danger \? "danger" : primary \? "primary"/);
  assert.match(dashboardFilters, /<AppButton[\s\S]*?variant="primary"/);
  assert.match(
    appButton,
    /disabledBackground: "#e5e7eb"[\s\S]*?disabledColor: "#6b7280"/,
  );
  assert.match(
    presentation,
    /\.shopops-filter-pills button\[aria-pressed="true"\][^{]*\{[^}]*background: var\(--shopops-accent-selected\)[^}]*border-color: var\(--shopops-accent\)/,
  );
});

test("email-first ShopOps access reuses people, binds verified identity, and keeps shop billing offline", () => {
  const people = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const accessService = readFileSync(
    new URL("../app/lib/auth/shopops-access.server.ts", import.meta.url),
    "utf8",
  );
  const permissions = readFileSync(
    new URL("../app/lib/auth/permissions.server.ts", import.meta.url),
    "utf8",
  );
  const shopOpsAccess = readFileSync(
    new URL("../app/lib/auth/shopops-access.ts", import.meta.url),
    "utf8",
  );
  const appRoute = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../app/routes/app.db-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const entitlements = readFileSync(
    new URL("../app/lib/entitlements.server.ts", import.meta.url),
    "utf8",
  );
  const shopLevelAdmin = readFileSync(
    new URL("../app/lib/shopify/shop-level-admin.server.ts", import.meta.url),
    "utf8",
  );
  const routeError = readFileSync(
    new URL("../app/components/ui/RouteErrorNotice.tsx", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260731120000_dashboard_memberships_and_reporting_locations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const identityMigration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260708200000_add_staff_identity_mapping.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(people, /intent === "add_person"/);
  assert.match(accessService, /\.from\("staff_people"\)/);
  assert.match(accessService, /\.ilike\("email", email\)/);
  assert.match(accessService, /STAFF_ALIAS_TYPES\.email/);
  assert.match(accessService, /created\.error\?\.code === "23505"/);
  assert.match(accessService, /restore_archived_staff/);
  assert.match(people, /grant_or_update_shopops_access/);
  assert.match(people, /disable_dashboard_membership/);
  assert.match(people, /archive_staff_with_dashboard_protection/);
  assert.doesNotMatch(people, /p_shopify_user_ids/);
  assert.match(shopOpsAccess, /Waiting for first sign-in/);
  assert.match(people, /Grant access/);
  assert.match(people, /Edit role/);
  assert.match(people, /Edit locations/);
  assert.match(people, /Revoke access/);
  assert.match(people, />Restore</);
  assert.match(people, /if \(tab === "access"\) \{/);
  assert.match(people, /if \(selectedFilter === "all"\) return true/);

  assert.match(shopOpsAccess, /associatedUser\?\.email_verified/);
  assert.match(permissions, /identity\.isEmailVerified &&/);
  assert.match(permissions, /bindVerifiedMembership/);
  assert.match(permissions, /bind_verified_shopops_identity/);
  assert.match(permissions, /p_shopify_user_id: identity\.shopifyUserId/);
  assert.match(permissions, /activated\.error\.code === "23505"/);
  assert.doesNotMatch(permissions, /existing\.data\.person_id === null/);
  assert.doesNotMatch(permissions, /\.is\("person_id", null\)/);
  assert.doesNotMatch(permissions, /bound_alias_sync_pending/);
  assert.doesNotMatch(permissions, /let aliasSyncSucceeded/);
  assert.ok(
    permissions.indexOf("const linked = await bindVerifiedMembership") <
      permissions.indexOf("export async function assertDashboardAccess"),
    "waiting identity resolution must run before dashboard authorization",
  );
  assert.match(permissions, /linked_shopify_user_id/);
  assert.match(permissions, /verified_email_linked/);
  assert.match(permissions, /email_unverified/);
  assert.match(permissions, /authenticated_session_attention/);
  assert.match(permissions, /\[shopops-access\] first-sign-in resolution/);
  for (const field of [
    "associatedShopifyUserPresent",
    "verifiedAuthenticatedEmailPresent",
    "matchedByHiddenIdentity",
    "matchedByEmail",
    "membershipState",
    "bindingAttempted",
    "activationAttempted",
    "result",
  ]) {
    assert.match(permissions, new RegExp(field));
  }
  const diagnosticLogger = permissions.slice(
    permissions.indexOf("function logFirstSignInResolution"),
    permissions.indexOf("async function markIdentityNeedsAttention"),
  );
  assert.doesNotMatch(
    diagnosticLogger,
    /accessToken|idToken|sessionId|hmac|requestUrl|payload/,
  );
  assert.ok(
    permissions.indexOf("} else if (userIdMembership) {") <
      permissions.indexOf('} else if (emailMembership?.status === "active") {'),
    "the hidden Shopify user binding must take precedence after first sign-in",
  );

  assert.match(appRoute, /if \(!permissions\.isActiveMember\)/);
  assert.match(appRoute, /ShopOps access required/);
  assert.doesNotMatch(appRoute, /Shopify user ID/);
  assert.match(routeError, /title: "ShopOps access required"/);
  assert.match(routeError, /title: "Location access denied"/);

  assert.match(appRoute, /getShopLevelAdminClient/);
  assert.match(entitlements, /getShopLevelAdminClient/);
  assert.match(shopLevelAdmin, /getOfflineAdminClient/);
  assert.doesNotMatch(dashboard, /const \{ admin, session \}/);
  assert.match(shopLevelAdmin, /offline_authentication_required/);

  assert.match(
    identityMigration,
    /staff_people_shop_email_uidx[\s\S]*?shop_domain, lower\(email\)/,
  );
  assert.match(migration, /dashboard_memberships_shop_person_uidx/);
  assert.match(migration, /dashboard_memberships_shop_email_uidx/);
  assert.match(migration, /dashboard_memberships_shop_user_id_uidx/);
  assert.match(migration, /owner_membership_locked/);
  assert.match(migration, /last_admin_required/);
});

test("revoked hidden identity consolidates one explicit waiting approval without moving the Shopify identity", () => {
  const permissions = readFileSync(
    new URL("../app/lib/auth/permissions.server.ts", import.meta.url),
    "utf8",
  );
  const consolidation = readFileSync(
    new URL("../app/lib/auth/duplicate-access.server.ts", import.meta.url),
    "utf8",
  );
  const people = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260802120000_canonical_shopops_access.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(permissions, /userIdMembership\?\.status === "disabled"/);
  assert.match(permissions, /emailMembership\?\.status === "active"/);
  assert.match(permissions, /emailMembership\.id !== userIdMembership\.id/);
  assert.match(permissions, /resolveApprovedDuplicateAccess/);
  assert.match(permissions, /verified_email_reactivated/);
  assert.match(permissions, /consolidated_reactivation/);
  assert.match(
    permissions,
    /else \{[\s\n]+membership = userIdMembership;[\s\n]+accessReason = "membership_revoked"/,
  );
  assert.ok(
    permissions.indexOf("resolveApprovedDuplicateAccess({") <
      permissions.indexOf("const activeMembership ="),
    "duplicate consolidation must finish before membership authorization",
  );

  assert.match(consolidation, /hiddenMatches\.length !== 1/);
  assert.match(consolidation, /emailMatches\.length !== 1/);
  assert.match(consolidation, /thirdAccessClaim/);
  assert.match(consolidation, /hasAttributedIdentity && !allowAttributedMerge/);
  assert.match(consolidation, /reason: "attribution_conflict"/);
  assert.match(consolidation, /resolve_duplicate_shopops_access/);
  assert.match(consolidation, /p_owner_membership_id: ownerMembership\.id/);
  assert.match(consolidation, /p_revoked_membership_id: revokedMembership\.id/);
  assert.match(consolidation, /p_waiting_membership_id: waitingMembership\.id/);
  assert.match(consolidation, /p_allow_attributed_merge: allowAttributedMerge/);
  assert.doesNotMatch(consolidation, /rollbackClaim/);
  assert.match(consolidation, /isCanonicalResolvedMembership/);
  assert.doesNotMatch(consolidation, /\.update\(|\.delete\(\)/);
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.resolve_duplicate_shopops_access/,
  );
  assert.match(migration, /UPDATE public\.staff_identity_aliases/);
  assert.match(migration, /DELETE FROM public\.dashboard_memberships/);
  assert.match(migration, /DELETE FROM public\.staff_people/);

  assert.match(people, /duplicateAccessConflict/);
  assert.match(people, /Resolve duplicate access/);
  assert.match(people, /intent === "resolve_duplicate_access"/);
  assert.match(people, /if \(!permissions\.isOwner\)/);
  assert.match(people, /allowAttributedMerge: true/);
  assert.match(
    people,
    /Sales attribution, aliases, and[\s\n]+reporting history/,
  );
  assert.doesNotMatch(people, /Shopify user ID/);

  assert.match(migration, /dashboard_memberships_shop_person_fkey/);
  assert.match(migration, /user_location_access_shop_membership_fkey/);
  assert.match(migration, /user_location_access_membership_required_check/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test("canonical ShopOps access hardening rejects partial, orphan, duplicate, and cross-shop graphs", () => {
  const baseMigration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260731120000_dashboard_memberships_and_reporting_locations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260802120000_canonical_shopops_access.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const resolver = readFileSync(
    new URL("../app/lib/auth/canonical-access.server.ts", import.meta.url),
    "utf8",
  );
  const people = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const permissions = readFileSync(
    new URL("../app/lib/auth/permissions.server.ts", import.meta.url),
    "utf8",
  );

  assert.match(migration, /dashboard_memberships_person_required_check/);
  assert.match(migration, /user_location_access_membership_required_check/);
  assert.match(
    migration,
    /FOREIGN KEY \(shop_domain, membership_id\)[\s\S]*?REFERENCES public\.dashboard_memberships \(shop_domain, id\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \(shop_domain, person_id\)[\s\S]*?REFERENCES public\.staff_people \(shop_domain, id\)/,
  );
  assert.match(migration, /NOT VALID/g);
  assert.match(baseMigration, /dashboard_memberships_shop_person_uidx/);
  assert.match(baseMigration, /dashboard_memberships_shop_email_uidx/);
  assert.match(baseMigration, /dashboard_memberships_shop_user_id_uidx/);
  assert.match(resolver, /missing_membership_reference/);
  assert.match(resolver, /membership_not_in_shop/);
  assert.match(resolver, /person_mismatch/);
  assert.match(resolver, /email_mismatch/);
  assert.match(resolver, /hidden_identity_mismatch/);
  assert.match(resolver, /canonicalLocationAccess\.push/);
  assert.match(people, /loadCanonicalShopAccess/);
  assert.match(people, /row\.membership_id === membership\.id/);
  assert.match(people, /hasAccessIntegrityIssue/);
  assert.match(people, /Repair access/);
  assert.match(people, /Only the store owner can repair ShopOps access/);
  assert.doesNotMatch(people, /data\.get\("membership_id"\)/);
  assert.match(permissions, /loadCanonicalMembershipLocationAccess/);
  assert.match(permissions, /const membershipSnapshot = membershipRows\.find/);
  assert.match(permissions, /shopify_user_id: activeMembership\.shopifyUserId/);
});

test("ShopOps grant, owner, bind, revoke, archive, and duplicate operations have transactional lifecycle semantics", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260802120000_canonical_shopops_access.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const people = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const permissions = readFileSync(
    new URL("../app/lib/auth/permissions.server.ts", import.meta.url),
    "utf8",
  );

  for (const rpc of [
    "materialize_dashboard_owner",
    "grant_or_update_shopops_access",
    "bind_verified_shopops_identity",
    "resolve_duplicate_shopops_access",
    "update_shopops_person_profile",
    "repair_shopops_access_integrity",
  ]) {
    assert.match(migration, new RegExp(`FUNCTION public\\.${rpc}`));
  }
  const grant = migration.slice(
    migration.indexOf("FUNCTION public.grant_or_update_shopops_access"),
    migration.indexOf("FUNCTION public.disable_dashboard_membership"),
  );
  assert.ok(
    grant.indexOf("INSERT INTO public.dashboard_memberships") <
      grant.indexOf("INSERT INTO public.user_location_access"),
  );
  assert.match(grant, /p_person_id uuid/);
  assert.match(grant, /p_restore_archived boolean/);
  assert.match(grant, /dashboard_identity_ambiguous/);
  assert.match(grant, /dashboard_plan_capacity/);
  assert.match(grant, /DELETE FROM public\.user_location_access/);
  assert.match(grant, /INSERT INTO public\.user_location_access/);
  const revoke = migration.slice(
    migration.indexOf("FUNCTION public.disable_dashboard_membership"),
    migration.indexOf(
      "FUNCTION public.archive_staff_with_dashboard_protection",
    ),
  );
  assert.match(revoke, /SET status = 'disabled'/);
  assert.doesNotMatch(revoke, /DELETE FROM public\.user_location_access/);
  const archive = migration.slice(
    migration.indexOf(
      "FUNCTION public.archive_staff_with_dashboard_protection",
    ),
    migration.indexOf("FUNCTION public.bind_verified_shopops_identity"),
  );
  assert.match(archive, /SET status = 'disabled'/);
  assert.doesNotMatch(archive, /DELETE FROM public\.user_location_access/);
  const owner = migration.slice(
    migration.indexOf("FUNCTION public.materialize_dashboard_owner"),
    migration.indexOf("FUNCTION public.grant_or_update_shopops_access"),
  );
  assert.match(owner, /INSERT INTO public\.staff_people/);
  assert.match(owner, /INSERT INTO public\.dashboard_memberships/);
  assert.match(owner, /shopify_location_id, location_name/);
  assert.match(owner, /'\*', 'All reporting locations'/);
  const repair = migration.slice(
    migration.indexOf("FUNCTION public.repair_shopops_access_integrity"),
    migration.indexOf("REVOKE ALL ON FUNCTION"),
  );
  assert.doesNotMatch(repair, /DELETE FROM public\.staff_identity_aliases/);
  assert.doesNotMatch(repair, /order_lines|orders|staff_pos_seller_metrics/);
  const addPerson = people.slice(
    people.indexOf('if (intent === "add_person")'),
    people.indexOf('intent === "save_dashboard_access"'),
  );
  assert.ok(
    addPerson.indexOf('rpc("grant_or_update_shopops_access"') <
      addPerson.indexOf("let person"),
    "the ShopOps branch must commit through the RPC before sales-only person creation",
  );
  assert.match(permissions, /rpc\("bind_verified_shopops_identity"/);
  assert.doesNotMatch(permissions, /let aliasSyncSucceeded/);
  assert.match(people, /rpc\("update_shopops_person_profile"/);
});

test("access maintenance is read-only by default, masks identities, and plans the demo repair idempotently", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const maintenance = readFileSync(
    new URL("../scripts/shopops-access-maintenance.mjs", import.meta.url),
    "utf8",
  );
  assert.equal(
    packageJson.scripts["shopops:access-audit"],
    "node ./scripts/shopops-access-maintenance.mjs audit",
  );
  assert.equal(
    packageJson.scripts["shopops:access-repair"],
    "node ./scripts/shopops-access-maintenance.mjs repair",
  );
  assert.deepEqual(
    parseAccessMaintenanceArgs([
      "--shop",
      "shopops-demo.myshopify.com",
      "--email",
      "Pierre.Paul.Quilichini@outlook.fr",
    ]),
    {
      shop: "shopops-demo.myshopify.com",
      email: "pierre.paul.quilichini@outlook.fr",
      apply: false,
      confirmProduction: false,
    },
  );
  assert.equal(
    maskEmail("pierre.paul.quilichini@outlook.fr"),
    "p***@outlook.fr",
  );
  assert.match(maintenance, /command === "audit" \|\| !args\.apply/);
  assert.match(maintenance, /--confirm-production/);
  assert.match(maintenance, /repair_shopops_access_integrity/);
  assert.doesNotMatch(maintenance, /console\.log\([^)]*shopify_user_id/);

  const report = buildAccessAudit({
    shop: "shopops-demo.myshopify.com",
    email: "pierre.paul.quilichini@outlook.fr",
    people: [
      {
        id: "person-outlook",
        shop_domain: "shopops-demo.myshopify.com",
        email: "pierre.paul.quilichini@outlook.fr",
        is_active: true,
      },
    ],
    memberships: [],
    access: [
      {
        membership_id: "hidden-owner-membership",
        person_id: null,
        user_email: null,
        role: "admin",
        shopify_location_id: "*",
        location_name: "All reporting locations",
      },
      {
        membership_id: "hidden-viewer-membership",
        person_id: "person-outlook",
        user_email: "pierre.paul.quilichini@outlook.fr",
        role: "viewer",
        shopify_location_id: "location-laval",
        location_name: "Laval Store",
      },
    ],
  });
  assert.equal(report.mode, "read-only audit");
  assert.equal(report.targetEmail, "p***@outlook.fr");
  assert.deepEqual(report.expectedAfter.targetLocations, ["Laval Store"]);
  assert.equal(report.expectedAfter.targetRole, "viewer");
  assert.equal(report.expectedAfter.ownerMemberships, 1);
  assert.equal(report.expectedAfter.targetMemberships, 1);
  assert.ok(report.proposedWrites.length > 0);
  const serialized = JSON.stringify(report);
  for (const rawId of [
    "hidden-owner-membership",
    "hidden-viewer-membership",
    "person-outlook",
    "location-laval",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(rawId));
  }

  const canonical = buildAccessAudit({
    shop: "shopops-demo.myshopify.com",
    email: "pierre.paul.quilichini@outlook.fr",
    people: [
      {
        id: "owner-person",
        shop_domain: "shopops-demo.myshopify.com",
        email: "owner@example.com",
        is_active: true,
      },
      {
        id: "viewer-person",
        shop_domain: "shopops-demo.myshopify.com",
        email: "pierre.paul.quilichini@outlook.fr",
        is_active: true,
      },
    ],
    memberships: [
      {
        id: "owner-membership",
        shop_domain: "shopops-demo.myshopify.com",
        person_id: "owner-person",
        normalized_email: "owner@example.com",
        shopify_user_id: "private-owner-binding",
        role: "owner",
        status: "active",
        is_owner: true,
      },
      {
        id: "viewer-membership",
        shop_domain: "shopops-demo.myshopify.com",
        person_id: "viewer-person",
        normalized_email: "pierre.paul.quilichini@outlook.fr",
        shopify_user_id: null,
        role: "viewer",
        status: "active",
        is_owner: false,
      },
    ],
    access: [
      {
        membership_id: "owner-membership",
        person_id: "owner-person",
        user_email: "owner@example.com",
        role: "admin",
        shopify_location_id: "*",
        location_name: "All reporting locations",
      },
      {
        membership_id: "viewer-membership",
        person_id: "viewer-person",
        user_email: "pierre.paul.quilichini@outlook.fr",
        role: "viewer",
        shopify_location_id: "location-laval",
        location_name: "Laval Store",
      },
    ],
  });
  assert.deepEqual(canonical.proposedWrites, []);

  const hiddenMismatch = buildAccessAudit({
    shop: "shopops-demo.myshopify.com",
    email: null,
    people: [
      {
        id: "owner-person",
        shop_domain: "shopops-demo.myshopify.com",
        email: "owner@example.com",
        is_active: true,
      },
    ],
    memberships: [
      {
        id: "owner-membership",
        shop_domain: "shopops-demo.myshopify.com",
        person_id: "owner-person",
        normalized_email: "owner@example.com",
        shopify_user_id: "canonical-private-binding",
        role: "owner",
        status: "active",
        is_owner: true,
      },
    ],
    access: [
      {
        membership_id: "owner-membership",
        person_id: "owner-person",
        user_email: "owner@example.com",
        shopify_user_id: "different-private-binding",
        role: "admin",
        shopify_location_id: "*",
        location_name: "All reporting locations",
      },
    ],
  });
  assert.equal(
    hiddenMismatch.before.integrityIssues.hidden_identity_mismatch,
    1,
  );
});

test("Dashboard onboarding is compact, admin-only, and disappears when complete", () => {
  const dashboard = readFileSync(
    new URL("../app/routes/app.db-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const tabs = readFileSync(
    new URL("../app/components/ui/SectionTabs.tsx", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../app/components/ui/ShopOpsPage.tsx", import.meta.url),
    "utf8",
  );

  for (const label of [
    "Select reporting locations",
    "Add product costs",
    "Add operating expenses",
    "Review ShopOps access",
  ]) {
    assert.match(dashboard, new RegExp(label));
  }
  assert.match(
    dashboard,
    /readiness\.canAdmin && onboardingItems\.some\(\(item\) => !item\.complete\)/,
  );
  assert.match(dashboard, /\{showOnboarding \? \(/);
  assert.match(dashboard, /<details[\s\S]*?open/);
  assert.match(tabs, /className="shopops-section-tabs"/);
  assert.match(presentation, /\.shopops-section-tabs \{[^}]*overflow-x: auto/);
  assert.match(
    presentation,
    /\.shopops-section-tabs \{[^}]*white-space: nowrap/,
  );
});

test("premium headers, tabs, and button states are centralized and distinct", () => {
  const presentation = readFileSync(
    new URL("../app/components/ui/ShopOpsPage.tsx", import.meta.url),
    "utf8",
  );
  const buttons = readFileSync(
    new URL("../app/components/ui/AppButton.tsx", import.meta.url),
    "utf8",
  );
  const sync = readFileSync(
    new URL("../app/routes/app.admin.sync.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    presentation,
    /className="shopops-page-header__copy"[\s\S]*?<h1>\{title\}<\/h1>[\s\S]*?<p>\{description\}<\/p>/,
  );
  assert.match(
    presentation,
    /\.shopops-page-header__identity \{[^}]*align-items: center/,
  );
  assert.match(
    presentation,
    /\.shopops-page-header__icon \{[^}]*flex: 0 0 40px[^}]*height: 40px[^}]*width: 40px/,
  );
  assert.match(
    presentation,
    /\.shopops-page-header__icon \.Polaris-Icon \{[^}]*height: 21px[^}]*width: 21px/,
  );
  assert.match(
    presentation,
    /\.shopops-section-tabs__item\[aria-current="page"\] \{[^}]*background: var\(--shopops-accent-selected\)[^}]*border-color: var\(--shopops-accent\)[^}]*color: #163b7a/,
  );
  assert.match(
    presentation,
    /\.shopops-page :where\(a, button, input, select, summary\):focus-visible/,
  );
  assert.match(
    buttons,
    /primary: \{[\s\S]*?background: "#2563eb"[\s\S]*?disabledBackground: "#e5e7eb"[\s\S]*?disabledColor: "#6b7280"/,
  );
  assert.doesNotMatch(
    buttons.slice(
      buttons.indexOf("primary: {"),
      buttons.indexOf("secondary: {"),
    ),
    /disabledBackground: "#93c5fd"/,
  );
  assert.match(sync, /\.sync-page \.primary:disabled\{background:#e5e7eb/);
});

test("Dashboard and Locations share compact filters and compact empty sales notices", () => {
  const filterPresentation = readFileSync(
    new URL("../app/components/dashboard/ReportFilters.tsx", import.meta.url),
    "utf8",
  );
  const dashboardFilters = readFileSync(
    new URL(
      "../app/components/dashboard/DashboardFilters.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../app/routes/app.db-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const locations = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../app/components/ui/ShopOpsPage.tsx", import.meta.url),
    "utf8",
  );

  for (const component of [
    "ReportFilterPanel",
    "ReportFilterField",
    "ReadOnlyReportLocation",
  ]) {
    assert.match(
      filterPresentation,
      new RegExp(`export function ${component}`),
    );
  }
  assert.match(dashboardFilters, /<ReportFilterPanel/);
  assert.match(locations, /<ReportFilterPanel/);
  assert.match(dashboardFilters, /Restricted by your ShopOps access\./);
  assert.match(locations, /Restricted by your ShopOps access\./);
  assert.doesNotMatch(dashboardFilters, /disabled=\{!canSwitchLocation\}/);
  assert.match(dashboard, /locationAccessRestricted=\{!readiness\.canAdmin\}/);
  assert.match(presentation, /\.shopops-report-filter-grid \{/);
  assert.match(presentation, /\.shopops-report-filter-control \{/);
  assert.match(presentation, /export function CompactEmptyDataNotice/);
  assert.match(
    dashboard,
    /hasNoSalesForPeriod \? \([\s\S]*?<CompactEmptyDataNotice[\s\S]*?No sales for this period\./,
  );
  assert.match(
    locations,
    /hasNoSalesForRange \? \([\s\S]*?<CompactEmptyDataNotice[\s\S]*?No sales for this date range\./,
  );
  assert.doesNotMatch(
    dashboard.slice(
      dashboard.indexOf(
        "!readiness.noAssignedLocations && hasNoSalesForPeriod",
      ),
      dashboard.indexOf(
        "readiness.syncFailureBanner.kind",
        dashboard.indexOf("hasNoSalesForPeriod"),
      ),
    ),
    /bullets=/,
  );
  assert.doesNotMatch(
    locations.slice(
      locations.indexOf(") : hasNoSalesForRange ? ("),
      locations.indexOf("{shouldShowAnalytics ? ("),
    ),
    /bullets=/,
  );
});

test("shared report KPI order, labels, formatting, and categories are canonical", () => {
  const configuration = readFileSync(
    new URL("../app/lib/dashboard/kpi-presentation.ts", import.meta.url),
    "utf8",
  );
  const renderer = readFileSync(
    new URL("../app/components/dashboard/ReportKpiGrid.tsx", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../app/components/ui/ShopOpsPage.tsx", import.meta.url),
    "utf8",
  );
  const dashboardKpis = readFileSync(
    new URL("../app/components/dashboard/KpiCards.tsx", import.meta.url),
    "utf8",
  );
  const locations = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    configuration,
    /legacy: \[\s*"sales",\s*"orders",\s*"unitsSold",\s*"cogs",\s*"grossProfit",\s*"grossMargin",\s*"expenses",\s*"netProfit",?\s*\]/,
  );
  assert.match(
    configuration,
    /v2: \[\s*"sales",\s*"refunds",\s*"returns",\s*"orders",\s*"unitsSold",\s*"cogs",\s*"grossProfit",\s*"grossMargin",\s*"expenses",\s*"netProfit",?\s*\]/,
  );
  assert.match(
    configuration,
    /Location-only metrics are appended after the complete shared KPI block/,
  );
  assert.match(
    configuration,
    /LOCATION_ONLY_REPORT_KPI_APPEND_ORDER = \[\s*"averageOrderValue",?\s*\]/,
  );
  for (const category of [
    'sales: "commercial"',
    'grossProfit: "commercial"',
    'grossMargin: "commercial"',
    'netProfit: "commercial"',
    'orders: "activity"',
    'unitsSold: "activity"',
    'averageOrderValue: "activity"',
    'refunds: "neutral"',
    'returns: "neutral"',
    'cogs: "neutral"',
    'expenses: "neutral"',
  ]) {
    assert.match(configuration, new RegExp(category));
  }
  for (const label of [
    "Net Sales",
    "Refunds",
    "Returns",
    "Orders",
    "Units sold",
    "COGS",
    "Gross profit",
    "Gross margin",
    "Expenses",
    "Net profit",
    "AOV (Net)",
  ]) {
    assert.match(configuration, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.match(dashboardKpis, /buildSharedReportKpiItems/);
  assert.match(locations, /buildSharedReportKpiItems/);
  assert.match(locations, /buildLocationOnlyReportKpiItems/);
  assert.match(renderer, /data-category=\{item\.category\}/);
  assert.match(renderer, /data-item-count=\{items\.length\}/);
  assert.match(
    presentation,
    /\.shopops-kpi-grid\[data-item-count="11"\] \{ grid-template-columns: repeat\(12, minmax\(0, 1fr\)\); \}/,
  );
  assert.match(
    presentation,
    /\.shopops-kpi-grid\[data-item-count="11"\] > \.shopops-kpi-card \{ grid-column: span 2; \}/,
  );
  assert.match(
    presentation,
    /\.shopops-kpi-grid\[data-item-count="11"\] > \.shopops-kpi-card:nth-child\(7\) \{ grid-column: 2 \/ span 2; \}/,
  );
  assert.match(
    presentation,
    /\.shopops-kpi-card\[data-category="commercial"\] \{[^}]*border-top-color: var\(--shopops-accent\)/,
  );
  assert.match(
    presentation,
    /\.shopops-kpi-card\[data-category="activity"\] \{[^}]*border-top-color: var\(--shopops-teal\)/,
  );
});

test("Settings separates data freshness from scheduler state at the shared width", () => {
  const settings = readFileSync(
    new URL("../app/routes/app.settings.tsx", import.meta.url),
    "utf8",
  );
  const sync = readFileSync(
    new URL("../app/routes/app.admin.sync.tsx", import.meta.url),
    "utf8",
  );

  assert.match(settings, /<DataSyncPage embedded/);
  assert.doesNotMatch(settings, /<h1|<h2/);
  for (const label of [
    "Current data status",
    "Last successful update",
    "Automatic synchronization",
    "Automatic check timing",
    "Delayed automatic check",
  ]) {
    assert.match(sync, new RegExp(label));
  }
  assert.match(
    sync,
    /Current data can still be up to date; the background scheduler has not completed a successful check on schedule\./,
  );
  assert.match(sync, /className="sync-content"/);
  assert.match(sync, /\.sync-content\{margin:0;width:100%\}/);
  assert.doesNotMatch(sync, /sync-shell|margin:auto|max-width:1100px/);
  assert.match(sync, /<AppButton disabled=\{isSubmitting\} type="submit">/);
  assert.doesNotMatch(sync, /<button className="primary"/);
  assert.match(
    sync,
    /@media\(max-width:760px\)[\s\S]*?\.sync-page--embedded\{padding:0\}/,
  );
  assert.match(
    sync,
    /className="sync-status-card"[\s\S]*?title="Synchronization status"/,
  );
  assert.match(sync, /className="sync-section-intro"/);
  assert.match(
    sync,
    /\.sync-status-grid\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/,
  );
  assert.doesNotMatch(sync, /background:#f4f5f4/);
  assert.match(
    sync,
    /\.sync-page \.primary:disabled\{background:#e5e7eb;border-color:#d1d5db;color:#6b7280;/,
  );
  assert.match(
    sync,
    /<ContentCard className="resource-card" title="Data freshness">/,
  );
});

test("Plan and billing is summary-only, owner-priced, contextual, and uses a one-time flash", () => {
  const appShell = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );
  const plan = readFileSync(
    new URL("../app/components/setup/PlanSetup.tsx", import.meta.url),
    "utf8",
  );
  const callback = readFileSync(
    new URL("../app/routes/app.billing.complete.tsx", import.meta.url),
    "utf8",
  );
  const settings = readFileSync(
    new URL("../app/routes/app.settings.tsx", import.meta.url),
    "utf8",
  );
  const flash = readFileSync(
    new URL("../app/lib/flash.server.ts", import.meta.url),
    "utf8",
  );
  const presentation = readFileSync(
    new URL("../app/components/ui/ShopOpsPage.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(appShell, />\s*Plan\s*<\/a>/);
  assert.match(plan, /data\.canManagePlan && data\.managePlanUrl/);
  assert.match(plan, /label="ShopOps users"/);
  assert.match(plan, /Manage ShopOps access/);
  assert.match(plan, /data\.dashboardUsers\.usage/);
  assert.match(plan, /data\.dashboardUsers\.limit/);
  assert.match(plan, /Subscription status/);
  assert.match(plan, /<StatusBadge/);
  assert.match(plan, /formatStoreDate/);
  assert.match(plan, /Only the Shopify store owner can change this plan/);
  assert.match(plan, /Trial ends/);
  assert.match(plan, /Cancels at the end of the billing cycle/);
  assert.match(presentation, /usage > limit/);
  assert.match(presentation, /"ShopOps user"/);
  assert.match(presentation, /data-capacity=\{isOver \? "over" : "within"\}/);
  assert.match(plan, /Owner · Active · Always has access · Locked/);
  assert.equal((plan.match(/<UsageSummary/g) ?? []).length, 2);
  assert.match(plan, /<strong>Action required\.<\/strong>/);
  assert.match(plan, /to="\/app\/locations\?tab=reporting"/);
  assert.match(plan, /to="\/app\/people\?tab=access"/);
  assert.doesNotMatch(plan, /save-reporting-locations/);
  assert.doesNotMatch(plan, /save-dashboard-memberships/);
  assert.match(
    settings,
    /permissions\.isOwner && permissions\.identity\.isShopifyAccountOwner/,
  );
  assert.match(settings, /label: "Data sync"/);
  assert.match(settings, /label: "Plan & billing"/);
  assert.match(callback, /assertOwnerAccess/);
  assert.match(callback, /setPlanConfirmedFlash/);
  assert.match(callback, /\/app\/settings/);
  assert.match(callback, /Retry confirmation/);
  assert.match(callback, /Continue to plan selection/);
  assert.doesNotMatch(callback, /billing", "activated/);
  assert.match(flash, /session\.flash\("planConfirmed", "Plan confirmed\."\)/);
  assert.match(flash, /session\.get\("planConfirmed"\)/);
});

test("merchant pages share the ShopOps presentation layer without editable owner controls", () => {
  const presentation = readFileSync(
    new URL("../app/components/ui/ShopOpsPage.tsx", import.meta.url),
    "utf8",
  );
  const dashboardHeader = readFileSync(
    new URL("../app/components/dashboard/DashboardHeader.tsx", import.meta.url),
    "utf8",
  );
  const locations = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );
  const costs = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );
  const productCosts = readFileSync(
    new URL("../app/components/setup/ProductCostsSetup.tsx", import.meta.url),
    "utf8",
  );
  const people = readFileSync(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const settings = readFileSync(
    new URL("../app/routes/app.settings.tsx", import.meta.url),
    "utf8",
  );
  const sync = readFileSync(
    new URL("../app/routes/app.admin.sync.tsx", import.meta.url),
    "utf8",
  );

  for (const component of [
    "PageHeader",
    "ContentCard",
    "SummaryCard",
    "UsageSummary",
    "SelectableCard",
    "FormActions",
    "InlineNotice",
    "EmptyState",
    "CompactEmptyDataNotice",
  ]) {
    assert.match(presentation, new RegExp(`export function ${component}`));
  }
  assert.equal((dashboardHeader.match(/<PageHeader/g) ?? []).length, 1);
  assert.equal((costs.match(/<PageHeader/g) ?? []).length, 1);
  assert.equal((people.match(/<PageHeader/g) ?? []).length, 1);
  assert.equal((settings.match(/<PageHeader/g) ?? []).length, 1);
  assert.equal((locations.match(/<PageHeader/g) ?? []).length, 2);

  for (const tabbedPage of [locations, costs, people, settings]) {
    assert.match(tabbedPage, /<SectionTabs/);
  }
  assert.match(settings, /<DataSyncPage embedded/);
  assert.doesNotMatch(settings, /<h1|<h2/);
  assert.match(sync, /\{!embedded \? \([\s\S]*?<h1>Data sync<\/h1>/);

  assert.match(locations, /className="shopops-selectable-grid"/);
  assert.match(locations, /<SelectableCard/);
  assert.match(locations, /<FormActions>/);
  assert.match(
    presentation,
    /\.shopops-selectable-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    presentation,
    /\.shopops-form-actions\[data-equal="true"\] > \* \{[^}]*width: 50%/,
  );

  const ownerRowStart = people.indexOf(
    'tab === "access" && profile.membership?.is_owner',
  );
  const ownerRowEnd = people.indexOf(") : (", ownerRowStart);
  const ownerRow = people.slice(ownerRowStart, ownerRowEnd);
  assert.ok(ownerRowStart > -1 && ownerRowEnd > ownerRowStart);
  assert.match(ownerRow, /Owner/);
  assert.match(ownerRow, /Always has access/);
  assert.match(ownerRow, /PersonLockIcon/);
  assert.doesNotMatch(ownerRow, /<button|<select/);
  assert.match(people, /open\("access", profile\)/);
  assert.match(people, /grant_or_update_shopops_access/);

  assert.match(costs, /title="Costs"/);
  assert.match(costs, /label="Configured monthly amount"/);
  assert.match(productCosts, /label="Cost coverage"/);
  assert.match(productCosts, /label="Products missing costs"/);
  assert.doesNotMatch(costs, /<h1[^>]*>Setup<\/h1>/);
});

test("Location Net Sales trend reconciles to the headline after order-level cash refunds", () => {
  const productSalesRows = [
    { period: "2026-07-01", revenue: 600, ordersCount: 6, unitsSold: 8 },
    { period: "2026-07-02", revenue: 400, ordersCount: 4, unitsSold: 5 },
  ];
  const trendRows = reconcileTrendRowsWithCashRefunds({
    rows: productSalesRows,
    refundTransactions: [
      { amount: 60, processed_at: "2026-07-01T15:00:00.000Z" },
      { amount: 40, processed_at: "2026-07-02T15:00:00.000Z" },
    ],
    merchandiseReturns: 20,
    getTransactionPeriod: (processedAt) => processedAt.slice(0, 10),
  });
  const trendTotal = trendRows.reduce((sum, row) => sum + row.revenue, 0);
  const headlineNetSales = calculateNetSalesAfterCashRefunds({
    lineNetSales: 1000,
    merchandiseReturns: 20,
    totalRefunds: 100,
  });

  assert.equal(trendTotal, 920);
  assert.equal(trendTotal, headlineNetSales);
  assert.deepEqual(
    trendRows.map((row) => row.revenue),
    [552, 368],
  );
});

test("Vendor and Staff breakdowns honestly retain product sales without refund allocation", () => {
  const locationRoute = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );
  const productSales = [600, 400].reduce((sum, amount) => sum + amount, 0);
  const headlineNetSales = calculateNetSalesAfterCashRefunds({
    lineNetSales: productSales,
    merchandiseReturns: 20,
    totalRefunds: 100,
  });

  assert.equal(productSales, 1000);
  assert.equal(headlineNetSales, 920);
  assert.match(locationRoute, /Product sales by vendor/);
  assert.match(locationRoute, /Product sales by staff/);
  assert.match(
    locationRoute,
    /exclude[\s\n]+order-level cash refunds, which cannot be assigned reliably/,
  );
});

test("ranked breakdown keeps seven named rows and reconciles the rest as Others", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    label: `Vendor ${index + 1}`,
    value: `vendor-${index + 1}`,
    revenue: 100 - index,
    ordersCount: 1,
    unitsSold: 1,
    percent: 10,
  }));
  const limitedRows = limitRankedBreakdownRows(rows);

  assert.equal(limitedRows.length, 8);
  assert.deepEqual(
    limitedRows.slice(0, 7).map((row) => row.label),
    rows.slice(0, 7).map((row) => row.label),
  );
  assert.deepEqual(limitedRows.at(-1), {
    label: "Others",
    value: "Others",
    revenue: 100 - 7 + (100 - 8) + (100 - 9),
    ordersCount: 3,
    unitsSold: 3,
    percent: 30,
  });
});

test("primary filter reset key changes only with applied dashboard dimensions", () => {
  const base = {
    startDate: "2026-07-01",
    endDate: "2026-07-26",
    period: "day",
    locationIds: ["location-b", "location-a"],
    staff: "",
    vendor: "",
  };
  const baseKey = buildDrilldownResetKey(base);

  assert.equal(
    baseKey,
    buildDrilldownResetKey({
      ...base,
      locationIds: ["location-a", "location-b"],
    }),
  );

  for (const changed of [
    { ...base, startDate: "2026-07-02" },
    { ...base, endDate: "2026-07-25" },
    { ...base, period: "week" },
    { ...base, locationIds: ["location-a"] },
    { ...base, staff: "staff-1" },
    { ...base, vendor: "Vendor A" },
  ]) {
    assert.notEqual(baseKey, buildDrilldownResetKey(changed));
  }

  for (const relativePath of [
    "../app/routes/app.db-dashboard.tsx",
    "../app/routes/app.locations.tsx",
  ]) {
    const route = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(route, /buildDrilldownResetKey/);
    assert.match(route, /useEffect\(\(\) => \{[\s\S]*?setActiveDrilldowns\(/);
  }
});

test("customer data request audit details never retain raw customer contact values", () => {
  const details = getSafeCustomerRequestDetails({
    customer: {
      id: "customer-1",
      email: "customer@example.com",
      phone: "+1-555-0100",
    },
    orders_requested: [101, 102],
    data_request: { id: 999 },
  });

  assert.deepEqual(details, {
    dataRequestId: "999",
    customerIdPresent: true,
    customerEmailPresent: true,
    customerPhonePresent: true,
    ordersRequestedCount: 2,
  });
  assert.doesNotMatch(JSON.stringify(details), /customer@example\.com|555-0100/);

  const route = readFileSync(
    new URL("../app/routes/webhooks.customers.data_request.tsx", import.meta.url),
    "utf8",
  );
  assert.match(route, /status:\s*"received"/);
  assert.match(route, /pending_merchant_delivery/);
  assert.doesNotMatch(route, /status:\s*"completed"/);
});

test("minimal completed and failed compliance events remain recordable after shop deletion", async () => {
  const migration = readFileSync(
    new URL(
      "../supabase/legacy-migrations/pre-baseline-20260802/20260601_add_compliance_webhook_events.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const insertedRows = [];
  const supabase = {
    from(table) {
      assert.equal(table, "compliance_webhook_events");
      return {
        async insert(row) {
          insertedRows.push(row);
          return { error: null };
        },
      };
    },
  };

  assert.equal(/references\s+public\.shops/i.test(migration), false);
  assert.equal(/foreign\s+key/i.test(migration), false);
  await recordComplianceWebhookEvent({
    supabase,
    shop,
    topic: "shop/redact",
    status: "completed",
    details: { deleted: true },
  });
  await recordComplianceWebhookEvent({
    supabase,
    shop,
    topic: "shop/redact",
    status: "failed",
    details: { retryable: true },
  });

  assert.deepEqual(
    insertedRows.map((row) => ({
      shop_domain: row.shop_domain,
      topic: row.topic,
      status: row.status,
    })),
    [
      { shop_domain: shop, topic: "shop/redact", status: "completed" },
      { shop_domain: shop, topic: "shop/redact", status: "failed" },
    ],
  );
  assert.equal(
    SHOP_REDACTION_TABLES.includes("compliance_webhook_events"),
    false,
  );
});

test("hourly aggregation always returns 24 store-day buckets and counts distinct Shopify orders", () => {
  const rows = computeHourlySalesRows(
    [
      {
        created_at_shopify: "2026-07-10T14:05:00.000Z",
        shopify_order_id: "order-a",
        revenue: 20,
        quantity: 1,
      },
      {
        created_at_shopify: "2026-07-10T14:25:00.000Z",
        shopify_order_id: "order-a",
        revenue: 30,
        quantity: 2,
      },
      {
        created_at_shopify: "2026-07-10T14:45:00.000Z",
        shopify_order_id: "order-b",
        revenue: 40,
        quantity: 1,
      },
    ],
    "America/Toronto",
  );
  const populatedRow = rows.find((row) => row.revenue === 90);

  assert.equal(rows.length, 24);
  assert.deepEqual(
    rows.map((row) => row.hour),
    Array.from({ length: 24 }, (_, hour) => hour),
  );
  assert.ok(populatedRow);
  assert.equal(populatedRow.ordersCount, 2);
  assert.equal(populatedRow.unitsSold, 4);
  assert.equal(
    rows
      .filter((row) => row.hour !== populatedRow.hour)
      .every(
        (row) =>
          row.revenue === 0 && row.ordersCount === 0 && row.unitsSold === 0,
      ),
    true,
  );

  const dashboardMetrics = readFileSync(
    new URL("../app/lib/dashboard/dashboard-metrics.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    dashboardMetrics,
    /return computeHourlySalesRows\(orderLines, STORE_TIME_ZONE\)/,
  );
});

test("an empty store day preserves every zero-value hour from 00:00 through 23:00", () => {
  const rows = computeHourlySalesRows([], "America/Toronto");

  assert.equal(rows.length, 24);
  assert.equal(rows[0].hour, 0);
  assert.equal(rows[23].hour, 23);
  assert.equal(
    rows.every(
      (row) =>
        row.revenue === 0 && row.ordersCount === 0 && row.unitsSold === 0,
    ),
    true,
  );
});

test("chart display helpers separate currency, integer, period, and zero states", () => {
  assert.equal(
    hasMirrorChartActivity([
      { sales: 0, orders: 0 },
      { sales: 0, orders: 0 },
    ]),
    false,
  );
  assert.equal(
    hasMirrorChartActivity([
      { sales: 0, orders: 0 },
      { sales: 0, orders: 2 },
    ]),
    true,
  );
  assert.equal(hasMirrorChartActivity([{ sales: 100, orders: 0 }]), true);
  assert.equal(
    formatNonZeroCurrencyLabel(367).replaceAll("\u00a0", " "),
    "367 $",
  );
  assert.equal(formatNonZeroCurrencyLabel(0), "");
  assert.equal(formatNonZeroIntegerLabel(7), "7");
  assert.equal(formatNonZeroIntegerLabel(0), "");
  assert.equal(formatTrendPeriodLabel("2026-07-01", "day"), "1 juill.");
  assert.equal(formatTrendPeriodLabel("2026-W27", "week"), "W27");
  assert.equal(formatTrendPeriodLabel("2026-07", "month"), "juill. 2026");
  assert.equal(formatTrendPeriodLabel("2026", "year"), "2026");
});

test("shared mirrored charts use separate synchronized sales and order plots", () => {
  const locationRoute = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );
  const hourlyChart = readFileSync(
    new URL("../app/components/dashboard/SalesByHourCard.tsx", import.meta.url),
    "utf8",
  );
  const trendChart = readFileSync(
    new URL(
      "../app/components/dashboard/NetSalesTrendPlot.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const mirrorChart = readFileSync(
    new URL(
      "../app/components/dashboard/MirrorSalesChart.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const sectionCard = readFileSync(
    new URL("../app/components/dashboard/SectionCard.tsx", import.meta.url),
    "utf8",
  );
  const sharedChart = readFileSync(
    new URL("../app/components/dashboard/ShopOpsChart.tsx", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const packageLock = readFileSync(
    new URL("../package-lock.json", import.meta.url),
    "utf8",
  );
  const trendSection = locationRoute.slice(
    locationRoute.indexOf("function TrendChart"),
    locationRoute.indexOf("function LocationTable"),
  );
  const staffSection = locationRoute.slice(
    locationRoute.indexOf("function StaffLeaderboard"),
    locationRoute.indexOf("function RevenueByVendorCard"),
  );
  const mirrorPlots =
    mirrorChart.match(/<BarChart\b[\s\S]*?<\/BarChart>/g) ?? [];

  assert.equal(locationRoute.includes("conic-gradient"), false);
  assert.equal(locationRoute.includes("breakdownColors"), false);
  assert.match(locationRoute, /Net sales trend/);
  assert.match(locationRoute, /LOCATION_CHART_CARD_STYLE/);
  assert.match(locationRoute, /LOCATION_CHART_EMPTY_STYLE/);
  assert.match(locationRoute, /shopops-vendor-bars/);
  assert.match(locationRoute, /shopops-staff-leaderboard/);
  assert.notEqual(
    locationRoute.indexOf("function RankedBreakdownBars"),
    locationRoute.indexOf("function StaffLeaderboard"),
  );
  assert.equal(locationRoute.includes('from "recharts"'), false);

  assert.match(trendSection, /role="radiogroup"/);
  assert.match(trendSection, /aria-label="Group by"/);
  assert.match(trendSection, /type="radio"/);
  assert.match(trendSection, /form="locations-filter-form"/);
  assert.match(trendSection, /name="period"/);
  assert.match(trendSection, /defaultChecked=\{period === option\.value\}/);
  assert.match(trendSection, /onChange=\{onFilterChange\}/);
  assert.match(trendSection, /PERIOD_OPTIONS\.map/);
  assert.match(locationRoute, /\{ value: "day", label: "Day" \}/);
  assert.match(locationRoute, /\{ value: "week", label: "Week" \}/);
  assert.match(locationRoute, /\{ value: "month", label: "Month" \}/);
  assert.match(locationRoute, /\{ value: "year", label: "Year" \}/);
  assert.match(trendSection, /overflowX: "auto"/);
  assert.doesNotMatch(trendSection, /<select/);
  assert.doesNotMatch(trendSection, /<option/);

  assert.match(staffSection, /<table/);
  assert.match(staffSection, /<colgroup>/);
  assert.match(staffSection, /<thead>/);
  assert.match(staffSection, /<tbody>/);
  assert.match(staffSection, /scope="col"/);
  assert.match(staffSection, /\["Rank", "Staff", revenueLabel, "Orders"\]/);
  assert.match(staffSection, /tableLayout: "fixed"/);
  assert.match(staffSection, /fontVariantNumeric: "tabular-nums"/);
  assert.match(staffSection, /textAlign: "right"/);
  assert.match(staffSection, /aria-pressed=\{isSelected\}/);
  assert.match(staffSection, /onClick=\{\(\) => onSelect\?\.\(row\)\}/);
  assert.match(staffSection, /borderLeft: `3px solid/);
  assert.match(staffSection, /title=\{row\.label\}/);
  assert.doesNotMatch(staffSection, /<ol/);
  assert.doesNotMatch(staffSection, /maxRevenue/);
  assert.doesNotMatch(staffSection, /gridColumn: "2 \/ -1"/);
  assert.doesNotMatch(staffSection, /width: `\$\{width\}%`/);

  assert.match(hourlyChart, /Hourly product sales/);
  assert.match(hourlyChart, /Product sales/);
  assert.match(hourlyChart, /MirrorSalesChart/);
  assert.match(hourlyChart, /sales: row\.revenue/);
  assert.match(hourlyChart, /orders: row\.ordersCount/);
  assert.match(hourlyChart, /unitsSold: row\.unitsSold/);
  assert.match(hourlyChart, /Array\.from\(\{ length: 24 \}/);
  assert.match(hourlyChart, /maximumTickLabels=\{8\}/);
  assert.match(hourlyChart, /distinct Orders below/);
  assert.match(hourlyChart, /labelMode="always"/);
  assert.match(hourlyChart, /tooltipBucketLabel="Hour"/);
  assert.match(hourlyChart, /onSelectHour\?\.\(rows\[index\]\.hour\)/);
  assert.doesNotMatch(hourlyChart, /from "recharts"/);
  assert.doesNotMatch(hourlyChart, /<button/);

  assert.match(trendChart, /revenueLabel/);
  assert.match(trendChart, /MirrorSalesChart/);
  assert.match(trendChart, /sales: row\.revenue/);
  assert.match(trendChart, /orders: row\.ordersCount/);
  assert.match(trendChart, /unitsSold: row\.unitsSold/);
  assert.match(trendChart, /tooltipBucketLabel="Period"/);
  assert.match(trendChart, /labelMode="always"/);
  assert.match(trendChart, /onSelectPeriod\?\.\(rows\[index\]\)/);
  assert.doesNotMatch(trendChart, /from "recharts"/);
  assert.doesNotMatch(trendChart, /<button/);

  assert.match(mirrorChart, /export function MirrorSalesChart/);
  assert.equal((mirrorChart.match(/<ResponsiveContainer\b/g) ?? []).length, 2);
  assert.equal(mirrorPlots.length, 2);
  assert.equal((mirrorChart.match(/<Bar\b/g) ?? []).length, 2);
  assert.equal((mirrorChart.match(/data=\{chartData\}/g) ?? []).length, 2);
  assert.match(
    mirrorChart,
    /const chartData = points\.map\(\(point, index\) => \(\{/,
  );
  assert.match(mirrorChart, /\.\.\.point/);
  assert.match(mirrorPlots[0], /dataKey="sales"/);
  assert.doesNotMatch(mirrorPlots[0], /dataKey="orders"/);
  assert.match(mirrorPlots[1], /dataKey="orders"/);
  assert.doesNotMatch(mirrorPlots[1], /dataKey="sales"/);
  assert.equal((mirrorChart.match(/syncId=\{syncId\}/g) ?? []).length, 2);
  assert.equal((mirrorChart.match(/syncMethod="index"/g) ?? []).length, 2);
  assert.match(mirrorPlots[0], /CartesianGrid/);
  assert.doesNotMatch(mirrorPlots[1], /CartesianGrid/);
  assert.match(mirrorPlots[0], /tickFormatter=\{formatCurrencyAxis\}/);
  assert.doesNotMatch(mirrorPlots[1], /formatCurrencyAxis/);
  assert.match(mirrorPlots[1], /reversed/);
  assert.match(mirrorPlots[1], /tick=\{false\}/);
  assert.match(mirrorPlots[0], /dataKey="salesLabel"/);
  assert.match(mirrorPlots[1], /dataKey="ordersLabel"/);
  assert.match(mirrorChart, /formatNonZeroCurrencyLabel/);
  assert.match(mirrorChart, /formatNonZeroIntegerLabel/);
  assert.equal((mirrorChart.match(/<XAxis\b/g) ?? []).length, 2);
  assert.match(mirrorPlots[0], /<XAxis[^>]*hide/);
  assert.doesNotMatch(mirrorPlots[1], /<XAxis[^>]*hide/);
  assert.doesNotMatch(mirrorChart, /stackId=/);
  assert.doesNotMatch(mirrorChart, /upperMirror|lowerMirror/);
  assert.doesNotMatch(mirrorChart, /buildMirrorChartScale/);
  assert.doesNotMatch(mirrorChart, /maximumOrders|point\.orders\s*\//);
  assert.doesNotMatch(mirrorChart, /ComposedChart/);
  assert.doesNotMatch(mirrorChart, /<Line\b/);
  assert.doesNotMatch(mirrorChart, /<Area\b/);
  assert.doesNotMatch(mirrorChart, /minPointSize/);
  assert.equal((mirrorChart.match(/<LabelList\b/g) ?? []).length, 2);
  assert.doesNotMatch(mirrorChart, /<button/);
  assert.match(mirrorChart, /CartesianGrid/);
  assert.match(mirrorChart, /ReferenceArea/);
  assert.match(mirrorChart, /shopops-mirror-sales-chart__baseline/);
  assert.match(mirrorChart, /ShopOpsChartTooltip/);
  assert.match(mirrorChart, /ShopOpsChartEmptyState/);
  assert.match(mirrorChart, /hasMirrorChartActivity/);
  assert.match(
    mirrorChart,
    /labelMode\?: "always" \| "density-aware" \| "none"/,
  );
  assert.match(mirrorChart, /labelMode === "always"/);
  assert.match(mirrorChart, /labelMode === "density-aware"/);
  assert.match(mirrorChart, /labelMode !== "none"/);
  assert.doesNotMatch(mirrorChart, /showDensityAwareLabels/);
  assert.doesNotMatch(mirrorChart, /showPermanentLabels/);
  assert.match(mirrorChart, /points\.length <= 12/);
  assert.match(mirrorChart, /points\.length > 12/);
  assert.match(mirrorChart, /index === hoveredIndex/);
  assert.match(mirrorChart, /index === focusedIndex/);
  assert.match(mirrorChart, /index === selectedIndex/);
  assert.match(mirrorChart, /showLabelForIndex\(index\) && point\.sales !== 0/);
  assert.match(
    mirrorChart,
    /showLabelForIndex\(index\) && point\.orders !== 0/,
  );
  assert.match(mirrorChart, /point\.sales !== 0/);
  assert.match(mirrorChart, /point\.orders !== 0/);
  assert.equal(
    (mirrorChart.match(/accessibilityLayer=\{false\}/g) ?? []).length,
    2,
  );
  assert.match(mirrorChart, /onKeyDown=\{handleKeyDown\}/);
  assert.match(mirrorChart, /ArrowRight/);
  assert.match(mirrorChart, /ArrowLeft/);
  assert.match(mirrorChart, /onSelectPoint/);
  assert.match(mirrorChart, /data-selected-key/);
  assert.match(mirrorChart, /aria-live="polite"/);
  assert.match(mirrorChart, /shopops-chart-scroll/);
  assert.ok(
    (mirrorChart.match(/isAnimationActive=\{false\}/g) ?? []).length >= 3,
  );

  assert.match(sectionCard, /borderRadius: 16/);
  assert.equal(sectionCard.includes("minHeight: 420"), false);
  assert.match(sectionCard, /shopops-recharts/);
  assert.match(sectionCard, /shopops-mirror-sales-chart:focus-visible/);
  assert.match(sharedChart, /ShopOpsChartTooltip/);
  assert.match(sharedChart, /ShopOpsChartEmptyState/);
  assert.match(sharedChart, /SHOP_OPS_CHART_MARGIN/);
  assert.match(sharedChart, /SHOP_OPS_GRID_PROPS/);
  assert.match(formatCurrencyAxis(12500), /12,5.*k.*\$/);
  assert.equal(formatIntegerAxis(12.4), "12");
  assert.equal(packageJson.dependencies.recharts, "^3.10.1");
  assert.match(packageLock, /"node_modules\/recharts"/);
});
