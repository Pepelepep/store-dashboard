import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useMemo, useState } from "react";

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

type ActionData = {
  ok: boolean;
  message: string;
};

type AccessFormState = {
  user_email: string;
  shopify_user_id: string;
  role: string;
  locationIds: string[];
};

type PermissionGroup = {
  key: string;
  user_email: string;
  shopify_user_id: string;
  role: string;
  locationIds: string[];
  locationNames: string[];
  can_manage: boolean;
};

const emptyAccessForm: AccessFormState = {
  user_email: "",
  shopify_user_id: "",
  role: "viewer",
  locationIds: [],
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
    const shopifyUserId = String(formData.get("shopify_user_id") ?? "").trim();
    if (!shopifyUserId) {
      return {
        ok: false,
        message: "Missing Shopify user ID.",
      } satisfies ActionData;
    }

    const { error } = await supabase
      .from("user_location_access")
      .delete()
      .eq("shop_domain", session.shop)
      .eq("shopify_user_id", shopifyUserId);

    if (error) {
      return {
        ok: false,
        message: error.message,
      } satisfies ActionData;
    }

    return {
      ok: true,
      message: "Access deleted.",
    } satisfies ActionData;
  }

  const email = String(formData.get("user_email") ?? "").trim().toLowerCase();
  const shopifyUserId = String(formData.get("shopify_user_id") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "viewer");
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);

  if (!shopifyUserId) {
    return {
      ok: false,
      message: "Shopify user ID is required.",
    } satisfies ActionData;
  }

  if (!role) {
    return {
      ok: false,
      message: "Role is required.",
    } satisfies ActionData;
  }

  if (!locationIds.length && role !== "admin") {
    return {
      ok: false,
      message: "Select at least one location.",
    } satisfies ActionData;
  }

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name")
    .eq("shop_domain", session.shop);

  if (locationsError) {
    return {
      ok: false,
      message: locationsError.message,
    } satisfies ActionData;
  }

  const locationsById = new Map(
    (locationsData ?? []).map((location: any) => [location.shopify_location_id, location.name]),
  );

  let deleteQuery = supabase
    .from("user_location_access")
    .delete()
    .eq("shop_domain", session.shop);

  deleteQuery = deleteQuery.eq("shopify_user_id", shopifyUserId);

  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    return {
      ok: false,
      message: deleteError.message,
    } satisfies ActionData;
  }

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
  if (insertError) {
    return {
      ok: false,
      message: insertError.message,
    } satisfies ActionData;
  }

  return {
    ok: true,
    message: "Permissions saved.",
  } satisfies ActionData;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "white", border: "1px solid #e3e3e3", borderRadius: 16, padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function groupPermissions(permissions: PermissionRow[]) {
  const groups = new Map<string, PermissionGroup>();

  for (const row of permissions) {
    const key = row.shopify_user_id ?? `missing-${row.id}`;
    const existing = groups.get(key);
    const isAdmin = row.role === "admin" || row.shopify_location_id === "*";
    const role = isAdmin ? "admin" : row.role || "viewer";

    if (!existing) {
      groups.set(key, {
        key,
        user_email: row.user_email ?? "",
        shopify_user_id: row.shopify_user_id ?? "",
        role,
        locationIds:
          isAdmin || !row.shopify_location_id ? [] : [row.shopify_location_id],
        locationNames: [
          isAdmin
            ? "All locations"
            : row.location_name ?? row.shopify_location_id ?? "-",
        ],
        can_manage: Boolean(row.can_manage),
      });
      continue;
    }

    if (!existing.user_email && row.user_email) {
      existing.user_email = row.user_email;
    }

    if (isAdmin) {
      existing.role = "admin";
      existing.locationIds = [];
      existing.locationNames = ["All locations"];
      existing.can_manage = true;
      continue;
    }

    if (row.role === "manager") {
      existing.role = "manager";
    }

    if (row.can_manage) {
      existing.can_manage = true;
    }

    if (row.shopify_location_id) {
      existing.locationIds.push(row.shopify_location_id);
      existing.locationNames.push(row.location_name ?? row.shopify_location_id);
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    (a.user_email || a.shopify_user_id).localeCompare(
      b.user_email || b.shopify_user_id,
    ),
  );
}

export default function AdminPermissionsPage() {
  const { shop, currentUser, locations, permissions } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const permissionGroups = useMemo(
    () => groupPermissions(permissions),
    [permissions],
  );
  const [formState, setFormState] = useState<AccessFormState>(emptyAccessForm);
  const isSubmitting = navigation.state !== "idle";
  const activeIntent = navigation.formData?.get("intent");
  const isSaving = isSubmitting && activeIntent === "save";
  const isDeleting = isSubmitting && activeIntent === "delete";
  const isAdminRole = formState.role === "admin";

  function toggleLocation(locationId: string, checked: boolean) {
    setFormState((current) => ({
      ...current,
      locationIds: checked
        ? Array.from(new Set([...current.locationIds, locationId]))
        : current.locationIds.filter((id) => id !== locationId),
    }));
  }

  function editGroup(group: PermissionGroup) {
    setFormState({
      user_email: group.user_email,
      shopify_user_id: group.shopify_user_id,
      role: group.role,
      locationIds: group.role === "admin" ? [] : group.locationIds,
    });
  }

  function clearForm() {
    setFormState(emptyAccessForm);
  }

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

        {actionData ? (
          <div
            style={{
              background: actionData.ok ? "#ecfdf3" : "#fef3f2",
              border: `1px solid ${actionData.ok ? "#abefc6" : "#fecdca"}`,
              color: actionData.ok ? "#067647" : "#b42318",
              borderRadius: 12,
              padding: 14,
              marginBottom: 20,
              fontWeight: 700,
            }}
          >
            {actionData.message}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) minmax(0, 1fr)", gap: 20 }}>
          <Card title="Add or replace user access">
            <Form method="post" style={{ display: "grid", gap: 14 }}>
              <input type="hidden" name="intent" value="save" />

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Email
                <input
                  name="user_email"
                  placeholder="manager@local.ca"
                  value={formState.user_email}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      user_email: event.target.value,
                    }))
                  }
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #c9cccf" }}
                />
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Shopify user ID
                <input
                  name="shopify_user_id"
                  required
                  placeholder="90052427974"
                  value={formState.shopify_user_id}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      shopify_user_id: event.target.value,
                    }))
                  }
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #c9cccf" }}
                />
                <span style={{ color: "#616161", fontSize: 13, fontWeight: 400 }}>
                  Required. We use this Shopify user ID to identify staff members without requesting read_users.
                </span>
              </label>

              <label style={{ display: "grid", gap: 6, fontWeight: 700 }}>
                Role
                <select
                  name="role"
                  required
                  value={formState.role}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      role: event.target.value,
                      locationIds:
                        event.target.value === "admin"
                          ? []
                          : current.locationIds,
                    }))
                  }
                  style={{ padding: 10, borderRadius: 8, border: "1px solid #c9cccf" }}
                >
                  <option value="viewer">Viewer - Can view dashboard data for selected locations.</option>
                  <option value="manager">Manager - Can view dashboard data and manage location-level settings for selected locations.</option>
                  <option value="admin">Admin - Can access all locations and manage permissions.</option>
                </select>
              </label>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Locations</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {locations.map((location) => (
                    <label key={location.shopify_location_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        name="locationIds"
                        value={location.shopify_location_id}
                        checked={formState.locationIds.includes(
                          location.shopify_location_id,
                        )}
                        disabled={isAdminRole}
                        onChange={(event) =>
                          toggleLocation(
                            location.shopify_location_id,
                            event.target.checked,
                          )
                        }
                      />
                      {location.name}
                    </label>
                  ))}
                </div>
                <p style={{ color: "#616161", fontSize: 13 }}>For admin role, locations are ignored and access is global.</p>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button disabled={isSubmitting} type="submit" style={{ border: "1px solid #202223", background: isSubmitting ? "#8a8f93" : "#202223", color: "white", borderRadius: 10, padding: "10px 14px", fontWeight: 700 }}>
                  {isSaving ? "Saving..." : "Save permissions"}
                </button>
                <button type="button" onClick={clearForm} disabled={isSubmitting} style={{ border: "1px solid #c9cccf", background: "white", color: "#202223", borderRadius: 10, padding: "10px 14px", fontWeight: 700 }}>
                  New access
                </button>
              </div>
            </Form>
          </Card>

          <Card title="Current access">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    {["User", "Shopify user id", "Role", "Locations", "Manage", ""].map((header) => (
                      <th key={header} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permissionGroups.map((group) => (
                    <tr key={group.key}>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{group.user_email || "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{group.shopify_user_id || "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{group.role}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{group.locationNames.join(", ") || "-"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>{group.can_manage ? "Yes" : "No"}</td>
                      <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => editGroup(group)} disabled={isSubmitting || !group.shopify_user_id} style={{ border: "1px solid #202223", background: "white", color: "#202223", borderRadius: 8, padding: "6px 10px" }}>
                            Edit
                          </button>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="shopify_user_id" value={group.shopify_user_id} />
                            <button disabled={isSubmitting || !group.shopify_user_id} type="submit" style={{ border: "1px solid #d72c0d", background: "white", color: isSubmitting ? "#8a8f93" : "#d72c0d", borderRadius: 8, padding: "6px 10px" }}>
                              {isDeleting ? "Deleting..." : "Delete access"}
                            </button>
                          </Form>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {permissionGroups.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 14, color: "#616161" }}>
                        No permissions configured.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
