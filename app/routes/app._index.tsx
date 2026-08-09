import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { getPermissionContext } from "../lib/auth/permissions.server";
import { getShopOpsDefaultPath } from "../lib/auth/role-capabilities";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { session } = await authenticate.admin(request);
  const permissions = await getPermissionContext({
    request,
    route: "app.index",
    session,
    supabase: getSupabaseAdminClient(),
  });
  // Parent and child loaders run in parallel. Let the parent app route render
  // the helpful access/setup notice instead of replacing it with a raw 403.
  if (!permissions.hasOwner || !permissions.isActiveMember || !permissions.role) {
    return null;
  }
  return redirect(`${getShopOpsDefaultPath(permissions.role!)}${url.search}`);
}

export default function AppIndex() {
  return null;
}
