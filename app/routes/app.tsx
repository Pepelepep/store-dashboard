import type { LoaderFunctionArgs } from "react-router";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getPermissionContext } from "../lib/auth/permissions.server";

import { authenticate } from "../shopify.server";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

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
  const location = useLocation();
  const search = location.search;

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-nav-menu>
        <a href={`/app/db-dashboard${search}`} rel="home">
          Dashboard
        </a>
        {canAdmin ? <a href={`/app/locations${search}`}>Locations</a> : null}
        {canAdmin ? <a href={`/app/data-quality${search}`}>Data Quality</a> : null}
        {canAdmin ? <a href={`/app/admin/expenses${search}`}>Expenses</a> : null}
        {canAdmin ? <a href={`/app/admin/permissions${search}`}>Permissions</a> : null}
        {canAdmin ? <a href={`/app/admin/sync${search}`}>Data Sync</a> : null}
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
