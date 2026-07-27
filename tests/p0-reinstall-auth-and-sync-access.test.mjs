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

  assert.equal(calculateRemainingLineCogs({
    quantity: 1,
    returned_quantity: 1,
  }), 0);
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
  assert.ok(appRoute.indexOf("Profit Dashboard") < appRoute.indexOf("Location Performance"));
  assert.ok(appRoute.indexOf("Location Performance") < appRoute.indexOf(">Setup<"));
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
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC`),
    );
    assert.match(
      migration,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO service_role`),
    );
  }

  assert.match(
    migration,
    /order_line\.cost_at_sale,[\s\S]*?variant\.unit_cost,[\s\S]*?order_line\.cost_source IS DISTINCT FROM[\s\S]*?'SHOP_PERCENT_ESTIMATE'[\s\S]*?order_line\.unit_cost/,
  );
});

test("product-cost save disables and reports pending recalculation", () => {
  const component = readFileSync(
    new URL(
      "../app/components/setup/ProductCostsSetup.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(component, /useNavigation/);
  assert.match(
    component,
    /navigation\.formData\?\.get\("intent"\) === "save-product-costs"/,
  );
  assert.match(component, /disabled=\{[\s\S]*?isSaving[\s\S]*?!settingsChanged/);
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
    new URL(
      "../app/components/setup/ProductCostsSetup.tsx",
      import.meta.url,
    ),
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
  assert.match(component, /Profit remains unavailable while relevant product costs are/);
});

test("missing-product table uses a bounded fetcher with pagination", () => {
  const component = readFileSync(
    new URL(
      "../app/components/setup/ProductCostsSetup.tsx",
      import.meta.url,
    ),
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
  const detailsStart = dashboardCards.indexOf("{isFinancialMetricsV2 ? (", netProfitStart);
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
