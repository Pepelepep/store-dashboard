import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";

type LocationNode = {
  id: string;
  name: string;
  isActive: boolean;
  address?: {
    city?: string | null;
    province?: string | null;
    country?: string | null;
  } | null;
};

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

  const response = await admin.graphql(`#graphql
    query getLocationsForSync {
      locations(first: 50) {
        edges {
          node {
            id
            name
            isActive
            address {
              city
              province
              country
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

  const locations: LocationNode[] =
    data.data?.locations?.edges?.map(
      (edge: { node: LocationNode }) => edge.node,
    ) ?? [];

  const rows = locations.map((location) => ({
    shop_domain: session.shop,
    shopify_location_id: location.id,
    name: location.name,
    is_active: location.isActive,
    city: location.address?.city ?? null,
    province: location.address?.province ?? null,
    country: location.address?.country ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("locations")
    .upsert(rows, {
      onConflict: "shop_domain,shopify_location_id",
    });

  if (error) {
    return {
      ok: false,
      error: error.message,
    };
  }

  await supabase.from("sync_runs").insert({
    shop_domain: session.shop,
    sync_type: "locations",
    status: "success",
    finished_at: new Date().toISOString(),
  });

  return {
    ok: true,
    syncedCount: rows.length,
  };
}

export default function SyncLocationsPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();

  return (
    <main style={{ padding: 28, fontFamily: "system-ui" }}>
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
          Refresh locations
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
            <p>
              Synced <strong>{actionData.syncedCount}</strong> locations.
            </p>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap" }}>{actionData.error}</pre>
          )}
        </section>
      ) : null}
    </main>
  );
}