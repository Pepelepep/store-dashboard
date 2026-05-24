import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { syncOrders } from "../lib/sync/shopify-sync.server";
import { AppButton } from "../components/ui/AppButton";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";

type LoaderData = {
  shop: string;
  ordersCount: number;
  orderLinesCount: number;
};

type ActionData = {
  ok: boolean;
  ordersSynced?: number;
  orderLinesSynced?: number;
  pagesProcessed?: number;
  error?: string;
};

function getOrderDateRangeFromForm(formData: FormData) {
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim();

  return {
    startDate: startDate || null,
    endDate: endDate || null,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  const [{ count: ordersCount }, { count: orderLinesCount }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop),
      supabase
        .from("order_lines")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop),
    ]);

  return {
    shop: session.shop,
    ordersCount: ordersCount ?? 0,
    orderLinesCount: orderLinesCount ?? 0,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  try {
    await assertAdminAccess({ request, session, supabase });
  } catch (error) {
    if (error instanceof Response && error.status === 403) {
      return data(
        {
          ok: false,
          error: "Forbidden: admin access required",
        } satisfies ActionData,
        { status: 403 },
      );
    }

    throw error;
  }

  const formData = await request.formData();
  const { startDate, endDate } = getOrderDateRangeFromForm(formData);

  try {
    const result = await syncOrders({
      admin,
      shop: session.shop,
      supabase,
      source: "manual_admin_sync",
      startDate,
      endDate,
    });

    return {
      ok: true,
      ordersSynced: result.ordersSynced,
      orderLinesSynced: result.orderLinesSynced,
      pagesProcessed: result.pagesProcessed,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function SyncOrdersPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const navigation = useNavigation();
  const isSyncing = navigation.state !== "idle";

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
      <div style={{ marginBottom: 20 }}>
        <Link
          to={`/app/admin/sync${location.search}`}
          style={{ color: "#2563eb", fontWeight: 700, textDecoration: "none" }}
        >
          Back to Data Sync
        </Link>
        <h1 style={{ marginBottom: 8 }}>Sync orders & order lines</h1>
        <HelperText>
          Refresh Shopify orders and order lines for the selected date range.
        </HelperText>
      </div>

      <section
        style={{
          background: "white",
          border: "1px solid #e3e3e3",
          borderRadius: 14,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <p>
          <strong>Shop:</strong> {loaderData.shop}
        </p>
        <p>
          <strong>Orders currently in DB:</strong> {loaderData.ordersCount}
        </p>
        <p>
          <strong>Order lines currently in DB:</strong>{" "}
          {loaderData.orderLinesCount}
        </p>
      </section>

      <section
        style={{
          background: "#fff8e5",
          border: "1px solid #f1c96b",
          borderRadius: 14,
          padding: 16,
          marginBottom: 20,
          color: "#5f4200",
        }}
      >
        This sync paginates through all accessible Shopify orders and order
        lines. Use the optional date range for faster incremental syncs.
      </section>

      <Form method="post">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "180px 180px auto",
            gap: 12,
            alignItems: "end",
            marginBottom: 16,
          }}
        >
          <div>
            <label
              htmlFor="startDate"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Start date optional
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 10,
                border: "1px solid #c9c9c9",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="endDate"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              End date optional
            </label>
            <input
              id="endDate"
              name="endDate"
              type="date"
              style={{
                width: "100%",
                padding: "9px 10px",
                borderRadius: 10,
                border: "1px solid #c9c9c9",
              }}
            />
          </div>

          <AppButton
            type="submit"
            disabled={isSyncing}
          >
            {isSyncing ? "Refreshing orders..." : "Refresh orders"}
          </AppButton>
        </div>
      </Form>

      {actionData ? (
        <section
          style={{
            marginTop: 20,
            background: actionData.ok ? "#e8f5e9" : "#fff4f4",
            border: actionData.ok ? "1px solid #b7dfb9" : "1px solid #f2b8b5",
            borderRadius: 14,
            padding: 20,
          }}
        >
          {actionData.ok ? (
            <div>
              <InlineResult variant="success">Orders sync completed.</InlineResult>
              <p>
                Processed <strong>{actionData.pagesProcessed}</strong> order
                pages.
              </p>
              <p>
                Synced <strong>{actionData.ordersSynced}</strong> orders.
              </p>
              <p>
                Synced <strong>{actionData.orderLinesSynced}</strong> order
                lines.
              </p>
            </div>
          ) : (
            <InlineResult variant="error">
              {actionData.error ?? "Orders sync failed."}
            </InlineResult>
          )}
        </section>
      ) : null}
    </main>
  );
}
