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
  recordComplianceWebhookEvent,
  SHOP_REDACTION_TABLES,
} from "../app/lib/compliance/compliance-webhooks.server.ts";
import { validateExpenseMonthRange } from "../app/lib/financial/expense-validation.ts";
import { getRecentOrderChips } from "../app/lib/dashboard/recent-order-flags.ts";
import {
  getAccessibleLocationRows,
  hasNoAssignedLocationAccess,
} from "../app/lib/auth/location-performance-access.ts";
import { buildDrilldownResetKey } from "../app/lib/dashboard/drilldown-reset-key.ts";
import { reconcileTrendRowsWithCashRefunds } from "../app/lib/dashboard/location-trend-reconciliation.ts";
import { limitRankedBreakdownRows } from "../app/lib/dashboard/ranked-breakdown.ts";
import {
  formatCurrencyAxis,
  formatIntegerAxis,
} from "../app/lib/dashboard/chart-formatters.ts";
import { computeHourlySalesRows } from "../app/lib/dashboard/hourly-sales.ts";

const shop = "shopops-fresh-qa.myshopify.com";

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

  assert.equal(getDataSyncPath(search), `/app/admin/sync${search}`);
  assert.equal(
    getDataSyncPath("host=encoded-host"),
    "/app/admin/sync?host=encoded-host",
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
      "../supabase/migrations/20260726120000_add_shop_cogs_estimates.sql",
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

test("Setup remains admin-only and navigation order is stable", () => {
  const setupRoute = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );
  const appRoute = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );

  assert.match(setupRoute, /assertAdminAccess/);
  assert.ok(
    appRoute.indexOf("Profit Dashboard") <
      appRoute.indexOf("Location Performance"),
  );
  assert.ok(
    appRoute.indexOf("Location Performance") < appRoute.indexOf(">Setup<"),
  );
  assert.ok(appRoute.indexOf(">Setup<") < appRoute.indexOf(">Staff<"));
  assert.ok(appRoute.indexOf(">Staff<") < appRoute.indexOf(">Data sync<"));
});

test("COGS recompute functions and settings update are service-role-only", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260726120000_add_shop_cogs_estimates.sql",
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

test("Setup defaults to Expenses with equal-width segmented navigation", () => {
  const setupRoute = readFileSync(
    new URL("../app/routes/app.admin.setup.tsx", import.meta.url),
    "utf8",
  );
  const expensesIndex = setupRoute.indexOf(
    '{ value: "expenses" as const, label: "Expenses" }',
  );
  const productCostsIndex = setupRoute.indexOf(
    '{ value: "product-costs" as const, label: "Product costs" }',
  );

  assert.ok(expensesIndex >= 0);
  assert.ok(expensesIndex < productCostsIndex);
  assert.match(
    setupRoute,
    /get\("tab"\) === "product-costs"[\s\S]*?\? "product-costs"[\s\S]*?: "expenses"/,
  );
  assert.match(
    setupRoute,
    /gridTemplateColumns: "repeat\(2, minmax\(0, 1fr\)\)"/,
  );
  assert.match(setupRoute, /className="setup-segmented-control"/);
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
      "../supabase/migrations/20260727120000_add_product_cost_setup_aggregation.sql",
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
      "../supabase/migrations/20260727120000_add_product_cost_setup_aggregation.sql",
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

  assert.match(component, /className="cost-method-options"/);
  assert.match(
    component,
    /gridTemplateColumns: "repeat\(2, minmax\(0, 1fr\)\)"/,
  );
  assert.match(component, /title: "Shopify costs only"/);
  assert.match(component, /title: "Estimate missing costs"/);
  assert.match(
    component,
    /\{enabled \? \([\s\S]*?<h2 style=\{\{ marginTop: 0 \}\}>Estimated impact preview/,
  );
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
  assert.match(resourceRoute, /assertAdminAccess/);
  assert.match(resourceRoute, /loadMissingProductCostsPage/);
});

test("dashboard notices live only in their relevant profit KPI cards", () => {
  const dashboardCards = readFileSync(
    new URL("../app/components/dashboard/KpiCards.tsx", import.meta.url),
    "utf8",
  );
  const grossProfitStart = dashboardCards.indexOf('title="Gross profit"');
  const grossMarginStart = dashboardCards.indexOf('title="Gross margin"');
  const expensesStart = dashboardCards.indexOf('title="Expenses"');
  const netProfitStart = dashboardCards.indexOf('title="Net profit"');
  const detailsStart = dashboardCards.indexOf(
    "{isFinancialMetricsV2 ? (",
    netProfitStart,
  );
  const grossMarginSection = dashboardCards.slice(
    grossMarginStart,
    expensesStart,
  );
  const netProfitSection = dashboardCards.slice(netProfitStart, detailsStart);

  assert.ok(grossProfitStart >= 0);
  assert.match(dashboardCards, /sales[\s\S]*?missing[\s\n]+product costs\./);
  assert.equal(
    dashboardCards.match(/Includes estimated product costs/g)?.length,
    1,
  );
  assert.equal(grossMarginSection.includes("Review product costs"), false);
  assert.equal(
    grossMarginSection.includes("Includes estimated product costs"),
    false,
  );
  assert.match(netProfitSection, /No operating expenses configured\./);
  assert.match(netProfitSection, /Add expenses/);
});

test("old expense route redirects to the Setup expenses tab with context", () => {
  const oldExpenseRoute = readFileSync(
    new URL("../app/routes/app.admin.expenses.tsx", import.meta.url),
    "utf8",
  );

  assert.match(oldExpenseRoute, /new URLSearchParams\(url\.searchParams\)/);
  assert.match(oldExpenseRoute, /searchParams\.set\("tab", "expenses"\)/);
  assert.match(
    oldExpenseRoute,
    /redirect\(`\/app\/admin\/setup\?\$\{searchParams\.toString\(\)\}`\)/,
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

  for (const label of [
    "Net Sales",
    "COGS",
    "Gross profit",
    "Gross margin",
    "Expenses",
    "Net profit",
  ]) {
    assert.match(locationRoute, new RegExp(`label: "${label}"`));
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

test("marketplace identity is exact and Billing behavior remains unchanged", () => {
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
  assert.match(billing, /BILLING_TEST_SHOPS/);
  assert.match(billing, /price: "\$59\.99\/month"/);
  assert.match(billing, /trialDays: 14/);
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

test("Location Performance applies Team Access for admin, manager, viewer, and no-location users", () => {
  const locations = [
    { shopify_location_id: "location-a", name: "A" },
    { shopify_location_id: "location-b", name: "B" },
    { shopify_location_id: "location-c", name: "C" },
  ];

  const adminRows = getAccessibleLocationRows({
    locations,
    isAdmin: true,
    allowedLocationIds: new Set(),
  });
  const managerRows = getAccessibleLocationRows({
    locations,
    isAdmin: false,
    allowedLocationIds: new Set(["location-a", "location-c"]),
  });
  const viewerRows = getAccessibleLocationRows({
    locations,
    isAdmin: false,
    allowedLocationIds: new Set(["location-b"]),
  });
  const noLocationRows = getAccessibleLocationRows({
    locations,
    isAdmin: false,
    allowedLocationIds: new Set(),
  });

  assert.deepEqual(adminRows, locations);
  assert.deepEqual(
    managerRows.map((row) => row.shopify_location_id),
    ["location-a", "location-c"],
  );
  assert.deepEqual(
    viewerRows.map((row) => row.shopify_location_id),
    ["location-b"],
  );
  assert.deepEqual(noLocationRows, []);
  assert.equal(
    hasNoAssignedLocationAccess({
      activeLocationCount: locations.length,
      accessibleLocationCount: noLocationRows.length,
      isAdmin: false,
    }),
    true,
  );

  const locationRoute = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );
  const appShell = readFileSync(
    new URL("../app/routes/app.tsx", import.meta.url),
    "utf8",
  );
  assert.match(locationRoute, /getPermissionContext/);
  assert.equal(locationRoute.includes("assertAdminAccess"), false);
  assert.match(
    appShell,
    /<a href=\{`\/app\/locations\$\{search\}`\}>Location Performance<\/a>/,
  );
  assert.doesNotMatch(
    appShell,
    /\{canAdmin \? \([\s\n]*<a href=\{`\/app\/locations/,
  );
  assert.match(appShell, /\{canAdmin \? <a href=\{setupPath\}>Setup<\/a>/);
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

test("minimal completed and failed compliance events remain recordable after shop deletion", async () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260601_add_compliance_webhook_events.sql",
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

test("premium chart presentation keeps both series, readable axes, and distinct visuals", () => {
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

  assert.equal(locationRoute.includes("conic-gradient"), false);
  assert.equal(locationRoute.includes("breakdownColors"), false);
  assert.match(locationRoute, /Net sales trend/);
  assert.match(locationRoute, /LOCATION_CHART_CARD_STYLE/);
  assert.match(locationRoute, /LOCATION_CHART_EMPTY_STYLE/);
  assert.match(locationRoute, /shopops-vendor-bars/);
  assert.match(locationRoute, /shopops-staff-leaderboard/);
  assert.match(locationRoute, /<ol/);
  assert.match(locationRoute, /Rank/);
  assert.match(locationRoute, /Orders/);
  assert.notEqual(
    locationRoute.indexOf("function RankedBreakdownBars"),
    locationRoute.indexOf("function StaffLeaderboard"),
  );
  assert.equal(locationRoute.includes('from "recharts"'), false);

  assert.match(hourlyChart, /Hourly product sales/);
  assert.match(hourlyChart, /Product sales/);
  assert.match(hourlyChart, /ResponsiveContainer/);
  assert.match(hourlyChart, /ComposedChart/);
  assert.match(hourlyChart, /<Bar/);
  assert.match(hourlyChart, /<Line/);
  assert.match(hourlyChart, /CartesianGrid/);
  assert.match(hourlyChart, /yAxisId="sales"/);
  assert.match(hourlyChart, /yAxisId="orders"/);
  assert.match(hourlyChart, /stroke="#0f766e"/);
  assert.match(hourlyChart, /Units sold/);
  assert.match(hourlyChart, /Array\.from\(\{ length: 24 \}/);
  assert.match(hourlyChart, /interval=\{2\}/);
  assert.doesNotMatch(hourlyChart, /minPointSize/);
  assert.doesNotMatch(hourlyChart, /<svg/);
  assert.match(hourlyChart, /formatCurrencyAxis/);
  assert.match(hourlyChart, /formatIntegerAxis/);
  assert.match(hourlyChart, /ShopOpsChartTooltip/);
  assert.match(hourlyChart, /accessibilityLayer/);
  assert.match(hourlyChart, /shopops-chart-keyboard-controls/);
  assert.match(hourlyChart, /aria-pressed/);
  assert.match(hourlyChart, /shopops-chart-scroll/);
  assert.ok(
    (hourlyChart.match(/isAnimationActive=\{false\}/g) ?? []).length >= 3,
  );

  assert.match(trendChart, /revenueLabel/);
  assert.match(trendChart, /Orders/);
  assert.match(trendChart, /Units sold/);
  assert.match(trendChart, /ResponsiveContainer/);
  assert.match(trendChart, /ComposedChart/);
  assert.match(trendChart, /<Area/);
  assert.ok((trendChart.match(/<Line/g) ?? []).length >= 2);
  assert.match(trendChart, /CartesianGrid/);
  assert.match(trendChart, /formatCurrencyAxis/);
  assert.match(trendChart, /formatIntegerAxis/);
  assert.match(trendChart, /ShopOpsChartTooltip/);
  assert.match(trendChart, /fillOpacity=\{0\.55\}/);
  assert.doesNotMatch(trendChart, /<svg/);
  assert.match(trendChart, /onClick/);
  assert.match(trendChart, /accessibilityLayer/);
  assert.match(trendChart, /shopops-chart-keyboard-controls/);
  assert.match(trendChart, /aria-pressed/);
  assert.match(trendChart, /shopops-chart-scroll/);
  assert.ok(
    (trendChart.match(/isAnimationActive=\{false\}/g) ?? []).length >= 4,
  );

  assert.match(sectionCard, /borderRadius: 18/);
  assert.equal(sectionCard.includes("minHeight: 420"), false);
  assert.match(sectionCard, /shopops-recharts/);
  assert.match(sharedChart, /ShopOpsChartTooltip/);
  assert.match(sharedChart, /ShopOpsChartEmptyState/);
  assert.match(sharedChart, /SHOP_OPS_CHART_MARGIN/);
  assert.match(sharedChart, /SHOP_OPS_GRID_PROPS/);
  assert.match(formatCurrencyAxis(12500), /\$13K|\$12\.5K/);
  assert.equal(formatIntegerAxis(12.4), "12");
  assert.equal(packageJson.dependencies.recharts, "^3.10.1");
  assert.match(packageLock, /"node_modules\/recharts"/);
});
