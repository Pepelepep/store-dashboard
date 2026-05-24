import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
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
import { AppButton } from "../components/ui/AppButton";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";
import { syncLocations } from "../lib/sync/shopify-sync.server";

type LoaderData = {
  shop: string;
  existingLocationsCount: number;
};

type ActionData = {
  ok: boolean;
  syncedCount?: number;
  error?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  const { count, error } = await supabase
    .from("locations")
    .select("*", { count: "exact", head: true })
    .eq("shop_domain", session.shop);

  if (error) {
    throw new Error(error.message);
  }

  return {
    shop: session.shop,
    existingLocationsCount: count ?? 0,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  try {
    const result = await syncLocations({
      admin,
      shop: session.shop,
      supabase,
      source: "manual_admin_sync",
    });

    return {
      ok: true,
      syncedCount: result.syncedCount,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function SyncLocationsPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const navigation = useNavigation();
  const isSyncing = navigation.state !== "idle";

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
      <Link
        to={`/app/admin/sync${location.search}`}
        style={{ color: "#2563eb", fontWeight: 700, textDecoration: "none" }}
      >
        Back to Data Sync
      </Link>
      <HelperText>Refresh Shopify locations used by dashboard filters and permissions.</HelperText>
      <h1>Sync locations</h1>

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
          <strong>Locations currently in DB:</strong>{" "}
          {loaderData.existingLocationsCount}
        </p>
      </section>

      <Form method="post">
          <AppButton
            type="submit"
            disabled={isSyncing}
          >
            {isSyncing ? "Refreshing locations..." : "Refresh locations"}
          </AppButton>
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
              <InlineResult variant="success">
                Locations sync completed.
              </InlineResult>
              <p>
                Synced <strong>{actionData.syncedCount}</strong> locations.
              </p>
            </div>
          ) : (
            <InlineResult variant="error">
              {actionData.error ?? "Location sync failed."}
            </InlineResult>
          )}
        </section>
      ) : null}
    </main>
  );
}
