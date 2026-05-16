import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";

type LocationRow = {
  shopify_location_id: string;
  name: string;
  is_active: boolean;
};

type PermissionRow = {
  id: string;
  shop_domain: string;
  user_email: string | null;
  shopify_user_id: string | null;
  shopify_location_id: string | null;
  location_name: string | null;
  role: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
  created_at: string | null;
};

type LoaderData = {
  shop: string;
  currentUser: {
    email: string | null;
    shopifyUserId: string | null;
    displayName: string;
  };
  locations: LocationRow[];
  permissions: PermissionRow[];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  const permissionContext = await assertAdminAccess({ request, session, supabase });

  const [{ data: locationsData, error: locationsError }, { data: permissionsData, error: permissionsError }] =
    await Promise.all([
      supabase
        .from("locations")
        .select("shopify_location_id, name, is_active")
        .eq("shop_domain", session.shop)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("user_location_access")
        .select(
          "id, shop_domain, user_email, shopify_user_id, shopify_location_id, location_name, role, can_view, can_manage, created_at",
        )
        .eq("shop_domain", session.shop)
        .order("user_email", { ascending: true }),
    ]);

  if (locationsError) throw new Response(locationsError.message, { status: 500 });
  if (permissionsError) throw new Response(permissionsError.message, { status: 500 });

  return {
    shop: session.shop,
    currentUser: permissionContext.identity,
    locations: (locationsData ?? []) as LocationRow[],
    permissions: (permissionsData ?? []) as PermissionRow[],
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) throw new Response("Missing permission id", { status: 400 });

    const { error } = await supabase
      .from("user_location_access")
      .delete()
      .eq("shop_domain", session.shop)
      .eq("id", id);

    if (error) throw new Response(error.message, { status: 500 });
    return { ok: true };
  }

  const email = String(formData.get("user_email") ?? "").trim().toLowerCase();
  const shopifyUserId = String(formData.get("shopify_user_id") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "viewer");
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);

  if (!email && !shopifyUserId) {
    throw new Response("Email or Shopify user id is required", { status: 400 });
  }

  if (!locationIds.length && role !== "admin") {
    throw new Response("Select at least one location", { status: 400 });
  }

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name")
    .eq("shop_domain", session.shop);

  if (locationsError) throw new Response(locationsError.message, { status: 500 });

  const locationsById = new Map(
    (locationsData ?? []).map((location: any) => [location.shopify_location_id, location.name]),
  );

  let deleteQuery = supabase
    .from("user_location_access")
    .delete()
    .eq("shop_domain", session.shop);

  if (email && shopifyUserId) {
    deleteQuery = deleteQuery.or(`user_email.eq.${email},shopify_user_id.eq.${shopifyUserId}`);
  } else if (email) {
    deleteQuery = deleteQuery.eq("user_email", email);
  } else if (shopifyUserId) {
    deleteQuery = deleteQuery.eq("shopify_user_id", shopifyUserId);
  }

  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw new Response(deleteError.message, { status: 500 });

  const rows = role === "admin"
    ? [
        {
          shop_domain: session.shop,
          user_email: email || null,
          shopify_user_id: shopifyUserId,
          shopify_location_id: "*",
          location_name: "All locations",
          role: "admin",
          can_view: true,
          can_manage: true,
        },
      ]
    : locationIds.map((locationId) => ({
        shop_domain: session.shop,
        user_email: email || null,
        shopify_user_id: shopifyUserId,
        shopify_location_id: locationId,
        location_name: String(locationsById.get(locationId) ?? locationId),
        role,
        can_view: true,
        can_manage: role === "manager",
      }));

  const { error: insertError } = await supabase.from("user_location_access").insert(rows);
  if (insertError) throw new Response(insertError.message, { status: 500 });

  return { ok: true };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "white", border: "1px solid #e3e3e3", borderRadius: 16, padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

export default function AdminPermissionsPage() {
  const { shop, currentUser, locations, permissions } = useLoaderData<LoaderData>();

  return (
    <main style={{ minHeight: "100vh", background: "#f6f6f7", padding: 28, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <div style={{ color: "#616161", fontSize: 14, marginBottom: 6 }}>Admin</div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Location permissions</h1>
          <p style={{ color: "#616161" }}>Shop: <strong>{shop}</strong></p>
          <p style={{ color: "#616161" }}>
            Current user: <strong>{currentUser.displayName}</strong>
            {currentUser.email ? ` · ${currentUser.email}` : ""}
            {currentUser.shopifyUserId ? ` · Shopify user ${currentUser.shopifyUserId}` : ""}
          </p>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: 20 }}>
          <Card title="Add or replace user access">
            <Form method="post" style={{ display: "grid", gap: 14 }}>
              <input type="hidden" name="intent" value="save" />

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Email
                <input name="user_email" placeholder="manager@local.ca" style={{ padding: 10, borderRadius: 8, border: "1px solid #c9cccf" }} />
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Shopify user id, optional
                <input name="shopify_user_id" placeholder="90052427974" style={{ padding: 10, borderRadius: 8, border: "1px solid #c9cccf" }} />
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Role
                <select name="role" defaultValue="viewer" style={{ padding: 10, borderRadius: 8, border: "1px solid #c9cccf" }}>
                  <option value="viewer">Viewer</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </label>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Locations</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {locations.map((location) => (
                    <label key={location.shopify_location_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="checkbox" name="locationIds" value={location.shopify_location_id} />
                      {location.name}
                    </label>
                  ))}
                </div>
                <p style={{ color: "#616161", fontSize: 13 }}>For admin role, locations are ignored and access is global.</p>
              </div>

              <button type="submit" style={{ border: "1px solid #202223", background: "#202223", color: "white", borderRadius: 10, padding: "10px 14px", fontWeight: 700 }}>
                Save permissions
              </button>
            </Form>
          </Card>

          <Card title="Current access">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    {["User", "Shopify user id", "Role", "Location", "View", "Manage", ""].map((header) => (
                      <th key={header} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{row.user_email ?? "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{row.shopify_user_id ?? "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{row.role ?? "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{row.location_name ?? row.shopify_location_id ?? "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{row.can_view ? "Yes" : "No"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{row.can_manage ? "Yes" : "No"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" style={{ border: "1px solid #d72c0d", background: "white", color: "#d72c0d", borderRadius: 8, padding: "6px 10px" }}>
                            Delete
                          </button>
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
