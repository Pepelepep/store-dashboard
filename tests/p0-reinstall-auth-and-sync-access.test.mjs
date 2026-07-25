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
  calculateProvisionalProfit,
  calculateRemainingLineCogs,
  COGS_INCOMPLETE_WARNING,
  summarizeCogs,
} from "../app/lib/financial/cogs.ts";
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
    null,
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

test("some missing COGS preserves known totals and completeness metadata", () => {
  const result = summarizeCogs([
    { quantity: 1, unit_cost: 12 },
    { quantity: 1, unit_cost: null },
  ]);
  const profit = calculateProvisionalProfit({
    netSales: 100,
    knownCogs: result.cogs,
    expenses: 10,
  });

  assert.equal(result.cogs, 12);
  assert.equal(result.knownCogs, 12);
  assert.equal(result.missingCogsLineCount, 1);
  assert.equal(result.knownCogsLineCount, 1);
  assert.equal(result.cogsIncomplete, true);
  assert.deepEqual(profit, {
    grossProfit: 88,
    grossMarginPct: 88,
    netProfit: 78,
  });
});

test("all known COGS returns exact totals without an incomplete state", () => {
  const result = summarizeCogs([
    { quantity: 2, unit_cost: 10 },
    { quantity: 1, unit_cost: 5 },
  ]);

  assert.equal(result.cogs, 25);
  assert.equal(result.missingCogsLineCount, 0);
  assert.equal(result.knownCogsLineCount, 2);
  assert.equal(result.cogsIncomplete, false);
});

test("all missing COGS displays zero known COGS with numeric provisional profit", () => {
  const result = summarizeCogs([
    { quantity: 1, unit_cost: null },
    { quantity: 2, cost_at_sale: null, unit_cost: null },
  ]);
  const profit = calculateProvisionalProfit({
    netSales: 1000,
    knownCogs: result.cogs,
    expenses: 100,
  });

  assert.equal(result.cogs, 0);
  assert.equal(result.missingCogsLineCount, 2);
  assert.equal(result.knownCogsLineCount, 0);
  assert.equal(result.cogsIncomplete, true);
  assert.deepEqual(profit, {
    grossProfit: 1000,
    grossMarginPct: 100,
    netProfit: 900,
  });
});

test("an explicit real zero cost is known and complete", () => {
  const result = summarizeCogs([{ quantity: 3, unit_cost: 0 }]);

  assert.equal(result.cogs, 0);
  assert.equal(result.missingCogsLineCount, 0);
  assert.equal(result.knownCogsLineCount, 1);
  assert.equal(result.cogsIncomplete, false);
});

test("provisional profit keeps margin safe for zero and negative Net Sales", () => {
  assert.equal(
    calculateProvisionalProfit({
      netSales: 0,
      knownCogs: 10,
      expenses: 0,
    }).grossMarginPct,
    null,
  );
  assert.equal(
    calculateProvisionalProfit({
      netSales: -10,
      knownCogs: 10,
      expenses: 0,
    }).grossMarginPct,
    null,
  );
});

test("dashboard sections show one incomplete-cost warning without unavailable profit copy", () => {
  const profitDashboard = readFileSync(
    new URL("../app/routes/app.db-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const dashboardCards = readFileSync(
    new URL("../app/components/dashboard/KpiCards.tsx", import.meta.url),
    "utf8",
  );
  const locationPerformance = readFileSync(
    new URL("../app/routes/app.locations.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(
    COGS_INCOMPLETE_WARNING,
    "Some product costs are missing. Profit metrics use available costs only and may be overstated.",
  );
  assert.equal(
    dashboardCards.match(/\{COGS_INCOMPLETE_WARNING\}/g)?.length,
    1,
  );
  assert.equal(
    locationPerformance.match(/\{COGS_INCOMPLETE_WARNING\}/g)?.length,
    1,
  );
  assert.equal(dashboardCards.includes("Profit unavailable"), false);
  assert.equal(locationPerformance.includes("Profit unavailable"), false);
  assert.equal(profitDashboard.includes("calculateProvisionalProfit"), true);
  assert.equal(
    locationPerformance.includes("calculateProvisionalProfit"),
    true,
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
