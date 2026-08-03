import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { assertDashboardAccess } from "../lib/auth/permissions.server";
import { getShopOpsDefaultPath } from "../lib/auth/role-capabilities";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const { session } = await authenticate.admin(request);
  const permissions = await assertDashboardAccess({
    request,
    route: "app.index",
    session,
    supabase: getSupabaseAdminClient(),
  });
  return redirect(`${getShopOpsDefaultPath(permissions.role!)}${url.search}`);
}

export default function AppIndex() {
  return null;
}
