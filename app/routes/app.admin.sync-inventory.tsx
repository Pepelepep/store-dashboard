import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { syncInventory } from "../lib/sync/shopify-sync.server";
import { AppButton, AppButtonLink } from "../components/ui/AppButton";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";

type LoaderData = {
  shop: string;
  variantsWithInventoryItemCount: number;
  inventoryLevelsCount: number;
};

type ActionData = {
  ok: boolean;
  inventoryItemsProcessed?: number;
  inventoryLevelsSynced?: number;
  error?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  const [{ count: variantsWithInventoryItemCount }, { count: inventoryLevelsCount }] =
    await Promise.all([
      supabase
        .from("variants")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop)
        .not("inventory_item_id", "is", null),
      supabase
        .from("inventory_levels")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop),
    ]);

  return {
    shop: session.shop,
    variantsWithInventoryItemCount: variantsWithInventoryItemCount ?? 0,
    inventoryLevelsCount: inventoryLevelsCount ?? 0,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  try {
    const result = await syncInventory({
      admin,
      shop: session.shop,
      supabase,
      source: "manual_admin_sync",
    });

    return {
      ok: true,
      inventoryItemsProcessed: result.inventoryItemsProcessed,
      inventoryLevelsSynced: result.inventoryLevelsSynced,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function SyncInventoryPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const location = useLocation();
  const navigation = useNavigation();
  const isSyncing = navigation.state !== "idle";

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
      <div style={{ marginBottom: 14 }}>
        <AppButtonLink
          to={`/app/admin/sync${location.search}`}
          variant="secondary"
        >
          ← Back to Data Sync
        </AppButtonLink>
      </div>
      <h1>Sync inventory levels</h1>
      <HelperText>
        Refresh Shopify inventory levels for synced product variants.
      </HelperText>

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
          <strong>Variants with inventory item ID:</strong>{" "}
          {loaderData.variantsWithInventoryItemCount}
        </p>
        <p>
          <strong>Inventory levels currently in DB:</strong>{" "}
          {loaderData.inventoryLevelsCount}
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
        This sync uses inventory_item_id values already stored from the products
        sync, then fetches inventory levels in small batches to avoid Shopify
        GraphQL query cost limits.
      </section>

      <Form method="post">
        <AppButton
          type="submit"
          disabled={isSyncing}
        >
          {isSyncing ? "Refreshing inventory..." : "Refresh inventory"}
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
                Inventory sync completed.
              </InlineResult>
              <p>
                Processed{" "}
                <strong>{actionData.inventoryItemsProcessed}</strong>{" "}
                inventory items.
              </p>
              <p>
                Synced{" "}
                <strong>{actionData.inventoryLevelsSynced}</strong> inventory
                levels.
              </p>
            </div>
          ) : (
            <InlineResult variant="error">
              {actionData.error ?? "Inventory sync failed."}
            </InlineResult>
          )}
        </section>
      ) : null}
    </main>
  );
}
