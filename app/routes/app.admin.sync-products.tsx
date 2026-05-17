import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";

type ProductNode = {
  id: string;
  title: string;
  vendor?: string | null;
  productType?: string | null;
  status?: string | null;
  variants: {
    edges: {
      node: {
        id: string;
        title: string;
        sku?: string | null;
        price?: string | null;
        inventoryItem?: {
          id: string;
          unitCost?: {
            amount: string;
            currencyCode: string;
          } | null;
        } | null;
      };
    }[];
  };
};

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

  const response = await admin.graphql(`#graphql
    query getProductsForSync {
      products(first: 100) {
        edges {
          node {
            id
            title
            vendor
            productType
            status
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryItem {
                    id
                    unitCost {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();

  if (data.errors) {
    return {
      ok: false,
      error: JSON.stringify(data.errors),
    };
  }

  const products: ProductNode[] =
    data.data?.products?.edges?.map(
      (edge: { node: ProductNode }) => edge.node,
    ) ?? [];

  const productRows = products.map((product) => ({
    shop_domain: session.shop,
    shopify_product_id: product.id,
    title: product.title,
    vendor: product.vendor ?? null,
    product_type: product.productType ?? null,
    status: product.status ?? null,
    updated_at: new Date().toISOString(),
  }));

  const variantRows = products.flatMap((product) =>
    product.variants.edges.map(({ node: variant }) => ({
      shop_domain: session.shop,
      shopify_variant_id: variant.id,
      shopify_product_id: product.id,
      inventory_item_id: variant.inventoryItem?.id ?? null,
      title: variant.title,
      sku: variant.sku ?? null,
      price: variant.price ? Number(variant.price) : null,
      unit_cost: variant.inventoryItem?.unitCost?.amount
        ? Number(variant.inventoryItem.unitCost.amount)
        : null,
      updated_at: new Date().toISOString(),
    })),
  );

  if (productRows.length > 0) {
    const { error } = await supabase.from("products").upsert(productRows, {
      onConflict: "shop_domain,shopify_product_id",
    });

    if (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }

  if (variantRows.length > 0) {
    const { error } = await supabase.from("variants").upsert(variantRows, {
      onConflict: "shop_domain,shopify_variant_id",
    });

    if (error) {
      return {
        ok: false,
        error: error.message,
      };
    }
  }

  await supabase.from("sync_runs").insert({
    shop_domain: session.shop,
    sync_type: "products",
    status: "success",
    finished_at: new Date().toISOString(),
  });

  return {
    ok: true,
    productsSynced: productRows.length,
    variantsSynced: variantRows.length,
  };
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