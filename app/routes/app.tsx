import type { LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getPermissionContext } from "../lib/auth/permissions.server";

import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  const permissions = await getPermissionContext({ request, session, supabase });

  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    canAdmin: permissions.isAdmin,
  };
}

export default function App() {
  const { apiKey, canAdmin } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-nav-menu>
        <Link to="/app/db-dashboard" rel="home">
          Dashboard
        </Link>

        {canAdmin ? (
          <Link to="/app/admin/sync">
            Data sync
          </Link>
        ) : null}

        {canAdmin ? (
          <Link to="/app/admin/permissions">
            Permissions
          </Link>
        ) : null}
      </ui-nav-menu>

      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs: any) => {
  return boundary.headers(headersArgs);
};