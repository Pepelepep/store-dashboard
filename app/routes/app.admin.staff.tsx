import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";

import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import type {
  StaffAliasType,
  StaffIdentityAliasRow,
  StaffPersonRow,
} from "../lib/staff-identity/staff-identity";
import {
  STAFF_ALIAS_TYPES,
  getStaffIdentityAliasCandidates,
  staffIdentityAliasKey,
} from "../lib/staff-identity/staff-identity";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { authenticate } from "../shopify.server";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";

type PermissionRow = {
  person_id: string | null;
  access_label: string | null;
  user_email: string | null;
  shopify_user_id: string | null;
  role: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
  shopify_location_id: string | null;
  location_name: string | null;
};

type LocationRow = { shopify_location_id: string; name: string; is_active: boolean };

type SellerMetric = {
  lastOrderName: string | null;
  lastActivityAt: string | null;
  lastLocation: string | null;
  lastDevice: string | null;
  orderCount: number;
  netSales: number;
};

type StaffAlias = Omit<StaffIdentityAliasRow, "alias_type"> & {
  alias_type: StaffAliasType;
};

type StaffProfile = StaffPersonRow & {
  aliases: StaffAlias[];
  dashboardAccess: string;
  lastPosSaleSeen: string | null;
  permissions: PermissionRow[];
  posMetrics: SellerMetric;
};

type LoaderData = {
  shop: string;
  unmappedPosAliases: StaffAlias[];
  deferredPosAliases: StaffAlias[];
  sellerMetrics: Record<string, SellerMetric>;
  suggestions: Record<string, { personId: string; displayName: string; reason: string }>;
  profiles: StaffProfile[];
  locations: LocationRow[];
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

function getDashboardAccessErrorMessage(error: { message?: string } | null) {
  const message = error?.message ?? "";
  if (message.includes("login_email_in_use") || message.includes("dashboard_identity_in_use")) {
    return "That login email is already used by another staff member.";
  }
  if (message.includes("invalid_access_locations")) return "Select at least one valid location.";
  if (message.includes("staff_member_not_found")) return "Staff member not found.";
  if (message.includes("invalid_access_identity")) return "A valid login email is required.";
  return "Dashboard access could not be saved. Nothing was changed; please try again.";
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

    return permission.person_id === person.id || (
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
    { data: locationsData, error: locationsError },
    { data: sellerMetricsData, error: sellerMetricsError },
  ] = await Promise.all([
    supabase
      .from("staff_people")
      .select("id, shop_domain, display_name, email, is_active, created_at, updated_at")
      .eq("shop_domain", session.shop)
      .order("display_name", { ascending: true }),
    supabase
      .from("staff_identity_aliases")
      .select(
        "id, shop_domain, person_id, alias_type, alias_value, source, review_status, suggestion_dismissed_at, first_seen_at, last_seen_at, last_location_id, last_device_id, last_device_name, created_at, updated_at",
      )
      .eq("shop_domain", session.shop)
      .order("last_seen_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("user_location_access")
      .select("person_id, access_label, user_email, shopify_user_id, shopify_location_id, location_name, role, can_view, can_manage")
      .eq("shop_domain", session.shop),
    supabase.from("locations")
      .select("shopify_location_id, name, is_active")
      .eq("shop_domain", session.shop).eq("is_active", true)
      .order("name", { ascending: true }),
    supabase.from("staff_pos_seller_metrics")
      .select("attribution_source, effective_staff_id, last_order_name, last_activity_at, last_location, last_device, order_count, net_sales")
      .eq("shop_domain", session.shop),
  ]);

  if (peopleError) throw new Response(peopleError.message, { status: 500 });
  if (aliasesError) throw new Response(aliasesError.message, { status: 500 });
  if (permissionsError) {
    throw new Response(permissionsError.message, { status: 500 });
  }
  if (locationsError) throw new Response(locationsError.message, { status: 500 });
  if (sellerMetricsError) throw new Response(sellerMetricsError.message, { status: 500 });

  const people = (peopleData ?? []) as StaffPersonRow[];
  const aliases = (aliasesData ?? []) as StaffAlias[];
  const permissions = (permissionsData ?? []) as PermissionRow[];
  const locations = (locationsData ?? []) as LocationRow[];
  const sellerMetrics = new Map<string, SellerMetric>();
  for (const metric of sellerMetricsData ?? []) {
    const candidate = getStaffIdentityAliasCandidates({
      shopops_effective_staff_id: metric.effective_staff_id,
      shopops_attribution_source: metric.attribution_source,
    })[0];
    if (!candidate) continue;
    const key = staffIdentityAliasKey(candidate.aliasType, candidate.aliasValue);
    sellerMetrics.set(key, {
      lastOrderName: metric.last_order_name,
      lastActivityAt: metric.last_activity_at,
      lastLocation: metric.last_location,
      lastDevice: metric.last_device,
      orderCount: Number(metric.order_count ?? 0),
      netSales: Number(metric.net_sales ?? 0),
    });
  }
  const aliasesByPersonId = new Map<string, StaffAlias[]>();
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const mappedAdminIds = new Map(
    aliases.filter((alias) => alias.person_id && alias.alias_type === STAFF_ALIAS_TYPES.shopifyAdminUserId)
      .map((alias) => [alias.alias_value, alias.person_id as string]),
  );
  const suggestions: LoaderData["suggestions"] = {};

  for (const alias of aliases) {
    if (!alias.person_id) continue;

    const personAliases = aliasesByPersonId.get(alias.person_id) ?? [];
    personAliases.push(alias);
    aliasesByPersonId.set(alias.person_id, personAliases);
  }
  for (const alias of aliases) {
    if (alias.person_id || alias.suggestion_dismissed_at || alias.alias_type !== STAFF_ALIAS_TYPES.posAttributedUserId) continue;
    const personId = mappedAdminIds.get(alias.alias_value);
    const person = personId ? peopleById.get(personId) : null;
    if (person?.is_active) {
      suggestions[staffIdentityAliasKey(alias.alias_type, alias.alias_value)] = {
        personId: person.id,
        displayName: person.display_name,
        reason: "This seller matches an existing login identity.",
      };
    }
  }

  return {
    shop: session.shop,
    unmappedPosAliases: aliases.filter(
      (alias) =>
        !alias.person_id &&
        alias.review_status !== "deferred" &&
        alias.source !== "pos_session_diagnostic" &&
        POS_ALIAS_TYPES.has(alias.alias_type) &&
        sellerMetrics.has(staffIdentityAliasKey(alias.alias_type, alias.alias_value)),
    ),
    deferredPosAliases: aliases.filter(
      (alias) => !alias.person_id && alias.review_status === "deferred" &&
        POS_ALIAS_TYPES.has(alias.alias_type) &&
        sellerMetrics.has(staffIdentityAliasKey(alias.alias_type, alias.alias_value)),
    ),
    sellerMetrics: Object.fromEntries(sellerMetrics),
    suggestions,
    locations,
    profiles: people.map((person) => {
      const personAliases = aliasesByPersonId.get(person.id) ?? [];
      const personPermissions = permissions.filter((row) => row.person_id === person.id);
      const metrics = personAliases.reduce<SellerMetric>((total, alias) => {
        const metric = sellerMetrics.get(staffIdentityAliasKey(alias.alias_type, alias.alias_value));
        if (!metric) return total;
        total.orderCount += metric.orderCount;
        total.netSales += metric.netSales;
        if (!total.lastActivityAt || (metric.lastActivityAt && metric.lastActivityAt > total.lastActivityAt)) {
          total.lastActivityAt = metric.lastActivityAt;
          total.lastOrderName = metric.lastOrderName;
          total.lastLocation = metric.lastLocation;
          total.lastDevice = metric.lastDevice;
        }
        return total;
      }, { lastOrderName: null, lastActivityAt: null, lastLocation: null, lastDevice: null, orderCount: 0, netSales: 0 });

      return {
        ...person,
        aliases: personAliases,
        dashboardAccess: getDashboardAccessStatus({
          person,
          aliases: personAliases,
          permissions,
        }),
        lastPosSaleSeen: getLastPosSaleSeen(personAliases),
        permissions: personPermissions,
        posMetrics: metrics,
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
    const email = normalizeText(formData.get("email")).toLowerCase() || null;

    if (!aliasId || !displayName) {
      return { ok: false, message: "POS seller and display name are required." };
    }

    const { data: alias, error: aliasError } = await supabase
      .from("staff_identity_aliases")
      .select("id, shop_domain, person_id")
      .eq("shop_domain", session.shop)
      .eq("id", aliasId)
      .maybeSingle();

    if (aliasError) return { ok: false, message: aliasError.message };
    if (!alias) return { ok: false, message: "POS seller not found." };
    if (alias.person_id) return { ok: false, message: "This POS seller is already assigned." };

    const { data: person, error: personError } = await supabase
      .from("staff_people")
      .insert({
        shop_domain: session.shop,
        display_name: displayName,
        email,
      })
      .select("id")
      .single();

    if (personError) return { ok: false, message: personError.message };

    const { error: updateError } = await supabase
      .from("staff_identity_aliases")
      .update({ person_id: person.id, review_status: "mapped", updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId);

    if (updateError) return { ok: false, message: updateError.message };

    if (email) {
      const now = new Date().toISOString();
      const { error: emailAliasError } = await supabase
        .from("staff_identity_aliases")
        .upsert({
          shop_domain: session.shop,
          person_id: person.id,
          alias_type: STAFF_ALIAS_TYPES.email,
          alias_value: email,
          source: "staff_manager",
          first_seen_at: now,
          last_seen_at: now,
        }, { onConflict: "shop_domain,alias_type,alias_value" });
      if (emailAliasError) return { ok: false, message: emailAliasError.message };
    }

    return { ok: true, message: "Staff profile created." };
  }

  if (intent === "link_alias") {
    const aliasId = normalizeText(formData.get("alias_id"));
    const personId = normalizeText(formData.get("person_id"));

    if (!aliasId || !personId) {
      return { ok: false, message: "POS seller and staff member are required." };
    }

    const { data: targetPerson } = await supabase.from("staff_people").select("id")
      .eq("shop_domain", session.shop).eq("id", personId).maybeSingle();
    if (!targetPerson) return { ok: false, message: "Staff member not found." };
    const { error } = await supabase
      .from("staff_identity_aliases")
      .update({ person_id: personId, review_status: "mapped", updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId).is("person_id", null);

    if (error) return { ok: false, message: error.message };

    return { ok: true, message: "POS seller assigned." };
  }

  if (intent === "unlink_alias") {
    const aliasId = normalizeText(formData.get("alias_id"));

    if (!aliasId) return { ok: false, message: "POS seller is required." };

    const { error } = await supabase
      .from("staff_identity_aliases")
      .update({ person_id: null, review_status: "pending", updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId);

    if (error) return { ok: false, message: error.message };

    return { ok: true, message: "POS seller unassigned." };
  }

  if (intent === "defer_alias" || intent === "restore_alias") {
    const aliasId = normalizeText(formData.get("alias_id"));
    if (!aliasId) return { ok: false, message: "POS seller is required." };
    const reviewStatus = intent === "defer_alias" ? "deferred" : "pending";
    const { error } = await supabase.from("staff_identity_aliases")
      .update({ review_status: reviewStatus, updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop).eq("id", aliasId).is("person_id", null);
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: reviewStatus === "deferred" ? "Seller moved to Review later." : "Seller restored." };
  }

  if (intent === "dismiss_suggestion") {
    const aliasId = normalizeText(formData.get("alias_id"));
    if (!aliasId) return { ok: false, message: "POS seller is required." };
    const { error } = await supabase.from("staff_identity_aliases")
      .update({ suggestion_dismissed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("shop_domain", session.shop).eq("id", aliasId).is("person_id", null);
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Suggestion dismissed." };
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

  if (intent === "remove_dashboard_access") {
    const personId = normalizeText(formData.get("person_id"));
    if (!personId) return { ok: false, message: "Staff profile is required." };
    const { error } = await supabase.rpc("remove_staff_dashboard_access", {
      p_shop_domain: session.shop,
      p_person_id: personId,
    });
    if (error) {
      return {
        ok: false,
        message: "Dashboard access could not be removed. Nothing was changed; please try again.",
      };
    }
    return {
      ok: true,
      message: "Dashboard access removed. POS sales attribution was preserved.",
    };
  }

  if (intent === "save_dashboard_access") {
    const personId = normalizeText(formData.get("person_id"));
    const email = normalizeText(formData.get("email")).toLowerCase();
    const roleValue = normalizeText(formData.get("role"));
    const role = roleValue === "admin" || roleValue === "manager" ? roleValue : "viewer";
    const requestedLocations = formData.getAll("location_ids").map(normalizeText).filter(Boolean);
    if (!personId || !email) return { ok: false, message: "A login email is required." };
    const { data: loginAliases, error: loginAliasError } = await supabase.from("staff_identity_aliases")
      .select("alias_value").eq("shop_domain", session.shop).eq("person_id", personId)
      .eq("alias_type", STAFF_ALIAS_TYPES.shopifyAdminUserId);
    if (loginAliasError) return { ok: false, message: getDashboardAccessErrorMessage(loginAliasError) };
    const shopifyUserIds = Array.from(new Set((loginAliases ?? []).map((row) => row.alias_value).filter(Boolean)));
    const { error } = await supabase.rpc("replace_staff_dashboard_access", {
      p_shop_domain: session.shop,
      p_person_id: personId,
      p_canonical_email: email,
      p_role: role,
      p_location_ids: requestedLocations,
      p_shopify_user_ids: shopifyUserIds,
    });
    if (error) return { ok: false, message: getDashboardAccessErrorMessage(error) };
    return { ok: true, message: "Dashboard access saved." };
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
      First seen: {formatDateTime(alias.first_seen_at)} · Last seen: {formatDateTime(alias.last_seen_at)}
    </div>
  );
}

export default function AdminStaffPage() {
  const { unmappedPosAliases, deferredPosAliases, sellerMetrics, suggestions, profiles, locations } = useLoaderData<LoaderData>();
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
            Manage people, POS sales attribution, and dashboard access in one place.
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

        <PageCard title="New POS sellers detected">
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
                      POS seller detected
                    </div>
                    <AliasMeta alias={alias} />
                    {(() => {
                      const metric = sellerMetrics[staffIdentityAliasKey(alias.alias_type, alias.alias_value)];
                      return metric ? (
                        <div style={{ color: "#454545", fontSize: 14, marginTop: 6 }}>
                          {metric.lastOrderName ?? "No order name"} · {formatDateTime(metric.lastActivityAt)} · {metric.lastLocation ?? "Unknown location"} · {metric.lastDevice ?? "Unknown device"}<br />
                          {metric.orderCount} {metric.orderCount === 1 ? "order" : "orders"} · Net sales {metric.netSales.toFixed(2)}
                        </div>
                      ) : null;
                    })()}
                    {(() => {
                      const suggestion = suggestions[staffIdentityAliasKey(alias.alias_type, alias.alias_value)];
                      return suggestion ? (
                        <div style={{ background: "#f0f7ff", borderRadius: 8, marginTop: 8, padding: 10 }}>
                          <strong>Suggested match: {suggestion.displayName}</strong>
                          <div style={{ color: "#454545", fontSize: 13 }}>{suggestion.reason}</div>
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <Form method="post">
                              <input type="hidden" name="intent" value="link_alias" />
                              <input type="hidden" name="alias_id" value={alias.id} />
                              <input type="hidden" name="person_id" value={suggestion.personId} />
                              <PlainButton>Confirm</PlainButton>
                            </Form>
                            <Form method="post">
                              <input type="hidden" name="intent" value="dismiss_suggestion" />
                              <input type="hidden" name="alias_id" value={alias.id} />
                              <PlainButton>Dismiss</PlainButton>
                            </Form>
                          </div>
                        </div>
                      ) : null;
                    })()}
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
                        placeholder="Display name"
                        required
                        style={{
                          border: "1px solid #c9cccf",
                          borderRadius: 8,
                          padding: 9,
                        }}
                      />
                      <input
                        name="email"
                        type="email"
                        placeholder="Email (optional)"
                        style={{ border: "1px solid #c9cccf", borderRadius: 8, padding: 9 }}
                      />
                      <PlainButton>Create staff</PlainButton>
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
                            {profile.display_name}{profile.email ? ` · ${profile.email}` : ""} · {profile.dashboardAccess}
                          </option>
                        ))}
                      </select>
                      <PlainButton>Link to staff</PlainButton>
                    </Form>
                  ) : null}
                  <Form method="post">
                    <input type="hidden" name="intent" value="defer_alias" />
                    <input type="hidden" name="alias_id" value={alias.id} />
                    <PlainButton>Later</PlainButton>
                  </Form>
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: 13 }}>Advanced details</summary>
                    <code>
                      {getAliasLabel(alias.alias_type)}: {alias.alias_value} · Source: {alias.source ?? "unknown"}
                      {alias.last_device_id ? ` · Device: ${alias.last_device_id}` : ""}
                    </code>
                  </details>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "#616161" }}>
              No POS sellers need assignment.
            </p>
          )}
        </PageCard>

        <PageCard title="Staff">
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
                      <div style={{ color: "#616161", fontWeight: 800 }}>Profile</div>
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
                      POS sales attribution
                    </div>
                    <div style={{ color: "#454545", fontSize: 14 }}>
                      {profile.posMetrics.orderCount > 0
                        ? `${profile.posMetrics.orderCount} orders · Net sales ${profile.posMetrics.netSales.toFixed(2)} · First/last activity shown below`
                        : "No POS seller attribution linked."}
                    </div>
                    {profile.aliases.some((alias) => POS_ALIAS_TYPES.has(alias.alias_type)) ? (
                      profile.aliases.filter((alias) => POS_ALIAS_TYPES.has(alias.alias_type)).map((alias) => (
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
                              POS seller linked
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
                      <div style={{ color: "#616161" }}>No POS seller linked.</div>
                    )}
                  </div>

                  <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 10 }}>
                    <div style={{ color: "#616161", fontWeight: 800, marginBottom: 8 }}>
                      Dashboard access
                    </div>
                    <div style={{ marginBottom: 8 }}>
                      {profile.dashboardAccess} · Authorization email: {profile.email ?? "Not set"}
                    </div>
                    {profile.dashboardAccess !== "No dashboard access" ? (
                      <Form method="post" style={{ display: "grid", gap: 8 }}>
                        <input type="hidden" name="intent" value="save_dashboard_access" />
                        <input type="hidden" name="person_id" value={profile.id} />
                        <input type="email" name="email" required defaultValue={profile.email ?? ""} placeholder="Login email" />
                        <select name="role" defaultValue={profile.permissions[0]?.role ?? "viewer"}>
                          <option value="viewer">Viewer</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                        <div><strong>Locations</strong></div>
                        {locations.map((location) => (
                          <label key={location.shopify_location_id} style={{ display: "flex", gap: 6 }}>
                            <input type="checkbox" name="location_ids" value={location.shopify_location_id}
                              defaultChecked={profile.permissions.some((row) => row.shopify_location_id === location.shopify_location_id || row.shopify_location_id === "*")} />
                            {location.name}
                          </label>
                        ))}
                        <PlainButton>Save dashboard access</PlainButton>
                      </Form>
                    ) : (
                      <Form method="post" style={{ display: "grid", gap: 8 }}>
                        <input type="hidden" name="intent" value="save_dashboard_access" />
                        <input type="hidden" name="person_id" value={profile.id} />
                        <input type="email" name="email" required defaultValue={profile.email ?? ""} placeholder="Login email" />
                        <select name="role" defaultValue="viewer">
                          <option value="viewer">Viewer</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                        <div><strong>Locations</strong></div>
                        {locations.map((location) => (
                          <label key={location.shopify_location_id} style={{ display: "flex", gap: 6 }}>
                            <input type="checkbox" name="location_ids" value={location.shopify_location_id} />
                            {location.name}
                          </label>
                        ))}
                        <PlainButton>Enable dashboard access</PlainButton>
                      </Form>
                    )}
                    {profile.dashboardAccess !== "No dashboard access" ? (
                      <Form method="post" style={{ marginTop: 8 }}>
                        <input type="hidden" name="intent" value="remove_dashboard_access" />
                        <input type="hidden" name="person_id" value={profile.id} />
                        <PlainButton danger>Remove dashboard access</PlainButton>
                      </Form>
                    ) : null}
                  </div>

                  <details>
                    <summary style={{ cursor: "pointer", fontWeight: 800 }}>Advanced details</summary>
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {profile.aliases.map((alias) => (
                        <code key={`advanced-${alias.id}`}>
                          {getAliasLabel(alias.alias_type)}: {alias.alias_value} · Source: {alias.source ?? "unknown"}
                          {alias.last_device_id ? ` · Device: ${alias.last_device_id}` : ""}
                        </code>
                      ))}
                    </div>
                  </details>

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

        <PageCard title="Review later">
          {deferredPosAliases.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {deferredPosAliases.map((alias) => (
                <div key={alias.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 }}>
                  <strong>POS seller</strong> · Last activity {formatDateTime(alias.last_seen_at)}
                  <Form method="post" style={{ marginTop: 8 }}>
                    <input type="hidden" name="intent" value="restore_alias" />
                    <input type="hidden" name="alias_id" value={alias.id} />
                    <PlainButton>Restore</PlainButton>
                  </Form>
                </div>
              ))}
            </div>
          ) : <p style={{ color: "#616161" }}>No sellers are waiting for review.</p>}
        </PageCard>
      </div>
    </main>
  );
}
