import type { LoaderFunctionArgs } from "react-router";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
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

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-nav-menu>
        <a href="/app/db-dashboard" rel="home">
          Dashboard
        </a>
        {canAdmin ? <a href="/app/admin/sync">Data sync</a> : null}
        {canAdmin ? <a href="/app/admin/permissions">Permissions</a> : null}
        {canAdmin ? <a href="/app/admin/expenses">Expenses</a> : null}
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
