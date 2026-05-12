import { getOfflineAdminClient } from "../lib/shopify/offline-admin.server";
import { runFullSync } from "../lib/sync/shopify-sync.server";

export async function action({ request }: { request: Request }) {
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!expectedSecret) {
    return Response.json(
      {
        ok: false,
        error: "Missing CRON_SECRET env var.",
      },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json(
      {
        ok: false,
        error: "Unauthorized.",
      },
      { status: 401 },
    );
  }

  const shop = process.env.SYNC_SHOP_DOMAIN;

  if (!shop) {
    return Response.json(
      {
        ok: false,
        error: "Missing SYNC_SHOP_DOMAIN env var.",
      },
      { status: 500 },
    );
  }

  const admin = await getOfflineAdminClient(shop);

  const shopResponse = await admin.graphql(`#graphql
    query cronHealthCheck {
      shop {
        name
        myshopifyDomain
      }
    }
  `);

  const shopData = await shopResponse.json();

  if ("errors" in shopData && shopData.errors) {
    return Response.json(
      {
        ok: false,
        step: "shopify_health_check",
        error: shopData.errors,
      },
      { status: 500 },
    );
  }

  const result = await runFullSync({
    admin,
    shop,
    source: "scheduled_daily_sync",
    orderLookbackDays: 7,
  });

  return Response.json(
    {
      ...result,
      shopifyHealthCheck: shopData.data?.shop ?? null,
    },
    {
      status: result.ok ? 200 : 500,
    },
  );
}

export async function loader() {
  return Response.json(
    {
      ok: false,
      error: "Use POST for this endpoint.",
    },
    { status: 405 },
  );
}
