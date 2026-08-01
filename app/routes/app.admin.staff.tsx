import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { useMemo, useState } from "react";
import { Icon } from "@shopify/polaris";
import { PersonIcon, PersonLockIcon } from "@shopify/polaris-icons";

import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { SectionTabs } from "../components/ui/SectionTabs";
import {
  EmptyState,
  InlineNotice,
  PageHeader,
  ShopOpsPage,
} from "../components/ui/ShopOpsPage";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import {
  STAFF_ALIAS_TYPES,
  getStaffIdentityAliasCandidates,
  staffIdentityAliasKey,
  type StaffAliasType,
  type StaffIdentityAliasRow,
  type StaffPersonRow,
} from "../lib/staff-identity/staff-identity";
import {
  parseShopifyStaffCsv,
  type ShopifyStaffCsvResult,
} from "../lib/staff-identity/shopify-staff-csv";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { authenticate } from "../shopify.server";
import { buildShopifyOrderUrl } from "../lib/shopify/order-url";
import { getFreshPlanLimits } from "../lib/entitlements.server";

type PermissionRow = {
  membership_id: string | null;
  person_id: string | null;
  user_email: string | null;
  shopify_user_id: string | null;
  role: string | null;
  shopify_location_id: string | null;
  location_name: string | null;
};
type LocationRow = {
  shopify_location_id: string;
  name: string;
};
type MembershipRow = {
  id: string;
  person_id: string | null;
  normalized_email: string | null;
  display_name: string;
  role: "owner" | "admin" | "manager" | "viewer";
  status: "active" | "disabled";
  is_owner: boolean;
};
type SellerMetric = {
  lastOrderName: string | null;
  lastOrderId: string | null;
  firstActivityAt: string | null;
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
  membership: MembershipRow | null;
  permissions: PermissionRow[];
  posMetrics: SellerMetric;
  canHardDelete: boolean;
};
type LoaderData = {
  shop: string;
  profiles: StaffProfile[];
  pending: StaffAlias[];
  deferred: StaffAlias[];
  sellerMetrics: Record<string, SellerMetric>;
  locations: LocationRow[];
  suggestions: Record<string, { personId: string; displayName: string }>;
  posSetup: {
    status: "not_configured" | "waiting" | "active";
    firstTrackedAt: string | null;
  };
};
type ActionData = { ok: boolean; message: string };
type Overlay =
  | "add"
  | "pending"
  | "import"
  | "details"
  | "profile"
  | "access"
  | "pos"
  | "remove"
  | "setup"
  | null;

const POS_ALIAS_TYPES = new Set<StaffAliasType>([
  STAFF_ALIAS_TYPES.posStaffMemberId,
  STAFF_ALIAS_TYPES.posUserId,
  STAFF_ALIAS_TYPES.posAttributedUserId,
  STAFF_ALIAS_TYPES.posEffectiveStaffId,
]);
const SHOPIFY_QUERY = `FROM sales
SHOW net_sales
GROUP BY
  assisting_staff_id,
  assisting_staff_member_name,
  pos_location_name
SINCE -365d
ORDER BY assisting_staff_member_name ASC
LIMIT 1000`;

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}
function money(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "CAD",
  }).format(value);
}
function date(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}
function metricKey(alias: StaffAlias) {
  return staffIdentityAliasKey(alias.alias_type, alias.alias_value);
}
function advancedAliasLabel(aliasType: StaffAliasType) {
  if (aliasType === STAFF_ALIAS_TYPES.shopifyAdminUserId)
    return "Shopify login ID";
  if (POS_ALIAS_TYPES.has(aliasType)) return "POS seller ID";
  if (aliasType === STAFF_ALIAS_TYPES.email) return "Login email alias";
  return "Identity alias";
}
function groupIdentityAliases(aliases: StaffAlias[]) {
  const groups = new Map<
    string,
    { value: string; uses: Set<string>; aliases: StaffAlias[] }
  >();
  for (const alias of aliases) {
    const normalizedValue =
      alias.alias_type === STAFF_ALIAS_TYPES.email
        ? alias.alias_value.trim().toLowerCase()
        : alias.alias_value.trim();
    if (!normalizedValue) continue;
    const group = groups.get(normalizedValue) ?? {
      value: normalizedValue,
      uses: new Set<string>(),
      aliases: [],
    };
    if (
      alias.alias_type === STAFF_ALIAS_TYPES.email ||
      alias.alias_type === STAFF_ALIAS_TYPES.shopifyAdminUserId
    ) {
      group.uses.add("Dashboard login");
    }
    if (POS_ALIAS_TYPES.has(alias.alias_type)) group.uses.add("POS sales");
    group.aliases.push(alias);
    groups.set(normalizedValue, group);
  }
  return [...groups.values()].sort((a, b) => a.value.localeCompare(b.value));
}
function blankMetric(): SellerMetric {
  return {
    lastOrderName: null,
    lastOrderId: null,
    firstActivityAt: null,
    lastActivityAt: null,
    lastLocation: null,
    lastDevice: null,
    orderCount: 0,
    netSales: 0,
  };
}

function accessStatus(membership: MembershipRow | null) {
  if (!membership || membership.status !== "active") return "No access";
  if (membership.is_owner) return "Owner";
  if (membership.role === "admin") return "Admin";
  if (membership.role === "manager") return "Manager";
  return "Viewer";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.pathname === "/app/admin/staff") {
    url.searchParams.set(
      "tab",
      url.searchParams.get("tab") === "access" ? "access" : "attribution",
    );
    throw redirect(`/app/people?${url.searchParams.toString()}`);
  }
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.staff",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });
  const [
    peopleResult,
    aliasesResult,
    permissionsResult,
    membershipsResult,
    locationsResult,
    metricsResult,
    setupResult,
    firstTrackedResult,
  ] = await Promise.all([
    supabase
      .from("staff_people")
      .select(
        "id, shop_domain, display_name, email, is_active, created_at, updated_at",
      )
      .eq("shop_domain", session.shop)
      .order("display_name"),
    supabase
      .from("staff_identity_aliases")
      .select(
        "id, shop_domain, person_id, alias_type, alias_value, source, review_status, suggestion_dismissed_at, first_seen_at, last_seen_at, last_location_id, last_device_id, last_device_name, created_at, updated_at",
      )
      .eq("shop_domain", session.shop)
      .order("last_seen_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("user_location_access")
      .select(
        "membership_id, person_id, user_email, shopify_user_id, role, shopify_location_id, location_name",
      )
      .eq("shop_domain", session.shop),
    supabase
      .from("dashboard_memberships")
      .select(
        "id, person_id, normalized_email, display_name, role, status, is_owner",
      )
      .eq("shop_domain", session.shop),
    supabase
      .from("locations")
      .select("shopify_location_id, name")
      .eq("shop_domain", session.shop)
      .eq("shopify_is_active", true)
      .eq("reporting_enabled", true)
      .order("name"),
    supabase
      .from("staff_pos_seller_metrics")
      .select(
        "attribution_source, effective_staff_id, last_order_name, last_activity_at, last_location, last_device, order_count, net_sales, last_shopify_order_id",
      )
      .eq("shop_domain", session.shop),
    supabase
      .from("pos_attribution_setup")
      .select("tile_confirmed_at")
      .eq("shop_domain", session.shop)
      .maybeSingle(),
    supabase
      .from("order_lines")
      .select("created_at_shopify")
      .eq("shop_domain", session.shop)
      .not("shopops_effective_staff_id", "is", null)
      .neq("shopops_effective_staff_id", "")
      .not("shopops_attribution_source", "is", null)
      .order("created_at_shopify", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const result of [
    peopleResult,
    aliasesResult,
    permissionsResult,
    membershipsResult,
    locationsResult,
    metricsResult,
    setupResult,
    firstTrackedResult,
  ])
    if (result.error) throw new Response(result.error.message, { status: 500 });
  const people = (peopleResult.data ?? []) as StaffPersonRow[];
  const aliases = (aliasesResult.data ?? []) as StaffAlias[];
  const permissions = (permissionsResult.data ?? []) as PermissionRow[];
  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const metrics = new Map<string, SellerMetric>();
  for (const row of metricsResult.data ?? []) {
    const candidate = getStaffIdentityAliasCandidates({
      shopops_effective_staff_id: row.effective_staff_id,
      shopops_attribution_source: row.attribution_source,
    })[0];
    if (!candidate) continue;
    const alias = aliases.find(
      (item) =>
        item.alias_type === candidate.aliasType &&
        item.alias_value === candidate.aliasValue,
    );
    metrics.set(
      staffIdentityAliasKey(candidate.aliasType, candidate.aliasValue),
      {
        lastOrderName: row.last_order_name,
        lastOrderId: row.last_shopify_order_id,
        firstActivityAt: alias?.first_seen_at ?? null,
        lastActivityAt: row.last_activity_at,
        lastLocation: row.last_location,
        lastDevice: row.last_device,
        orderCount: Number(row.order_count ?? 0),
        netSales: Number(row.net_sales ?? 0),
      },
    );
  }
  const profiles = people.map((person) => {
    const personAliases = aliases.filter(
      (alias) => alias.person_id === person.id,
    );
    const membership =
      memberships.find((item) => item.person_id === person.id) ?? null;
    const personPermissions = permissions.filter(
      (row) =>
        row.person_id === person.id ||
        Boolean(membership && row.membership_id === membership.id),
    );
    const personDashboardAccess = accessStatus(membership);
    const posMetrics = personAliases.reduce((total, alias) => {
      const item = metrics.get(metricKey(alias));
      if (!item) return total;
      total.orderCount += item.orderCount;
      total.netSales += item.netSales;
      if (
        !total.firstActivityAt ||
        (item.firstActivityAt && item.firstActivityAt < total.firstActivityAt)
      )
        total.firstActivityAt = item.firstActivityAt;
      if (
        !total.lastActivityAt ||
        (item.lastActivityAt && item.lastActivityAt > total.lastActivityAt)
      )
        Object.assign(total, {
          lastActivityAt: item.lastActivityAt,
          lastOrderName: item.lastOrderName,
          lastOrderId: item.lastOrderId,
          lastLocation: item.lastLocation,
          lastDevice: item.lastDevice,
        });
      return total;
    }, blankMetric());
    return {
      ...person,
      aliases: personAliases,
      dashboardAccess: personDashboardAccess,
      membership,
      permissions: personPermissions,
      posMetrics,
      canHardDelete:
        membership === null &&
        personAliases.length === 0 &&
        posMetrics.orderCount === 0,
    };
  });
  const reviewable = aliases.filter(
    (alias) =>
      !alias.person_id &&
      alias.source !== "pos_session_diagnostic" &&
      POS_ALIAS_TYPES.has(alias.alias_type) &&
      metrics.has(metricKey(alias)),
  );
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const loginIdentityByValue = new Map(
    aliases
      .filter(
        (alias) =>
          alias.person_id &&
          alias.alias_type === STAFF_ALIAS_TYPES.shopifyAdminUserId,
      )
      .map((alias) => [alias.alias_value, alias.person_id as string]),
  );
  const suggestions: LoaderData["suggestions"] = {};
  for (const alias of reviewable) {
    if (alias.suggestion_dismissed_at) continue;
    const personId = loginIdentityByValue.get(alias.alias_value);
    const person = personId ? peopleById.get(personId) : null;
    if (person?.is_active) {
      suggestions[alias.id] = {
        personId: person.id,
        displayName: person.display_name,
      };
    }
  }
  return {
    shop: session.shop,
    profiles,
    pending: reviewable.filter((alias) => alias.review_status !== "deferred"),
    deferred: reviewable.filter((alias) => alias.review_status === "deferred"),
    sellerMetrics: Object.fromEntries(metrics),
    locations: (locationsResult.data ?? []) as LocationRow[],
    suggestions,
    posSetup: {
      status: firstTrackedResult.data?.created_at_shopify
        ? "active"
        : setupResult.data?.tile_confirmed_at
          ? "waiting"
          : "not_configured",
      firstTrackedAt: firstTrackedResult.data?.created_at_shopify ?? null,
    },
  } satisfies LoaderData;
}

function friendlyAccessError(message?: string, planHandle?: string | null) {
  if (message?.includes("invalid_access_locations"))
    return "Select at least one valid location.";
  if (
    message?.includes("login_email_in_use") ||
    message?.includes("dashboard_identity_in_use")
  )
    return "That login email is already used by another staff member.";
  if (message?.includes("dashboard_plan_capacity") && planHandle === "solo")
    return "Solo includes dashboard access for the store owner. Upgrade to Growth to add another dashboard user.";
  if (message?.includes("dashboard_plan_capacity"))
    return "Your plan limit has been reached. Upgrade your plan or remove an existing dashboard user's access.";
  if (message?.includes("owner_membership_locked"))
    return "The store owner cannot be removed, disabled, or demoted.";
  if (message?.includes("last_admin_required"))
    return "The last active ShopOps Admin cannot be removed or demoted.";
  if (message?.includes("active_staff_member_required"))
    return "Restore this Staff profile before enabling dashboard access.";
  return "Dashboard access could not be saved. Nothing was changed.";
}

export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  if (url.pathname === "/app/admin/staff") {
    url.searchParams.set(
      "tab",
      url.searchParams.get("tab") === "access" ? "access" : "attribution",
    );
    throw redirect(`/app/people?${url.searchParams.toString()}`);
  }
  const { admin, session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.staff.action",
    shop: session.shop,
    supabase,
  });
  const permissions = await assertAdminAccess({ request, session, supabase });
  if (!permissions.membership) {
    throw new Response("Dashboard membership is required.", { status: 403 });
  }
  const data = await request.formData();
  const intent = text(data.get("intent"));
  const personId = text(data.get("person_id"));
  const aliasId = text(data.get("alias_id"));
  const now = new Date().toISOString();

  if (intent === "apply_csv_mappings") {
    type CsvMapping = {
      aliasId: string;
      action: "create" | "link";
      displayName?: string;
      personId?: string;
    };
    let mappings: CsvMapping[];
    try {
      mappings = JSON.parse(text(data.get("mappings"))) as CsvMapping[];
    } catch {
      return { ok: false, message: "The import selection could not be read." };
    }
    if (!Array.isArray(mappings) || !mappings.length)
      return { ok: false, message: "Choose at least one mapping." };
    let applied = 0;
    for (const mapping of mappings) {
      if (!mapping.aliasId || !["create", "link"].includes(mapping.action))
        continue;
      const aliasResult = await supabase
        .from("staff_identity_aliases")
        .select("id")
        .eq("shop_domain", session.shop)
        .eq("id", mapping.aliasId)
        .eq("alias_type", STAFF_ALIAS_TYPES.posAttributedUserId)
        .is("person_id", null)
        .maybeSingle();
      if (aliasResult.error || !aliasResult.data) continue;
      let targetId = mapping.personId;
      if (mapping.action === "create") {
        const displayName = mapping.displayName?.trim();
        if (!displayName) continue;
        const created = await supabase
          .from("staff_people")
          .insert({
            shop_domain: session.shop,
            display_name: displayName,
            email: null,
          })
          .select("id")
          .single();
        if (created.error)
          return {
            ok: false,
            message: `Import stopped after ${applied} mappings: ${created.error.message}`,
          };
        targetId = created.data.id;
      } else {
        const person = await supabase
          .from("staff_people")
          .select("id")
          .eq("shop_domain", session.shop)
          .eq("id", targetId ?? "")
          .maybeSingle();
        if (!person.data) continue;
      }
      const linked = await supabase
        .from("staff_identity_aliases")
        .update({
          person_id: targetId,
          review_status: "mapped",
          updated_at: now,
        })
        .eq("shop_domain", session.shop)
        .eq("id", mapping.aliasId)
        .is("person_id", null);
      if (linked.error)
        return {
          ok: false,
          message: `Import stopped after ${applied} mappings: ${linked.error.message}`,
        };
      applied += 1;
    }
    return {
      ok: true,
      message: `${applied} POS seller mapping${applied === 1 ? "" : "s"} applied. Dashboard access was not changed.`,
    };
  }

  if (intent === "create_person" || intent === "create_from_alias") {
    const displayName = text(data.get("display_name"));
    const email = text(data.get("email")).toLowerCase() || null;
    if (!displayName)
      return { ok: false, message: "Display name is required." };
    if (intent === "create_from_alias" && !aliasId)
      return { ok: false, message: "POS seller is required." };
    const created = await supabase
      .from("staff_people")
      .insert({ shop_domain: session.shop, display_name: displayName, email })
      .select("id")
      .single();
    if (created.error) return { ok: false, message: created.error.message };
    if (email) {
      const emailResult = await supabase.from("staff_identity_aliases").upsert(
        {
          shop_domain: session.shop,
          person_id: created.data.id,
          alias_type: STAFF_ALIAS_TYPES.email,
          alias_value: email,
          source: "staff_manager",
          review_status: "mapped",
          first_seen_at: now,
          last_seen_at: now,
          updated_at: now,
        },
        { onConflict: "shop_domain,alias_type,alias_value" },
      );
      if (emailResult.error)
        return { ok: false, message: emailResult.error.message };
    }
    if (aliasId) {
      const linked = await supabase
        .from("staff_identity_aliases")
        .update({
          person_id: created.data.id,
          review_status: "mapped",
          updated_at: now,
        })
        .eq("shop_domain", session.shop)
        .eq("id", aliasId)
        .is("person_id", null);
      if (linked.error) return { ok: false, message: linked.error.message };
    }
    return {
      ok: true,
      message: aliasId
        ? "Staff created and POS seller assigned. Dashboard access was not changed."
        : "Staff profile created.",
    };
  }
  if (intent === "link_alias") {
    if (!aliasId || !personId)
      return { ok: false, message: "Choose a staff member." };
    const result = await supabase
      .from("staff_identity_aliases")
      .update({ person_id: personId, review_status: "mapped", updated_at: now })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId)
      .is("person_id", null);
    return result.error
      ? { ok: false, message: result.error.message }
      : {
          ok: true,
          message: "POS seller assigned. Dashboard access was not changed.",
        };
  }
  if (intent === "dismiss_suggestion") {
    if (!aliasId) return { ok: false, message: "POS seller is required." };
    const result = await supabase
      .from("staff_identity_aliases")
      .update({ suggestion_dismissed_at: now, updated_at: now })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId)
      .is("person_id", null);
    return result.error
      ? { ok: false, message: result.error.message }
      : { ok: true, message: "Suggestion dismissed." };
  }
  if (intent === "defer_alias" || intent === "restore_alias") {
    const result = await supabase
      .from("staff_identity_aliases")
      .update({
        review_status: intent === "defer_alias" ? "deferred" : "pending",
        updated_at: now,
      })
      .eq("shop_domain", session.shop)
      .eq("id", aliasId)
      .is("person_id", null);
    return result.error
      ? { ok: false, message: result.error.message }
      : {
          ok: true,
          message:
            intent === "defer_alias"
              ? "Seller saved for later."
              : "Seller returned to review.",
        };
  }
  if (intent === "update_profile") {
    const displayName = text(data.get("display_name"));
    const email = text(data.get("email")).toLowerCase() || null;
    if (!personId || !displayName)
      return { ok: false, message: "Display name is required." };
    const existingMembership = await supabase
      .from("dashboard_memberships")
      .select("id, normalized_email, status")
      .eq("shop_domain", session.shop)
      .eq("person_id", personId)
      .maybeSingle();
    if (existingMembership.error)
      return { ok: false, message: existingMembership.error.message };
    if (
      existingMembership.data?.status === "active" &&
      (existingMembership.data.normalized_email ?? "") !== (email ?? "")
    ) {
      return {
        ok: false,
        message: "Update the login email from Edit dashboard access.",
      };
    }
    const result = await supabase
      .from("staff_people")
      .update({ display_name: displayName, email, updated_at: now })
      .eq("shop_domain", session.shop)
      .eq("id", personId);
    if (!result.error) {
      await supabase
        .from("user_location_access")
        .update({ access_label: displayName })
        .eq("shop_domain", session.shop)
        .eq("person_id", personId);
      if (existingMembership.data)
        await supabase
          .from("dashboard_memberships")
          .update({ display_name: displayName, updated_at: now })
          .eq("shop_domain", session.shop)
          .eq("id", existingMembership.data.id);
    }
    return result.error
      ? { ok: false, message: result.error.message }
      : { ok: true, message: "Profile updated." };
  }
  if (intent === "confirm_pos_tile") {
    const result = await supabase.from("pos_attribution_setup").upsert(
      {
        shop_domain: session.shop,
        tile_confirmed_at: now,
        updated_at: now,
      },
      { onConflict: "shop_domain" },
    );
    return result.error
      ? { ok: false, message: result.error.message }
      : {
          ok: true,
          message:
            "Tile added. Tracking will become active after the first attributed POS sale is synchronized.",
        };
  }
  if (intent === "remove_staff") {
    const result = await supabase.rpc(
      "archive_staff_with_dashboard_protection",
      {
        p_shop_domain: session.shop,
        p_actor_membership_id: permissions.membership.id,
        p_person_id: personId,
      },
    );
    return result.error
      ? { ok: false, message: result.error.message }
      : {
          ok: true,
          message:
            result.data === "deleted"
              ? "Unused staff profile permanently deleted."
              : "Staff archived. Access was removed and reporting history was preserved.",
        };
  }
  if (intent === "restore_staff") {
    const result = await supabase.rpc("restore_archived_staff", {
      p_shop_domain: session.shop,
      p_person_id: personId,
    });
    return result.error
      ? { ok: false, message: result.error.message }
      : { ok: true, message: "Staff restored." };
  }
  if (intent === "remove_dashboard_access") {
    const target = await supabase
      .from("dashboard_memberships")
      .select("id")
      .eq("shop_domain", session.shop)
      .eq("person_id", personId)
      .maybeSingle();
    if (target.error)
      return { ok: false, message: friendlyAccessError(target.error.message) };
    if (!target.data)
      return { ok: true, message: "Dashboard access is already disabled." };
    const result = await supabase.rpc("disable_dashboard_membership", {
      p_shop_domain: session.shop,
      p_actor_membership_id: permissions.membership.id,
      p_target_membership_id: target.data.id,
    });
    return result.error
      ? { ok: false, message: friendlyAccessError(result.error.message) }
      : {
          ok: true,
          message:
            "Dashboard access removed. Profile and POS sales were preserved.",
        };
  }
  if (intent === "save_dashboard_access") {
    const email = text(data.get("email")).toLowerCase();
    const role = text(data.get("role"));
    const { limits } = await getFreshPlanLimits({
      admin,
      shop: session.shop,
    });
    const aliases = await supabase
      .from("staff_identity_aliases")
      .select("alias_value")
      .eq("shop_domain", session.shop)
      .eq("person_id", personId)
      .eq("alias_type", STAFF_ALIAS_TYPES.shopifyAdminUserId);
    if (aliases.error)
      return { ok: false, message: friendlyAccessError(aliases.error.message) };
    const result = await supabase.rpc("replace_dashboard_membership_access", {
      p_shop_domain: session.shop,
      p_actor_membership_id: permissions.membership.id,
      p_person_id: personId,
      p_canonical_email: email,
      p_role: ["viewer", "manager", "admin"].includes(role) ? role : "viewer",
      p_location_ids: data.getAll("location_ids").map(text).filter(Boolean),
      p_shopify_user_ids: [
        ...new Set(
          (aliases.data ?? []).map((row) => row.alias_value).filter(Boolean),
        ),
      ],
      p_dashboard_user_limit: limits.dashboardUsers,
    });
    return result.error
      ? {
          ok: false,
          message: friendlyAccessError(result.error.message, limits.planHandle),
        }
      : { ok: true, message: "Dashboard access saved." };
  }
  return { ok: false, message: "Unknown staff action." };
}

function Button({
  children,
  primary = false,
  danger = false,
  type = "button",
  onClick,
}: {
  children: React.ReactNode;
  primary?: boolean;
  danger?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      className={`staff-button ${primary ? "primary" : ""} ${danger ? "danger" : ""}`}
      type={type}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ShopifyOrderLink({
  shop,
  orderId,
  orderName,
}: {
  shop: string;
  orderId: string | null;
  orderName: string | null;
}) {
  const url = orderId ? buildShopifyOrderUrl(shop, orderId) : null;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {orderName ?? "Open order"}
    </a>
  ) : (
    <>{orderName ?? "—"}</>
  );
}

function OverlayPanel({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="staff-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className={`staff-panel ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="panel-body">{children}</div>
      </section>
    </div>
  );
}

function AccessForm({
  profile,
  locations,
}: {
  profile: StaffProfile;
  locations: LocationRow[];
}) {
  if (profile.membership?.is_owner) {
    return (
      <p className="hint">
        The Shopify store owner is always active, always an administrator, and
        cannot be edited or removed.
      </p>
    );
  }
  const role = profile.membership?.role ?? "viewer";
  const allLocations = profile.permissions.some(
    (row) => row.shopify_location_id === "*",
  );
  return (
    <Form method="post" className="form-stack">
      <input type="hidden" name="intent" value="save_dashboard_access" />
      <input type="hidden" name="person_id" value={profile.id} />
      <label>
        Login email
        <input
          name="email"
          type="email"
          required
          defaultValue={profile.email ?? ""}
        />
      </label>
      <label>
        Role
        <select name="role" defaultValue={role}>
          <option value="viewer">Viewer</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <fieldset>
        <legend>Accessible locations</legend>
        {locations.map((location) => (
          <label className="check" key={location.shopify_location_id}>
            <input
              type="checkbox"
              name="location_ids"
              value={location.shopify_location_id}
              defaultChecked={
                allLocations ||
                profile.permissions.some(
                  (row) =>
                    row.shopify_location_id === location.shopify_location_id,
                )
              }
            />
            {location.name}
          </label>
        ))}
      </fieldset>
      <p className="hint">
        Shopify login identities already linked to this person are preserved
        automatically.
      </p>
      <Button primary type="submit">
        Save access
      </Button>
    </Form>
  );
}

function PendingReview({
  pending,
  metrics,
  profiles,
  suggestions,
  shop,
}: {
  pending: StaffAlias[];
  metrics: Record<string, SellerMetric>;
  profiles: StaffProfile[];
  suggestions: LoaderData["suggestions"];
  shop: string;
}) {
  const [assigning, setAssigning] = useState<string | null>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const people = profiles.filter(
    (profile) =>
      profile.is_active &&
      `${profile.display_name} ${profile.email ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="review-list">
      {pending.map((alias) => {
        const metric = metrics[metricKey(alias)] ?? blankMetric();
        const suggestion = suggestions[alias.id];
        const orderUrl = metric.lastOrderId
          ? buildShopifyOrderUrl(shop, metric.lastOrderId)
          : null;
        return (
          <article className="seller-row" key={alias.id}>
            <div className="seller-facts">
              <span>
                <b>Shopify staff ID</b>
                <span className="copy-value">
                  {alias.alias_value}
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard.writeText(alias.alias_value)
                    }
                  >
                    Copy
                  </button>
                </span>
              </span>
              <span>
                <b>Last order</b>
                {orderUrl ? (
                  <a href={orderUrl} target="_blank" rel="noreferrer">
                    {metric.lastOrderName ?? "Open order"}
                  </a>
                ) : (
                  (metric.lastOrderName ?? "—")
                )}
              </span>
              <span>
                <b>Location</b>
                {metric.lastLocation ?? "—"}
              </span>
              <span>
                <b>Last activity</b>
                {date(metric.lastActivityAt)}
              </span>
              <span>
                <b>Net sales</b>
                {money(metric.netSales)}
              </span>
            </div>
            {suggestion && assigning !== alias.id ? (
              <div className="suggestion">
                <div>
                  <b>Suggested match: {suggestion.displayName}</b>
                  <small>Reason: Same Shopify identity</small>
                </div>
                <div className="row-actions">
                  <Form method="post">
                    <input type="hidden" name="intent" value="link_alias" />
                    <input type="hidden" name="alias_id" value={alias.id} />
                    <input
                      type="hidden"
                      name="person_id"
                      value={suggestion.personId}
                    />
                    <Button primary type="submit">
                      Confirm
                    </Button>
                  </Form>
                  <Button
                    onClick={() => {
                      setMode("existing");
                      setAssigning(alias.id);
                    }}
                  >
                    Choose someone else
                  </Button>
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="dismiss_suggestion"
                    />
                    <input type="hidden" name="alias_id" value={alias.id} />
                    <Button type="submit">Dismiss</Button>
                  </Form>
                </div>
              </div>
            ) : null}
            {assigning === alias.id ? (
              <div className="assign-box">
                <h3>Who is this seller?</h3>
                <div className="segmented">
                  <button
                    type="button"
                    aria-pressed={mode === "existing"}
                    onClick={() => setMode("existing")}
                  >
                    Existing staff
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "new"}
                    onClick={() => setMode("new")}
                  >
                    Create new
                  </button>
                </div>
                {mode === "existing" ? (
                  <Form method="post" className="form-stack">
                    <input type="hidden" name="intent" value="link_alias" />
                    <input type="hidden" name="alias_id" value={alias.id} />
                    <input
                      aria-label="Search staff"
                      placeholder="Search by name or email"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    <select
                      name="person_id"
                      required
                      size={Math.min(5, Math.max(2, people.length))}
                    >
                      {people.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.display_name}
                          {profile.email ? ` · ${profile.email}` : ""} ·{" "}
                          {profile.dashboardAccess}
                        </option>
                      ))}
                    </select>
                    <Button primary type="submit">
                      Assign seller
                    </Button>
                  </Form>
                ) : (
                  <Form method="post" className="form-stack">
                    <input
                      type="hidden"
                      name="intent"
                      value="create_from_alias"
                    />
                    <input type="hidden" name="alias_id" value={alias.id} />
                    <label>
                      Display name
                      <input name="display_name" required />
                    </label>
                    <label>
                      Email <small>Optional</small>
                      <input name="email" type="email" />
                    </label>
                    <Button primary type="submit">
                      Create and assign
                    </Button>
                  </Form>
                )}
              </div>
            ) : suggestion ? null : (
              <div className="row-actions">
                <Button primary onClick={() => setAssigning(alias.id)}>
                  Assign
                </Button>
                <Form method="post">
                  <input type="hidden" name="intent" value="defer_alias" />
                  <input type="hidden" name="alias_id" value={alias.id} />
                  <Button type="submit">Later</Button>
                </Form>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function CsvImport({
  pending,
  profiles,
  metrics,
}: {
  pending: StaffAlias[];
  profiles: StaffProfile[];
  metrics: Record<string, SellerMetric>;
}) {
  const [preview, setPreview] = useState<ShopifyStaffCsvResult | null>(null);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<
    Record<string, { action: "create" | "link" | "skip"; personId?: string }>
  >({});
  const [confirmed, setConfirmed] = useState(false);
  const exactAliases = new Map(
    pending
      .filter(
        (alias) => alias.alias_type === STAFF_ALIAS_TYPES.posAttributedUserId,
      )
      .map((alias) => [alias.alias_value, alias]),
  );
  const mappedAliases = new Map(
    profiles.flatMap((profile) =>
      profile.aliases
        .filter(
          (alias) => alias.alias_type === STAFF_ALIAS_TYPES.posAttributedUserId,
        )
        .map((alias) => [alias.alias_value, profile] as const),
    ),
  );
  const exactRows =
    preview?.rows.filter((row) => exactAliases.has(row.sellerId)) ?? [];
  const mappedRows =
    preview?.rows.filter((row) => mappedAliases.has(row.sellerId)) ?? [];
  const unmatchedRows =
    preview?.rows.filter(
      (row) =>
        !exactAliases.has(row.sellerId) && !mappedAliases.has(row.sellerId),
    ) ?? [];
  const selected = exactRows.filter(
    (row) =>
      choices[row.sellerId]?.action === "create" ||
      (choices[row.sellerId]?.action === "link" &&
        choices[row.sellerId]?.personId),
  );
  return (
    <div className="import-flow">
      <p>
        Use a Shopify sales export to map many detected sellers to readable
        names. This never changes dashboard access.
      </p>
      <p className="hint">
        Required CSV fields: assisting_staff_id and assisting_staff_member_name.
        POS location name and net sales are optional.
      </p>
      <ol>
        <li>Open Shopify Admin → Analytics → Reports</li>
        <li>Create a new exploration</li>
        <li>Open the ShopifyQL editor</li>
        <li>Paste the query below</li>
        <li>Run the report</li>
        <li>Export as CSV</li>
        <li>Upload the CSV to ShopOps</li>
      </ol>
      <div className="query">
        <pre>{SHOPIFY_QUERY}</pre>
        <Button
          onClick={() => void navigator.clipboard.writeText(SHOPIFY_QUERY)}
        >
          Copy query
        </Button>
      </div>
      <label className="upload">
        Upload Shopify CSV
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then((value) => {
              try {
                setPreview(parseShopifyStaffCsv(value));
                setError("");
                setChoices({});
                setConfirmed(false);
              } catch (caught) {
                setPreview(null);
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Could not read CSV.",
                );
              }
            });
          }}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      {preview ? (
        <div className="preview">
          <div className="preview-counts">
            <span>
              <b>{exactRows.length}</b> Exact matches
            </span>
            <span>
              <b>{preview.conflicts.length}</b> Conflicts
            </span>
            <span>
              <b>{unmatchedRows.length}</b> No matching sales
            </span>
            <span>
              <b>{mappedRows.length}</b> Already mapped
            </span>
          </div>
          {exactRows.map((row) => {
            const alias = exactAliases.get(row.sellerId)!;
            const metric = metrics[metricKey(alias)] ?? blankMetric();
            const sameName = profiles.find(
              (profile) =>
                profile.display_name.toLowerCase() ===
                row.displayName.toLowerCase(),
            );
            const choice = choices[row.sellerId];
            return (
              <article className="preview-row" key={row.sellerId}>
                <div>
                  <b>{row.displayName}</b>
                  <span>
                    Exact POS seller match · {metric.orderCount} orders
                    {row.locations[0] ? ` · ${row.locations[0]}` : ""}
                  </span>
                  {sameName ? (
                    <small>
                      Suggestion: existing staff member {sameName.display_name}.
                      Confirmation required.
                    </small>
                  ) : null}
                </div>
                <select
                  aria-label={`Action for ${row.displayName}`}
                  value={choice?.action ?? "skip"}
                  onChange={(event) =>
                    setChoices((current) => ({
                      ...current,
                      [row.sellerId]: {
                        action: event.target.value as
                          | "create"
                          | "link"
                          | "skip",
                      },
                    }))
                  }
                >
                  <option value="skip">Skip</option>
                  <option value="create">Create staff</option>
                  <option value="link">Link to existing</option>
                </select>
                {choice?.action === "link" ? (
                  <select
                    aria-label={`Staff member for ${row.displayName}`}
                    value={choice.personId ?? ""}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [row.sellerId]: {
                          action: "link",
                          personId: event.target.value,
                        },
                      }))
                    }
                  >
                    <option value="">Choose staff member</option>
                    {profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.display_name}
                        {profile.email ? ` · ${profile.email}` : ""}
                      </option>
                    ))}
                  </select>
                ) : null}
              </article>
            );
          })}
          {preview.conflicts.map((conflict) => (
            <article className="preview-row warning" key={conflict.sellerId}>
              <div>
                <b>Conflicting names</b>
                <span>
                  {conflict.names.join(" / ")} · Merchant review required
                </span>
              </div>
            </article>
          ))}
          {mappedRows.map((row) => (
            <article className="preview-row" key={row.sellerId}>
              <div>
                <b>{row.displayName}</b>
                <span>
                  Already mapped to{" "}
                  {mappedAliases.get(row.sellerId)?.display_name}
                </span>
              </div>
            </article>
          ))}
          {unmatchedRows.map((row) => (
            <article className="preview-row muted" key={row.sellerId}>
              <div>
                <b>{row.displayName}</b>
                <span>No matching ShopOps sales found</span>
              </div>
            </article>
          ))}
          {preview.ignoredRows ? (
            <p className="hint">
              {preview.ignoredRows} blank or incomplete rows ignored.
            </p>
          ) : null}
          {selected.length ? (
            <div className="confirm">
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I confirm {selected.length} mapping
                {selected.length === 1 ? "" : "s"}. Dashboard access will not be
                changed.
              </label>
              {confirmed ? (
                <Form method="post" className="bulk-forms">
                  <input
                    type="hidden"
                    name="intent"
                    value="apply_csv_mappings"
                  />
                  <input
                    type="hidden"
                    name="mappings"
                    value={JSON.stringify(
                      selected.map((row) => ({
                        aliasId: exactAliases.get(row.sellerId)!.id,
                        action: choices[row.sellerId].action,
                        displayName: row.displayName,
                        personId: choices[row.sellerId].personId,
                      })),
                    )}
                  />
                  <Button primary type="submit">
                    Apply {selected.length} mappings
                  </Button>
                </Form>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function StaffPage() {
  const data = useLoaderData<LoaderData>();
  const result = useActionData<ActionData>();
  const navigation = useNavigation();
  const location = useLocation();
  const tab =
    new URLSearchParams(location.search).get("tab") === "access"
      ? "access"
      : "attribution";
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [menu, setMenu] = useState<string | null>(null);
  const selected =
    data.profiles.find((profile) => profile.id === selectedId) ?? null;
  const filtered = useMemo(
    () =>
      data.profiles.filter((profile) => {
        const query =
          `${profile.display_name} ${profile.email ?? ""}`.toLowerCase();
        if (!query.includes(search.toLowerCase())) return false;
        if (filter === "archived") return !profile.is_active;
        if (!profile.is_active) return false;
        if (filter === "access") return profile.dashboardAccess !== "No access";
        if (tab === "attribution" && filter === "pos")
          return profile.posMetrics.orderCount > 0;
        if (filter === "attention")
          return (
            !profile.is_active ||
            (!profile.email && profile.dashboardAccess !== "No access")
          );
        return true;
      }),
    [data.profiles, filter, search, tab],
  );
  const open = (next: Overlay, profile?: StaffProfile) => {
    setSelectedId(profile?.id ?? null);
    setOverlay(next);
    setMenu(null);
  };
  const locationLabel = (profile: StaffProfile) => {
    const names = [
      ...new Set(
        profile.permissions.map((row) => row.location_name).filter(Boolean),
      ),
    ];
    if (profile.permissions.some((row) => row.shopify_location_id === "*"))
      return "All locations";
    return names.length > 1 ? `${names.length} locations` : (names[0] ?? "—");
  };
  return (
    <ShopOpsPage className="staff-page">
      <style>{STAFF_CSS}</style>
      <style>{STAFF_LIFECYCLE_CSS}</style>
      <div className="staff-shell">
        <PageHeader
          action={
            tab === "attribution" ? (
              <Button primary onClick={() => open("add")}>
                + Add staff
              </Button>
            ) : undefined
          }
          description="Manage sales attribution and access to ShopOps Studio."
          icon={PersonIcon}
          title="People"
        />
        <SectionTabs
          activeTab={tab}
          ariaLabel="People sections"
          tabs={[
            { value: "attribution", label: "Sales attribution" },
            { value: "access", label: "Dashboard access" },
          ]}
        />
        {result ? (
          <div className={`notice ${result.ok ? "success" : "error"}`}>
            {result.message}
          </div>
        ) : null}
        {tab === "attribution" && data.posSetup.status !== "active" ? (
          <div className="pending-notice setup-notice">
            <span>
              <b>Finish POS sales tracking</b>
              <small>
                {data.posSetup.status === "waiting"
                  ? "Waiting for the first tracked POS sale."
                  : "Add the ShopOps tile to start Sales by Staff tracking."}
              </small>
            </span>
            <Button onClick={() => open("setup")}>Set up</Button>
          </div>
        ) : tab === "attribution" ? (
          <p className="tracking-active">
            Sales by Staff tracking active since{" "}
            {date(data.posSetup.firstTrackedAt)}.
          </p>
        ) : null}
        {tab === "attribution" && data.pending.length ? (
          <div className="pending-notice">
            <span>
              <b>
                {data.pending.length} POS seller
                {data.pending.length === 1 ? "" : "s"} need assignment
              </b>
              <small>Give sales a readable staff name.</small>
            </span>
            <Button onClick={() => open("pending")}>Review</Button>
          </div>
        ) : null}
        {tab === "access" ? (
          <InlineNotice>
            The store owner always has access and uses one dashboard seat.
          </InlineNotice>
        ) : null}
        <section className="roster">
          <div className="toolbar">
            <label className="search">
              <span>⌕</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or email"
                aria-label="Search by name or email"
              />
            </label>
            <div className="filters">
              {(tab === "access"
                ? [
                    ["all", "All"],
                    ["access", "Active memberships"],
                    ["attention", "Needs attention"],
                    ["archived", "Archived"],
                  ]
                : [
                    ["all", "All"],
                    ["pos", "POS sellers"],
                    ["attention", "Needs attention"],
                    ["archived", "Archived"],
                  ]
              ).map(([value, label]) => (
                <button
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  key={value}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={`staff-table ${tab}`}>
            <div className="table-head">
              <span>{tab === "access" ? "Person" : "Staff profile"}</span>
              <span>{tab === "access" ? "Role" : "POS sales"}</span>
              <span>{tab === "access" ? "Dashboard access" : "Locations"}</span>
              <span>{tab === "access" ? "Assigned locations" : "Status"}</span>
              <span>Actions</span>
            </div>
            {filtered.map((profile) =>
              tab === "access" && profile.membership?.is_owner ? (
                <div className="staff-row owner-row" key={profile.id}>
                  <span className="identity">
                    <b>{profile.display_name}</b>
                    <small>{profile.email ?? "No email"}</small>
                  </span>
                  <span>
                    <StatusBadge variant="info">Owner</StatusBadge>
                  </span>
                  <span className="owner-access">
                    <StatusBadge variant="success">Active</StatusBadge>
                    <small>Always has access</small>
                  </span>
                  <span>All locations</span>
                  <span className="owner-lock" title="Owner access is locked">
                    <Icon source={PersonLockIcon} tone="subdued" />
                    Locked
                  </span>
                </div>
              ) : (
                <div
                  className="staff-row"
                  key={profile.id}
                  onClick={(event) => {
                    if (!(event.target as HTMLElement).closest(".actions")) {
                      open(
                        tab === "access" && !profile.membership?.is_owner
                          ? "access"
                          : "details",
                        profile,
                      );
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      open(
                        tab === "access" && !profile.membership?.is_owner
                          ? "access"
                          : "details",
                        profile,
                      );
                    }
                  }}
                >
                  <span className="identity">
                    <b>{profile.display_name}</b>
                    <small>{profile.email ?? "No email"}</small>
                  </span>
                  {tab === "access" ? (
                    <span>
                      <StatusBadge
                        variant={
                          profile.membership?.status !== "active"
                            ? "neutral"
                            : "info"
                        }
                      >
                        {profile.membership?.status === "active"
                          ? profile.dashboardAccess
                          : "—"}
                      </StatusBadge>
                    </span>
                  ) : null}
                  {tab === "attribution" ? (
                    <span>
                      <StatusBadge
                        variant={
                          profile.posMetrics.orderCount ? "info" : "neutral"
                        }
                      >
                        {profile.posMetrics.orderCount
                          ? "Linked"
                          : "Not linked"}
                      </StatusBadge>
                    </span>
                  ) : null}
                  {tab === "access" ? (
                    <span>
                      <StatusBadge
                        variant={
                          profile.membership?.status === "active"
                            ? "success"
                            : "neutral"
                        }
                      >
                        {profile.membership?.status === "active"
                          ? "Active"
                          : "No access"}
                      </StatusBadge>
                    </span>
                  ) : null}
                  <span>{locationLabel(profile)}</span>
                  {tab === "attribution" ? (
                    <span>
                      <StatusBadge
                        variant={profile.is_active ? "success" : "warning"}
                      >
                        {profile.is_active ? "Active" : "Inactive"}
                      </StatusBadge>
                    </span>
                  ) : null}
                  <span className="actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Actions for ${profile.display_name}`}
                      onClick={() =>
                        setMenu(menu === profile.id ? null : profile.id)
                      }
                    >
                      •••
                    </button>
                    {menu === profile.id ? (
                      <div className="menu">
                        <button
                          type="button"
                          onClick={() =>
                            open(
                              tab === "access" && !profile.membership?.is_owner
                                ? "access"
                                : "details",
                              profile,
                            )
                          }
                        >
                          View
                        </button>
                        {tab === "access" && !profile.membership?.is_owner ? (
                          <button
                            type="button"
                            onClick={() => open("access", profile)}
                          >
                            {profile.dashboardAccess === "No access"
                              ? "Enable access"
                              : "Edit access"}
                          </button>
                        ) : null}
                        {tab === "attribution" && profile.is_active ? (
                          !profile.membership?.is_owner ? (
                            <button
                              type="button"
                              onClick={() => open("remove", profile)}
                            >
                              Remove staff
                            </button>
                          ) : null
                        ) : tab === "attribution" ? (
                          <Form method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="restore_staff"
                            />
                            <input
                              type="hidden"
                              name="person_id"
                              value={profile.id}
                            />
                            <button type="submit">Restore</button>
                          </Form>
                        ) : null}
                      </div>
                    ) : null}
                  </span>
                </div>
              ),
            )}
            {!filtered.length ? (
              <EmptyState
                title="No people match these filters."
                description="Try another search or filter."
              />
            ) : null}
          </div>
          <footer className="roster-footer">
            <span>
              {filtered.length} of {data.profiles.length} staff
            </span>
            {tab === "attribution" ? (
              <button type="button" onClick={() => open("import")}>
                Import staff names from Shopify
              </button>
            ) : null}
            {tab === "attribution" && data.deferred.length ? (
              <button type="button" onClick={() => open("pending")}>
                {data.deferred.length} saved for later
              </button>
            ) : null}
          </footer>
        </section>
        {navigation.state !== "idle" ? (
          <div className="saving">Saving…</div>
        ) : null}
      </div>
      {overlay === "add" ? (
        <OverlayPanel title="Add staff" onClose={() => setOverlay(null)}>
          <Form method="post" className="form-stack">
            <input type="hidden" name="intent" value="create_person" />
            <label>
              Display name
              <input name="display_name" required />
            </label>
            <label>
              Email <small>Optional</small>
              <input name="email" type="email" />
            </label>
            <p className="hint">
              This creates a staff profile only. Dashboard access and POS sales
              can be connected afterward.
            </p>
            <Button primary type="submit">
              Add staff
            </Button>
          </Form>
        </OverlayPanel>
      ) : null}
      {overlay === "pending" ? (
        <OverlayPanel
          title="POS sellers needing assignment"
          onClose={() => setOverlay(null)}
          wide
        >
          <PendingReview
            pending={[...data.pending, ...data.deferred]}
            metrics={data.sellerMetrics}
            profiles={data.profiles}
            suggestions={data.suggestions}
            shop={data.shop}
          />
        </OverlayPanel>
      ) : null}
      {overlay === "import" ? (
        <OverlayPanel
          title="Import staff names from Shopify"
          onClose={() => setOverlay(null)}
          wide
        >
          <CsvImport
            pending={[...data.pending, ...data.deferred]}
            profiles={data.profiles}
            metrics={data.sellerMetrics}
          />
        </OverlayPanel>
      ) : null}
      {overlay === "setup" ? (
        <OverlayPanel
          title="Set up POS sales tracking"
          onClose={() => setOverlay(null)}
        >
          <div className="setup-flow">
            <section>
              <StatusBadge
                variant={
                  data.posSetup.status === "not_configured"
                    ? "warning"
                    : "success"
                }
              >
                {data.posSetup.status === "not_configured"
                  ? "Not configured"
                  : "Tile added"}
              </StatusBadge>
              <h3>1. Add the ShopOps POS tile</h3>
              <ol>
                <li>Open Shopify Admin</li>
                <li>Go to Point of Sale → Settings</li>
                <li>Open POS app / Smart Grid editor</li>
                <li>Select the Smart Grid template used by the store</li>
                <li>Click Add tile</li>
                <li>Select Embedded Apps</li>
                <li>Select the ShopOps POS attribution tile</li>
                <li>Save</li>
                <li>
                  Repeat or assign the template to other POS locations when
                  required
                </li>
              </ol>
              {data.posSetup.status === "not_configured" ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="confirm_pos_tile" />
                  <Button primary type="submit">
                    I added the tile
                  </Button>
                </Form>
              ) : null}
            </section>
            <section>
              <StatusBadge
                variant={
                  data.posSetup.status === "active" ? "success" : "neutral"
                }
              >
                {data.posSetup.status === "active"
                  ? "Active"
                  : "Waiting for first tracked sale"}
              </StatusBadge>
              <h3>2. Verify tracking</h3>
              <p>Complete one test POS sale after adding the tile.</p>
              <p className="hint">
                {data.posSetup.status === "active"
                  ? `Sales by Staff tracking active since ${date(data.posSetup.firstTrackedAt)}.`
                  : "Sales by Staff starts after the ShopOps POS tile is added and a new POS sale is synchronized."}
              </p>
            </section>
            <section>
              <StatusBadge variant="neutral">Optional</StatusBadge>
              <h3>3. Import staff names</h3>
              <p>
                Import assisting staff IDs and names from Shopify Analytics to
                assign multiple POS sellers faster.
              </p>
              <Button onClick={() => setOverlay("import")}>
                Import staff names
              </Button>
              <p className="hint">
                The import maps names to detected seller IDs. It cannot recreate
                seller attribution for older unstamped orders.
              </p>
            </section>
          </div>
        </OverlayPanel>
      ) : null}
      {selected && overlay === "remove" ? (
        <OverlayPanel
          title="Remove staff"
          onClose={() => setOverlay("details")}
        >
          <div className="remove-confirmation">
            <h3>
              {selected.canHardDelete
                ? "Permanently delete this unused profile?"
                : "Archive this staff member?"}
            </h3>
            <p>
              {selected.canHardDelete
                ? `${selected.display_name} has no dashboard access, seller identities, or reporting history. This unused profile will be permanently deleted.`
                : `${selected.display_name} will be hidden from the active Staff list. Dashboard access will be removed, while POS mappings, identities, and Sales by Staff history remain preserved.`}
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="remove_staff" />
              <input type="hidden" name="person_id" value={selected.id} />
              <Button danger type="submit">
                {selected.canHardDelete
                  ? "Permanently delete"
                  : "Archive staff"}
              </Button>
            </Form>
          </div>
        </OverlayPanel>
      ) : null}
      {selected && overlay === "profile" ? (
        <OverlayPanel
          title="Edit profile"
          onClose={() => setOverlay("details")}
        >
          <Form method="post" className="form-stack">
            <input type="hidden" name="intent" value="update_profile" />
            <input type="hidden" name="person_id" value={selected.id} />
            <label>
              Name
              <input
                name="display_name"
                defaultValue={selected.display_name}
                required
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={selected.email ?? ""}
              />
            </label>
            <Button primary type="submit">
              Save profile
            </Button>
          </Form>
        </OverlayPanel>
      ) : null}
      {selected && overlay === "access" ? (
        <OverlayPanel
          title={`${selected.dashboardAccess === "No access" ? "Enable" : "Edit"} dashboard access`}
          onClose={() => setOverlay("details")}
        >
          <AccessForm profile={selected} locations={data.locations} />
          {selected.dashboardAccess !== "No access" &&
          !selected.membership?.is_owner ? (
            <Form method="post" className="remove-access">
              <input
                type="hidden"
                name="intent"
                value="remove_dashboard_access"
              />
              <input type="hidden" name="person_id" value={selected.id} />
              <Button danger type="submit">
                Remove dashboard access
              </Button>
              <p className="hint">
                Profile, login aliases, POS attribution, and historical sales
                are preserved.
              </p>
            </Form>
          ) : null}
        </OverlayPanel>
      ) : null}
      {selected && overlay === "details" ? (
        <OverlayPanel
          title={selected.display_name}
          onClose={() => setOverlay(null)}
        >
          <div className="detail-sections">
            <section>
              <div>
                <h3>Profile</h3>
                <p>
                  {selected.email ?? "No email"} ·{" "}
                  {selected.is_active ? "Active" : "Inactive"}
                </p>
              </div>
              <Button onClick={() => setOverlay("profile")}>Edit</Button>
            </section>
            <section>
              <div>
                <h3>Dashboard access</h3>
                <p>
                  <b>
                    {selected.dashboardAccess === "No access"
                      ? "No access"
                      : "Enabled"}
                  </b>
                  {selected.dashboardAccess !== "No access"
                    ? ` · ${selected.email ?? "No login email"} · ${selected.dashboardAccess} · ${locationLabel(selected)}`
                    : ""}
                </p>
                <small>Login email controls access to ShopOps.</small>
              </div>
              {selected.membership?.is_owner ? (
                <StatusBadge variant="neutral">Locked</StatusBadge>
              ) : (
                <Button onClick={() => setOverlay("access")}>
                  {selected.dashboardAccess === "No access" ? "Enable" : "Edit"}
                </Button>
              )}
            </section>
            <section>
              <div>
                <h3>POS sales</h3>
                <p>
                  <b>
                    {selected.posMetrics.orderCount ? "Linked" : "Not linked"}
                  </b>
                  {selected.posMetrics.orderCount
                    ? ` · ${selected.posMetrics.orderCount} orders · ${money(selected.posMetrics.netSales)}`
                    : ""}
                </p>
                <small>
                  First activity {date(selected.posMetrics.firstActivityAt)} ·
                  Last activity {date(selected.posMetrics.lastActivityAt)}
                </small>
                {selected.posMetrics.lastOrderName ? (
                  <small>
                    Last order:{" "}
                    <ShopifyOrderLink
                      shop={data.shop}
                      orderId={selected.posMetrics.lastOrderId}
                      orderName={selected.posMetrics.lastOrderName}
                    />
                  </small>
                ) : null}
                <small>
                  POS seller matching controls Sales by Staff reporting and does
                  not grant dashboard access.
                </small>
              </div>
              <Button onClick={() => setOverlay("pos")}>Manage</Button>
            </section>
            <details>
              <summary>Advanced details</summary>
              <div className="advanced">
                {selected.aliases.length ? (
                  groupIdentityAliases(selected.aliases).map((group) => (
                    <div className="identity-group" key={group.value}>
                      <code>{group.value}</code>
                      <span>
                        Used for: {[...group.uses].join(" · ") || "Identity"}
                      </span>
                      <details>
                        <summary>Raw identity sources</summary>
                        <div>
                          {group.aliases.map((alias) => (
                            <code key={alias.id}>
                              {advancedAliasLabel(alias.alias_type)} · Source:{" "}
                              {alias.source ?? "unknown"}
                            </code>
                          ))}
                        </div>
                      </details>
                    </div>
                  ))
                ) : (
                  <span>No technical identities.</span>
                )}
              </div>
            </details>
            {selected.is_active && !selected.membership?.is_owner ? (
              <div className="detail-remove">
                <Button danger onClick={() => setOverlay("remove")}>
                  Remove staff
                </Button>
              </div>
            ) : null}
          </div>
        </OverlayPanel>
      ) : null}
      {selected && overlay === "pos" ? (
        <OverlayPanel
          title="Manage POS sales"
          onClose={() => setOverlay("details")}
        >
          <div className="pos-summary">
            <StatusBadge
              variant={selected.posMetrics.orderCount ? "info" : "neutral"}
            >
              {selected.posMetrics.orderCount ? "Linked" : "Not linked"}
            </StatusBadge>
            <h3>
              {selected.posMetrics.orderCount} orders ·{" "}
              {money(selected.posMetrics.netSales)}
            </h3>
            {selected.posMetrics.lastOrderName ? (
              <p>
                Last order:{" "}
                <ShopifyOrderLink
                  shop={data.shop}
                  orderId={selected.posMetrics.lastOrderId}
                  orderName={selected.posMetrics.lastOrderName}
                />
              </p>
            ) : null}
            <p>
              All linked seller identities are combined into this reporting
              summary. Technical identities are available under Advanced
              details.
            </p>
            <Button
              onClick={() => {
                setOverlay("pending");
                setSelectedId(null);
              }}
            >
              Review unassigned sellers
            </Button>
          </div>
        </OverlayPanel>
      ) : null}
    </ShopOpsPage>
  );
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

const STAFF_LIFECYCLE_CSS = `
.tracking-active{color:#39714f;font-size:13px;margin:0 0 14px;padding:0 2px}
.setup-flow{display:grid}
.setup-flow>section{border-bottom:1px solid #e5e5e5;padding:18px 0}
.setup-flow>section:first-child{padding-top:0}
.setup-flow>section:last-child{border:0}
.setup-flow h3{font-size:16px;margin:10px 0}
.setup-flow ol{color:#454545;display:grid;gap:6px;padding-left:22px}
.detail-remove{padding-top:18px}
.remove-confirmation h3{margin-top:0}
.remove-confirmation p{color:#454545;line-height:1.5}
.copy-value{align-items:center!important;display:flex!important;flex-direction:row!important;gap:7px}.copy-value button{background:transparent;border:0;color:#255aa8;cursor:pointer;font-size:12px;padding:0}.suggestion{background:#eef5ff;border-radius:9px;margin-top:14px;padding:12px}.suggestion>div:first-child{display:grid;gap:3px}.suggestion small{color:#516072}.identity-group{border-bottom:1px solid #ededed;display:grid;gap:5px;padding:10px 0}.identity-group>code{background:transparent;padding:0}.identity-group>span{color:#454545;font-size:13px}.identity-group details{padding:2px 0}.identity-group details>div{display:grid;gap:5px;margin-top:7px}
`;

const STAFF_CSS = `
*{box-sizing:border-box}.staff-page{color:#202223}.staff-shell{max-width:none;margin:0}.staff-button{background:#fff;border:1px solid #c9cccf;border-radius:10px;color:#202223;cursor:pointer;font-weight:650;padding:9px 13px}.staff-button:hover{background:#f6f6f7}.staff-button.primary{background:var(--shopops-accent);border-color:var(--shopops-accent);color:#fff}.staff-button.primary:hover{background:var(--shopops-accent-strong)}.staff-button.danger{color:#b42318}.notice,.pending-notice{border-radius:12px;margin-bottom:14px;padding:12px 14px}.notice.success{background:#eaf7ef;color:#166534}.notice.error{background:#fff0f0;color:#b42318}.pending-notice{align-items:center;background:#eef5ff;border:1px solid #c8dcfa;display:flex;justify-content:space-between}.pending-notice span{display:grid;gap:2px}.pending-notice small{color:#4b5563}.shopops-inline-notice+.roster{margin-top:14px}.roster{background:#fff;border:1px solid var(--shopops-border);border-radius:16px;box-shadow:0 1px 3px #0000000a;overflow:visible}.toolbar{align-items:center;border-bottom:1px solid #e8e8e8;display:flex;gap:14px;padding:14px}.search{align-items:center;border:1px solid #c9cccf;border-radius:8px;display:flex;min-width:260px;padding:0 10px}.search:focus-within{border-color:#2563eb;box-shadow:0 0 0 3px #bfdbfe}.search input{border:0;outline:0;padding:9px;width:100%}.filters{display:flex;gap:4px;overflow:auto}.filters button,.segmented button{background:transparent;border:0;border-radius:7px;cursor:pointer;padding:8px 11px;white-space:nowrap}.filters button[aria-pressed=true],.segmented button[aria-pressed=true]{background:var(--shopops-accent-soft);color:var(--shopops-accent-strong);font-weight:700}.table-head,.staff-row{align-items:center;display:grid;gap:16px;grid-template-columns:minmax(210px,1.5fr) 1fr .8fr 1fr .65fr 52px;padding:0 16px}.staff-table.attribution .table-head,.staff-table.attribution .staff-row,.staff-table.access .table-head,.staff-table.access .staff-row{grid-template-columns:minmax(210px,1.5fr) 1fr 1fr .65fr 86px}.table-head{background:#f7f7f7;color:#616161;font-size:12px;font-weight:700;min-height:38px;text-transform:uppercase}.staff-row{border-top:1px solid #ededed;cursor:pointer;min-height:68px}.staff-row:hover{background:#fafafa}.staff-row.owner-row{background:var(--shopops-accent-soft);cursor:default}.owner-access{display:grid;gap:5px}.owner-access small{color:var(--shopops-muted)}.owner-lock{align-items:center;color:var(--shopops-muted);display:flex;font-size:12px;font-weight:700;gap:5px}.owner-lock .Polaris-Icon{height:18px;margin:0;width:18px}.identity{display:grid;min-width:0}.identity b,.identity small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.identity small{color:#6d7175;margin-top:3px}.actions{position:relative}.icon-button{background:transparent;border:0;border-radius:7px;cursor:pointer;font-size:18px;padding:6px 8px}.icon-button:hover{background:#e8e8e8}.menu{background:#fff;border:1px solid #d8d8d8;border-radius:9px;box-shadow:0 8px 22px #0002;display:grid;min-width:160px;padding:5px;position:absolute;right:0;top:36px;z-index:4}.menu button{background:transparent;border:0;border-radius:6px;cursor:pointer;padding:8px;text-align:left;width:100%}.menu button:hover{background:#f1f1f1}.roster-footer{align-items:center;border-top:1px solid #ededed;color:#6d7175;display:flex;gap:18px;padding:12px 16px}.roster-footer button{background:transparent;border:0;color:#255aa8;cursor:pointer;margin-left:auto}.roster-footer button+button{margin-left:0}.staff-overlay{align-items:stretch;background:#0006;display:flex;inset:0;justify-content:flex-end;position:fixed;z-index:50}.staff-panel{background:#fff;box-shadow:-8px 0 32px #0002;max-width:92vw;overflow:auto;width:460px}.staff-panel.wide{width:760px}.staff-panel>header{align-items:center;border-bottom:1px solid #e5e5e5;display:flex;justify-content:space-between;padding:18px 22px;position:sticky;top:0;background:#fff;z-index:2}.staff-panel h2{font-size:20px;margin:0}.panel-body{padding:22px}.form-stack{display:grid;gap:16px}.form-stack label{display:grid;font-size:13px;font-weight:650;gap:6px}.form-stack input,.form-stack select,.upload input{border:1px solid #b7b9bb;border-radius:8px;font:inherit;padding:10px}.form-stack fieldset{border:0;margin:0;padding:0}.form-stack legend{font-size:13px;font-weight:650;margin-bottom:8px}.form-stack .check,.check{align-items:center;display:flex;font-weight:400;gap:8px;margin:8px 0}.form-stack .check input,.check input{margin:0}.hint{color:#6d7175;font-size:13px}.detail-sections{display:grid}.detail-sections>section{align-items:flex-start;border-bottom:1px solid #e5e5e5;display:flex;justify-content:space-between;padding:18px 0}.detail-sections h3{font-size:14px;margin:0 0 5px}.detail-sections p{color:#454545;margin:0}.detail-sections small{color:#6d7175;display:block;margin-top:5px}.detail-sections details{padding:18px 0}.detail-sections summary{cursor:pointer;font-weight:650}.advanced{display:grid;gap:8px;margin-top:12px}.advanced code{background:#f6f6f7;border-radius:7px;font-size:11px;overflow-wrap:anywhere;padding:9px}.seller-row{border-bottom:1px solid #e5e5e5;padding:18px 0}.seller-row:first-child{padding-top:0}.seller-facts{display:grid;gap:12px;grid-template-columns:repeat(3,1fr)}.seller-facts span{display:grid;font-size:14px}.seller-facts b{color:#6d7175;font-size:11px;margin-bottom:4px;text-transform:uppercase}.row-actions{display:flex;gap:8px;margin-top:15px}.assign-box{background:#f7f7f7;border-radius:10px;margin-top:15px;padding:15px}.assign-box h3{margin:0 0 10px}.segmented{background:#ededed;border-radius:9px;display:flex;margin-bottom:14px;padding:3px}.segmented button{flex:1}.query{background:#202223;border-radius:10px;color:#fff;margin:16px 0;overflow:auto;padding:14px}.query pre{font-size:12px;white-space:pre-wrap}.query .staff-button{float:right}.upload{display:grid;font-weight:650;gap:8px}.preview{border-top:1px solid #e5e5e5;margin-top:20px;padding-top:20px}.preview-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.preview-counts span{background:#f6f6f7;border-radius:8px;display:grid;font-size:12px;padding:10px}.preview-counts b{font-size:18px}.preview-row{align-items:center;border-bottom:1px solid #e5e5e5;display:grid;gap:10px;grid-template-columns:1fr auto;padding:14px 0}.preview-row>div{display:grid}.preview-row span,.preview-row small{color:#6d7175;font-size:13px}.preview-row select{border:1px solid #b7b9bb;border-radius:7px;padding:7px}.preview-row.warning{background:#fff8e6;padding-left:10px}.preview-row.muted{opacity:.7}.confirm{background:#eef5ff;border-radius:10px;margin-top:16px;padding:14px}.bulk-forms{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.remove-access{border-top:1px solid #e5e5e5;margin-top:22px;padding-top:18px}.pos-summary{text-align:center;padding:20px 0}.saving{background:#303030;border-radius:20px;bottom:18px;color:white;padding:9px 15px;position:fixed;right:18px}.error{color:#b42318}
@media(max-width:800px){.staff-page{padding:16px}.toolbar{align-items:stretch;flex-direction:column}.search{min-width:0}.table-head{display:none}.staff-row{grid-template-columns:1fr auto;gap:8px;padding:12px}.staff-row>span:not(.identity):not(.actions){font-size:12px}.actions{grid-column:2;grid-row:1}.roster-footer{align-items:flex-start;flex-direction:column}.roster-footer button{margin-left:0}.seller-facts,.preview-counts{grid-template-columns:repeat(2,1fr)}.preview-row{grid-template-columns:1fr}.staff-panel,.staff-panel.wide{max-width:100vw;width:100%}}
`;
