import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import type {
  StaffAliasType,
  StaffIdentityAliasRow,
  StaffPersonRow,
} from "../lib/staff-identity/staff-identity";
import { STAFF_ALIAS_TYPES } from "../lib/staff-identity/staff-identity";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { authenticate } from "../shopify.server";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";

type PermissionRow = {
  access_label: string | null;
  user_email: string | null;
  shopify_user_id: string | null;
  role: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
};

type StaffAlias = Omit<StaffIdentityAliasRow, "alias_type"> & {
  alias_type: StaffAliasType;
};

type StaffProfile = StaffPersonRow & {
  aliases: StaffAlias[];
  dashboardAccess: string;
  lastPosSaleSeen: string | null;
};

type LoaderData = {
  shop: string;
  unmappedPosAliases: StaffAlias[];
  profiles: StaffProfile[];
};

type ActionData = {
  ok: boolean;
  message: string;
};

const POS_ALIAS_TYPES = new Set<StaffAliasType>([
  STAFF_ALIAS_TYPES.posStaffMemberId,
  STAFF_ALIAS_TYPES.posUserId,
  STAFF_ALIAS_TYPES.posAttributedUserId,
  STAFF_ALIAS_TYPES.posEffectiveStaffId,
]);

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getAliasLabel(aliasType: StaffAliasType) {
  switch (aliasType) {
    case STAFF_ALIAS_TYPES.email:
      return "Email";
    case STAFF_ALIAS_TYPES.shopifyAdminUserId:
      return "Shopify admin user ID";
    case STAFF_ALIAS_TYPES.posStaffMemberId:
      return "POS staff member ID";
    case STAFF_ALIAS_TYPES.posUserId:
      return "POS user ID";
    case STAFF_ALIAS_TYPES.posAttributedUserId:
      return "POS attributed user ID";
    case STAFF_ALIAS_TYPES.posEffectiveStaffId:
      return "POS effective staff ID";
    default:
      return aliasType;
  }
}

function getDashboardAccessStatus({
  person,
  aliases,
  permissions,
}: {
  person: StaffPersonRow;
  aliases: StaffAlias[];
  permissions: PermissionRow[];
}) {
  const emails = new Set(
    [person.email, ...aliases.filter((alias) => alias.alias_type === "email").map((alias) => alias.alias_value)]
      .map((value) => value?.trim().toLowerCase())
      .filter(Boolean) as string[],
  );
  const shopifyUserIds = new Set(
    aliases
      .filter((alias) => alias.alias_type === STAFF_ALIAS_TYPES.shopifyAdminUserId)
      .map((alias) => alias.alias_value),
  );
  const matchingPermissions = permissions.filter((permission) => {
    const email = permission.user_email?.trim().toLowerCase();
    const shopifyUserId = permission.shopify_user_id?.trim();

    return (
      (email && emails.has(email)) ||
      (shopifyUserId && shopifyUserIds.has(shopifyUserId))
    );
  });

  if (matchingPermissions.length === 0) {
    return "No dashboard access";
  }

  if (matchingPermissions.some((permission) => permission.role === "admin")) {
    return "Admin";
  }

  if (matchingPermissions.some((permission) => permission.role === "manager")) {
    return "Manager";
  }

  return "Viewer";
}

function getLastPosSaleSeen(aliases: StaffAlias[]) {
  return aliases
    .filter((alias) => POS_ALIAS_TYPES.has(alias.alias_type))
    .map((alias) => alias.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

async function syncTeamAccessLabelForPerson({
  supabase,
  shop,
  personId,
  displayName,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  shop: string;
  personId: string;
  displayName: string;
}) {
  const { data: aliases, error: aliasesError } = await supabase
    .from("staff_identity_aliases")
    .select("alias_type, alias_value")
    .eq("shop_domain", shop)
    .eq("person_id", personId)
    .in("alias_type", [
      STAFF_ALIAS_TYPES.email,
      STAFF_ALIAS_TYPES.shopifyAdminUserId,
    ]);

  if (aliasesError) {
    throw new Error(aliasesError.message);
  }

  const emailAliases = (aliases ?? [])
    .filter((alias) => alias.alias_type === STAFF_ALIAS_TYPES.email)
    .map((alias) => String(alias.alias_value).toLowerCase());
  const shopifyUserIds = (aliases ?? [])
    .filter((alias) => alias.alias_type === STAFF_ALIAS_TYPES.shopifyAdminUserId)
    .map((alias) => String(alias.alias_value));

  if (emailAliases.length > 0) {
    const { error } = await supabase
      .from("user_location_access")
      .update({ access_label: displayName })
      .eq("shop_domain", shop)
      .in("user_email", emailAliases);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (shopifyUserIds.length > 0) {
    const { error } = await supabase
      .from("user_location_access")
      .update({ access_label: displayName })
      .eq("shop_domain", shop)
      .in("shopify_user_id", shopifyUserIds);

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.staff",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });

  const [
    { data: peopleData, error: peopleError },
    { data: aliasesData, error: aliasesError },
    { data: permissionsData, error: permissionsError },
  ] = await Promise.all([
    supabase
      .from("staff_people")
      .select("id, shop_domain, display_name, email, is_active, created_at, updated_at")
      .eq("shop_domain", session.shop)
      .order("display_name", { ascending: true }),
    supabase
      .from("staff_identity_aliases")
      .select(
        "id, shop_domain, person_id, alias_type, alias_value, source, first_seen_at, last_seen_at, last_location_id, last_device_id, last_device_name, created_at, updated_at",
      )
      .eq("shop_domain", session.shop)
      .order("last_seen_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("user_location_access")
      .select("access_label, user_email, shopify_user_id, role, can_view, can_manage")
      .eq("shop_domain", session.shop),
  ]);

  if (peopleError) throw new Response(peopleError.message, { status: 500 });
  if (aliasesError) throw new Response(aliasesError.message, { status: 500 });
  if (permissionsError) {
    throw new Response(permissionsError.message, { status: 500 });
  }

  const people = (peopleData ?? []) as StaffPersonRow[];
  const aliases = (aliasesData ?? []) as StaffAlias[];
  const permissions = (permissionsData ?? []) as PermissionRow[];
  const aliasesByPersonId = new Map<string, StaffAlias[]>();

  for (const alias of aliases) {
    if (!alias.person_id) continue;

    const personAliases = aliasesByPersonId.get(alias.person_id) ?? [];
    personAliases.push(alias);
    aliasesByPersonId.set(alias.person_id, personAliases);
  }

  return {
    shop: session.shop,
    unmappedPosAliases: aliases.filter(
      (alias) => !alias.person_id && POS_ALIAS_TYPES.has(alias.alias_type),
    ),
    profiles: people.map((person) => {
      const personAliases = aliasesByPersonId.get(person.id) ?? [];

      return {
        ...person,
        aliases: personAliases,
        dashboardAccess: getDashboardAccessStatus({
          person,
          aliases: personAliases,
          permissions,
        }),
        lastPosSaleSeen: getLastPosSaleSeen(personAliases),
      };
    }),
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.staff.action",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const intent = normalizeText(formData.get("intent"));

  if (intent === "create_from_alias") {
    const aliasId = normalizeText(formData.get("alias_id"));
    const displayName = normalizeText(formData.get("display_name"));

    if (!aliasId || !displayName) {
      return { ok: false, message: "Alias and display name are required." };
    }

    const { data: alias, error: aliasError } = await supabase
      .from("staff_identity_aliases")
      .select("id, shop_domain, person_id")
      .eq("shop_domain", session.shop)
      .eq("id", aliasId)
      .maybeSingle();

    if (aliasError) return { ok: false, message: aliasError.message };
    if (!alias) return { ok: false, message: "Alias not found." };

    const { data: person, error: personError } = await supabase
      .from("staff_people")
      .insert({
        shop_domain: session.shop,
        display_name: displayName,
        email: null,
      })
      .select("id")
      .single();

    if (personError) return { ok: false, message: personError.message };

    const { error: updateError } = await supabase
      .from("staff_identity_aliases")
      .update({ person_id: person.id, updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId);

    if (updateError) return { ok: false, message: updateError.message };

    return { ok: true, message: "Staff profile created." };
  }

  if (intent === "link_alias") {
    const aliasId = normalizeText(formData.get("alias_id"));
    const personId = normalizeText(formData.get("person_id"));

    if (!aliasId || !personId) {
      return { ok: false, message: "Alias and staff profile are required." };
    }

    const { error } = await supabase
      .from("staff_identity_aliases")
      .update({ person_id: personId, updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId);

    if (error) return { ok: false, message: error.message };

    return { ok: true, message: "Alias linked." };
  }

  if (intent === "unlink_alias") {
    const aliasId = normalizeText(formData.get("alias_id"));

    if (!aliasId) return { ok: false, message: "Alias is required." };

    const { error } = await supabase
      .from("staff_identity_aliases")
      .update({ person_id: null, updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId);

    if (error) return { ok: false, message: error.message };

    return { ok: true, message: "Alias unlinked." };
  }

  if (intent === "rename_person") {
    const personId = normalizeText(formData.get("person_id"));
    const displayName = normalizeText(formData.get("display_name"));

    if (!personId || !displayName) {
      return { ok: false, message: "Staff profile and display name are required." };
    }

    const { error } = await supabase
      .from("staff_people")
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", personId);

    if (error) return { ok: false, message: error.message };

    try {
      await syncTeamAccessLabelForPerson({
        supabase,
        shop: session.shop,
        personId,
        displayName,
      });
    } catch (syncError) {
      return {
        ok: false,
        message: syncError instanceof Error ? syncError.message : String(syncError),
      };
    }

    return { ok: true, message: "Staff profile renamed." };
  }

  if (intent === "deactivate_person") {
    const personId = normalizeText(formData.get("person_id"));

    if (!personId) return { ok: false, message: "Staff profile is required." };

    const { error } = await supabase
      .from("staff_people")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", personId);

    if (error) return { ok: false, message: error.message };

    return { ok: true, message: "Staff profile deactivated." };
  }

  return { ok: false, message: "Unknown staff action." };
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

function PageCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 12,
        padding: 20,
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function PlainButton({
  children,
  danger = false,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="submit"
      style={{
        border: "1px solid #c9cccf",
        borderRadius: 8,
        background: "white",
        color: danger ? "#b42318" : "#202223",
        cursor: "pointer",
        fontWeight: 700,
        padding: "7px 10px",
      }}
    >
      {children}
    </button>
  );
}

function AliasMeta({ alias }: { alias: StaffAlias }) {
  return (
    <div style={{ color: "#616161", fontSize: 13 }}>
      Last location: {alias.last_location_id ?? "-"} · Last device:{" "}
      {[alias.last_device_name, alias.last_device_id].filter(Boolean).join(" / ") ||
        "-"}{" "}
      · Last seen: {formatDateTime(alias.last_seen_at)}
    </div>
  );
}

export default function AdminStaffPage() {
  const { unmappedPosAliases, profiles } = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const activeProfiles = profiles.filter((profile) => profile.is_active);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#f6f6f7",
        padding: 28,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 20 }}>
        <header>
          <h1 style={{ margin: 0, fontSize: 32 }}>Staff</h1>
          <p style={{ color: "#616161", margin: "8px 0 0" }}>
            Map POS seller IDs to readable staff profiles. Dashboard access still lives in Team Access.
          </p>
        </header>

        {actionData ? (
          <div
            style={{
              border: `1px solid ${actionData.ok ? "#abefc6" : "#fecdca"}`,
              borderRadius: 10,
              background: actionData.ok ? "#ecfdf3" : "#fef3f2",
              color: actionData.ok ? "#067647" : "#b42318",
              fontWeight: 800,
              padding: 12,
            }}
          >
            {actionData.message}
          </div>
        ) : null}

        <PageCard title="New POS staff detected">
          {unmappedPosAliases.length > 0 ? (
            <div style={{ display: "grid", gap: 12 }}>
              {unmappedPosAliases.map((alias) => (
                <div
                  key={alias.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: 12,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900 }}>
                      {getAliasLabel(alias.alias_type)} · {alias.alias_value}
                    </div>
                    <AliasMeta alias={alias} />
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(180px, 1fr) auto",
                      gap: 8,
                    }}
                  >
                    <Form method="post" style={{ display: "contents" }}>
                      <input type="hidden" name="intent" value="create_from_alias" />
                      <input type="hidden" name="alias_id" value={alias.id} />
                      <input
                        name="display_name"
                        placeholder="Readable staff name"
                        required
                        style={{
                          border: "1px solid #c9cccf",
                          borderRadius: 8,
                          padding: 9,
                        }}
                      />
                      <PlainButton>Name staff</PlainButton>
                    </Form>
                  </div>
                  {activeProfiles.length > 0 ? (
                    <Form
                      method="post"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(180px, 1fr) auto",
                        gap: 8,
                      }}
                    >
                      <input type="hidden" name="intent" value="link_alias" />
                      <input type="hidden" name="alias_id" value={alias.id} />
                      <select
                        name="person_id"
                        required
                        style={{
                          border: "1px solid #c9cccf",
                          borderRadius: 8,
                          padding: 9,
                        }}
                      >
                        <option value="">Link to existing staff profile</option>
                        {activeProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.display_name}
                          </option>
                        ))}
                      </select>
                      <PlainButton>Link alias</PlainButton>
                    </Form>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "#616161" }}>
              No unmapped POS seller aliases detected yet.
            </p>
          )}
        </PageCard>

        <PageCard title="Staff profiles">
          {profiles.length > 0 ? (
            <div style={{ display: "grid", gap: 14 }}>
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    opacity: profile.is_active ? 1 : 0.58,
                    padding: 14,
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <h3 style={{ margin: 0 }}>{profile.display_name}</h3>
                        <StatusBadge
                          variant={
                            profile.dashboardAccess === "No dashboard access"
                              ? "neutral"
                              : "success"
                          }
                        >
                          {profile.dashboardAccess}
                        </StatusBadge>
                        {!profile.is_active ? (
                          <StatusBadge variant="warning">Inactive</StatusBadge>
                        ) : null}
                      </div>
                      <div style={{ color: "#616161", fontSize: 13 }}>
                        Email: {profile.email ?? "-"} · Last POS sale:{" "}
                        {formatDateTime(profile.lastPosSaleSeen)}
                      </div>
                    </div>
                    <Form method="post" style={{ display: "flex", gap: 8 }}>
                      <input type="hidden" name="intent" value="rename_person" />
                      <input type="hidden" name="person_id" value={profile.id} />
                      <input
                        name="display_name"
                        defaultValue={profile.display_name}
                        required
                        style={{
                          border: "1px solid #c9cccf",
                          borderRadius: 8,
                          padding: 8,
                        }}
                      />
                      <PlainButton>Rename</PlainButton>
                    </Form>
                  </div>

                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ color: "#616161", fontWeight: 800 }}>
                      Aliases
                    </div>
                    {profile.aliases.length > 0 ? (
                      profile.aliases.map((alias) => (
                        <div
                          key={alias.id}
                          style={{
                            alignItems: "center",
                            display: "grid",
                            gap: 8,
                            gridTemplateColumns: "minmax(0, 1fr) auto",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800 }}>
                              {getAliasLabel(alias.alias_type)} · {alias.alias_value}
                            </div>
                            <AliasMeta alias={alias} />
                          </div>
                          <Form method="post">
                            <input type="hidden" name="intent" value="unlink_alias" />
                            <input type="hidden" name="alias_id" value={alias.id} />
                            <PlainButton>Unlink</PlainButton>
                          </Form>
                        </div>
                      ))
                    ) : (
                      <div style={{ color: "#616161" }}>No aliases linked.</div>
                    )}
                  </div>

                  {profile.is_active ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="deactivate_person" />
                      <input type="hidden" name="person_id" value={profile.id} />
                      <PlainButton danger>Deactivate</PlainButton>
                    </Form>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "#616161" }}>No staff profiles yet.</p>
          )}
          {isSubmitting ? (
            <p style={{ color: "#616161", fontWeight: 800 }}>Saving...</p>
          ) : null}
        </PageCard>
      </div>
    </main>
  );
}
