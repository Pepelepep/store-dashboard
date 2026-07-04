import type { SupabaseClient } from "@supabase/supabase-js";

type ShopifySessionLike = {
  shop: string;
  onlineAccessInfo?: {
    associated_user?: {
      id?: number | string | null;
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    } | null;
  } | null;
};

export type CurrentUserIdentity = {
  shop: string;
  email: string | null;
  shopifyUserId: string | null;
  displayName: string;
};

export type PermissionContext = {
  identity: CurrentUserIdentity;
  isAdmin: boolean;
  role: string | null;
  accessSource: "env_user_id" | "env_email" | "db_rule" | "fresh_install" | "none";
  allowedLocationIds: Set<string>;
};

type PermissionRow = {
  user_email: string | null;
  shopify_user_id: string | null;
  shopify_location_id: string | null;
  role: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
};

function parseCsvEnv(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

function decodeJwtPayload(token: string | null) {
  if (!token) return null;

  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );

    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      sub?: string | number;
    };
  } catch {
    return null;
  }
}

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() || null;
}

function normalizeShopifyUserId(userId: string | null | undefined) {
  return userId?.trim() || null;
}

export function getCurrentUserIdentity({
  request,
  session,
}: {
  request: Request;
  session: ShopifySessionLike;
}): CurrentUserIdentity {
  const url = new URL(request.url);
  const idTokenPayload = decodeJwtPayload(url.searchParams.get("id_token"));
  const associatedUser = session.onlineAccessInfo?.associated_user;

  const email = normalizeEmail(associatedUser?.email);
  const shopifyUserId = normalizeShopifyUserId(
    associatedUser?.id !== undefined && associatedUser?.id !== null
      ? String(associatedUser.id)
      : idTokenPayload?.sub !== undefined && idTokenPayload?.sub !== null
        ? String(idTokenPayload.sub)
        : null,
  );

  const nameParts = [associatedUser?.first_name, associatedUser?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean);

  return {
    shop: session.shop,
    email,
    shopifyUserId,
    displayName:
      nameParts.join(" ") || email || shopifyUserId || "Unknown user",
  };
}

export async function getPermissionContext({
  request,
  session,
  supabase,
}: {
  request: Request;
  session: ShopifySessionLike;
  supabase: SupabaseClient;
}): Promise<PermissionContext> {
  const identity = getCurrentUserIdentity({ request, session });
  const adminEmails = parseCsvEnv(process.env.ADMIN_EMAILS);
  const adminShopifyUserIds = parseCsvEnv(process.env.ADMIN_SHOPIFY_USER_IDS);

  let rows: PermissionRow[] = [];
  let shopPermissionRuleCount = 0;

  if (identity.email || identity.shopifyUserId) {
    const { count, error: countError } = await supabase
      .from("user_location_access")
      .select("*", { count: "exact", head: true })
      .eq("shop_domain", session.shop);

    if (countError) throw new Response(countError.message, { status: 500 });
    shopPermissionRuleCount = count ?? 0;

    const { data, error } = await supabase
      .from("user_location_access")
      .select(
        "user_email, shopify_user_id, shopify_location_id, role, can_view, can_manage",
      )
      .eq("shop_domain", session.shop);
    if (error) throw new Response(error.message, { status: 500 });
    rows = ((data ?? []) as PermissionRow[]).filter((row) => {
      const rowEmail = normalizeEmail(row.user_email);
      const rowShopifyUserId = normalizeShopifyUserId(row.shopify_user_id);

      return (
        (identity.email && rowEmail === identity.email) ||
        (identity.shopifyUserId && rowShopifyUserId === identity.shopifyUserId)
      );
    });
  }

  const isEnvUserIdAdmin = identity.shopifyUserId
    ? adminShopifyUserIds.has(identity.shopifyUserId.toLowerCase())
    : false;
  const isEnvEmailAdmin = identity.email ? adminEmails.has(identity.email) : false;
  const isBootstrapAdmin = isEnvUserIdAdmin || isEnvEmailAdmin;
  const isFreshInstallSetupAdmin =
    shopPermissionRuleCount === 0 &&
    Boolean(identity.email || identity.shopifyUserId);
  if (isFreshInstallSetupAdmin) {
    console.info("[fresh-install:permissions] setup admin enabled", {
      route: "permissions",
      shop: session.shop,
      emptyPermissionRules: true,
    });
  }

  const isDbAdmin = rows.some((row) => row.role === "admin");
  const hasDbRule = rows.length > 0;
  const isAdmin = isBootstrapAdmin || isDbAdmin || isFreshInstallSetupAdmin;
  const accessSource: PermissionContext["accessSource"] = isEnvUserIdAdmin
    ? "env_user_id"
    : isEnvEmailAdmin
      ? "env_email"
      : isDbAdmin
        ? "db_rule"
        : isFreshInstallSetupAdmin
          ? "fresh_install"
          : hasDbRule
            ? "db_rule"
            : "none";

  console.info("[permissions] access evaluated", {
    shop: session.shop,
    shopify_user_id_present: Boolean(identity.shopifyUserId),
    email_present: Boolean(identity.email),
    admin_source: accessSource,
  });

  const allowedLocationIds = new Set<string>();
  for (const row of rows) {
    if (!row.shopify_location_id || row.shopify_location_id === "*") continue;
    if (
      row.can_view ||
      row.can_manage ||
      row.role === "manager" ||
      row.role === "viewer"
    ) {
      allowedLocationIds.add(row.shopify_location_id);
    }
  }

  const role = isAdmin
    ? "admin"
    : rows.some((row) => row.role === "manager")
      ? "manager"
      : rows.some((row) => row.role === "viewer")
        ? "viewer"
        : null;

  return {
    identity,
    isAdmin,
    role,
    accessSource,
    allowedLocationIds,
  };
}

export async function assertAdminAccess(args: {
  request: Request;
  session: ShopifySessionLike;
  supabase: SupabaseClient;
}) {
  const permissions = await getPermissionContext(args);

  if (!permissions.identity.email && !permissions.identity.shopifyUserId) {
    throw new Response(
      "Forbidden: ShopOps Studio could not detect your Shopify session identity. Reopen the app from Shopify admin and ask an app admin to confirm your access.",
      { status: 403 },
    );
  }

  if (!permissions.isAdmin) {
    throw new Response("Forbidden: admin access required", { status: 403 });
  }

  return permissions;
}
