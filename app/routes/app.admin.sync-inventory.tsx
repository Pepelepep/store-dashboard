import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";

type VariantDbRow = {
  shopify_variant_id: string;
  inventory_item_id: string;
  sku: string | null;
};

type InventoryItemNode = {
  id: string;
  sku?: string | null;
  tracked: boolean;
  inventoryLevels: {
    edges: {
      node: {
        location: {
          id: string;
          name: string;
        };
        quantities: {
          name: string;
          quantity: number;
        }[];
      };
    }[];
  };
};

type InventoryGraphqlResponse = {
  data?: {
    nodes?: (InventoryItemNode | null)[];
  };
  errors?: unknown;
};

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

const INVENTORY_BATCH_SIZE = 25;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getAvailableQuantity(level: InventoryItemNode["inventoryLevels"]["edges"][number]["node"]) {
  return (
    level.quantities.find((quantity) => quantity.name === "available")
      ?.quantity ?? 0
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();

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

  const { data: variantRows, error: variantsError } = await supabase
    .from("variants")
    .select("shopify_variant_id, inventory_item_id, sku")
    .eq("shop_domain", session.shop)
    .not("inventory_item_id", "is", null);

  if (variantsError) {
    return {
      ok: false,
      error: variantsError.message,
    };
  }

  const variants = (variantRows ?? []) as VariantDbRow[];

  if (variants.length === 0) {
    return {
      ok: false,
      error:
        "No variants with inventory_item_id found. Run products & variants sync first.",
    };
  }

  const variantByInventoryItemId = new Map<string, VariantDbRow>();

  for (const variant of variants) {
    variantByInventoryItemId.set(variant.inventory_item_id, variant);
  }

  const inventoryItemIds = Array.from(
    new Set(variants.map((variant) => variant.inventory_item_id)),
  );

  const chunks = chunkArray(inventoryItemIds, INVENTORY_BATCH_SIZE);

  let totalInventoryLevelsSynced = 0;
  let totalInventoryItemsProcessed = 0;

  for (const chunk of chunks) {
    const response = await admin.graphql(
      `#graphql
        query getInventoryItemsForSync($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on InventoryItem {
              id
              sku
              tracked
              inventoryLevels(first: 20) {
                edges {
                  node {
                    location {
                      id
                      name
                    }
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          ids: chunk,
        },
      },
    );

    const data = (await response.json()) as InventoryGraphqlResponse;

    if (data.errors) {
      return {
        ok: false,
        error: JSON.stringify(data.errors),
      };
    }

    const inventoryItems = (data.data?.nodes ?? []).filter(
      Boolean,
    ) as InventoryItemNode[];

    const rows = inventoryItems.flatMap((inventoryItem) => {
      const variant = variantByInventoryItemId.get(inventoryItem.id);

      if (!variant) {
        return [];
      }

      return inventoryItem.inventoryLevels.edges.map(({ node: level }) => ({
        shop_domain: session.shop,
        shopify_location_id: level.location.id,
        shopify_variant_id: variant.shopify_variant_id,
        inventory_item_id: inventoryItem.id,
        sku: variant.sku ?? inventoryItem.sku ?? null,
        available: getAvailableQuantity(level),
        tracked: inventoryItem.tracked,
        synced_at: new Date().toISOString(),
      }));
    });

    if (rows.length > 0) {
      const { error } = await supabase.from("inventory_levels").upsert(rows, {
        onConflict: "shop_domain,shopify_location_id,inventory_item_id",
      });

      if (error) {
        return {
          ok: false,
          error: error.message,
        };
      }
    }

    totalInventoryItemsProcessed += inventoryItems.length;
    totalInventoryLevelsSynced += rows.length;
  }

  await supabase.from("sync_runs").insert({
    shop_domain: session.shop,
    sync_type: "inventory",
    status: "success",
    finished_at: new Date().toISOString(),
  });

  return {
    ok: true,
    inventoryItemsProcessed: totalInventoryItemsProcessed,
    inventoryLevelsSynced: totalInventoryLevelsSynced,
  };
}

export default function SyncInventoryPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
      <h1>Sync inventory levels</h1>

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
          Refresh inventory
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
            <pre style={{ whiteSpace: "pre-wrap" }}>{actionData.error}</pre>
          )}
        </section>
      ) : null}
    </main>
  );
}
