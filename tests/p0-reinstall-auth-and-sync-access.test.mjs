import assert from "node:assert/strict";
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
      offlineContext("revoked-token", async () => new Response(null, { status: 401 })),
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
        return new Response(JSON.stringify({ data: { shop: { name: "QA" } } }), {
          status: 200,
        });
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
    `/app/admin/sync${search}`,
  );
  assert.equal(getDataSyncPath("host=encoded-host"), "/app/admin/sync?host=encoded-host");
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
  assert.equal(
    result.latestUnresolvedFailureAt,
    "2026-07-25T11:01:00.000Z",
  );
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
