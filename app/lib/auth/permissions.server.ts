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

  const email = associatedUser?.email?.trim().toLowerCase() || null;
  const shopifyUserId =
    associatedUser?.id !== undefined && associatedUser?.id !== null
      ? String(associatedUser.id)
      : idTokenPayload?.sub !== undefined && idTokenPayload?.sub !== null
        ? String(idTokenPayload.sub)
        : null;

  const nameParts = [associatedUser?.first_name, associatedUser?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean);

  return {
    shop: session.shop,
    email,
    shopifyUserId,
    displayName: nameParts.join(" ") || email || shopifyUserId || "Unknown user",
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

  if (identity.email || identity.shopifyUserId) {
    let query = supabase
      .from("user_location_access")
      .select("user_email, shopify_user_id, shopify_location_id, role, can_view, can_manage")
      .eq("shop_domain", session.shop);

    if (identity.email) {
      query = query.eq("user_email", identity.email);
    } else if (identity.shopifyUserId) {
      query = query.eq("shopify_user_id", identity.shopifyUserId);
    }

    const { data, error } = await query;
    if (error) throw new Response(error.message, { status: 500 });
    rows = (data ?? []) as PermissionRow[];
  }

  const isBootstrapAdmin =
    (identity.email ? adminEmails.has(identity.email) : false) ||
    (identity.shopifyUserId
      ? adminShopifyUserIds.has(identity.shopifyUserId.toLowerCase())
      : false);

  const isDbAdmin = rows.some((row) => row.role === "admin");
  const isAdmin = isBootstrapAdmin || isDbAdmin;

  const allowedLocationIds = new Set<string>();
  for (const row of rows) {
    if (!row.shopify_location_id || row.shopify_location_id === "*") continue;
    if (row.can_view || row.can_manage || row.role === "manager" || row.role === "viewer") {
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
    allowedLocationIds,
  };
}

export async function assertAdminAccess(args: {
  request: Request;
  session: ShopifySessionLike;
  supabase: SupabaseClient;
}) {
  const permissions = await getPermissionContext(args);

  if (!permissions.isAdmin) {
    throw new Response("Forbidden: admin access required", { status: 403 });
  }

  return permissions;
}
