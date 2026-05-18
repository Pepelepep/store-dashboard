import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { syncProducts } from "../lib/sync/shopify-sync.server";

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

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
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
        <button
          type="submit"
          style={{
            border: "1px solid #202223",
            background: "#202223",
            color: "white",
            borderRadius: 10,
            padding: "10px 14px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Refresh products & variants
        </button>
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
              <p>
                Synced <strong>{actionData.productsSynced}</strong> products.
              </p>
              <p>
                Synced <strong>{actionData.variantsSynced}</strong> variants.
              </p>
            </div>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>{actionData.error}</pre>
          )}
        </section>
      ) : null}
    </main>
  );
}
