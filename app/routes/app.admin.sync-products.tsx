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
import { syncProducts } from "../lib/sync/shopify-sync.server";
import { AppButton } from "../components/ui/AppButton";
import { HelperText } from "../components/ui/HelperText";
import { InlineResult } from "../components/ui/InlineResult";

type LoaderData = {
  shop: string;
  productsCount: number;
  variantsCount: number;
};

type ActionData = {
  ok: boolean;
  productsSynced?: number;
  variantsSynced?: number;
  error?: string;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await assertAdminAccess({ request, session, supabase });

  const [{ count: productsCount }, { count: variantsCount }] =
    await Promise.all([
      supabase
        .from("products")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop),
      supabase
        .from("variants")
        .select("*", { count: "exact", head: true })
        .eq("shop_domain", session.shop),
    ]);

  return {
    shop: session.shop,
    productsCount: productsCount ?? 0,
    variantsCount: variantsCount ?? 0,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

  await assertAdminAccess({ request, session, supabase });

  try {
    const result = await syncProducts({
      admin,
      shop: session.shop,
      supabase,
      source: "manual_admin_sync",
    });

    return {
      ok: true,
      productsSynced: result.productsSynced,
      variantsSynced: result.variantsSynced,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default function SyncProductsPage() {
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
      <HelperText>
        Refresh Shopify products and variants used by sales and inventory reporting.
      </HelperText>
      <h1>Sync products & variants</h1>

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
          <strong>Products currently in DB:</strong>{" "}
          {loaderData.productsCount}
        </p>
        <p>
          <strong>Variants currently in DB:</strong>{" "}
          {loaderData.variantsCount}
        </p>
      </section>

      <Form method="post">
        <AppButton
          type="submit"
          disabled={isSyncing}
        >
          {isSyncing
            ? "Refreshing products & variants..."
            : "Refresh products & variants"}
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
                Products sync completed.
              </InlineResult>
              <p>
                Synced <strong>{actionData.productsSynced}</strong> products.
              </p>
              <p>
                Synced <strong>{actionData.variantsSynced}</strong> variants.
              </p>
            </div>
          ) : (
            <InlineResult variant="error">
              {actionData.error ?? "Product sync failed."}
            </InlineResult>
          )}
        </section>
      ) : null}
    </main>
  );
}
