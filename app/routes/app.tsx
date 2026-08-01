import type {
  HeadersFunction,
  LoaderFunctionArgs,
  MiddlewareFunction,
} from "react-router";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import {
  Outlet,
  redirect,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { getPermissionContext } from "../lib/auth/permissions.server";
import { requireBillingAccess } from "../lib/billing.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { getDataSyncPath } from "../lib/navigation/sync-status";

import { authenticate } from "../shopify.server";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "ui-nav-menu": DetailedHTMLProps<
        HTMLAttributes<HTMLElement>,
        HTMLElement
      >;
    }
  }
}

function isBillingRoutePath(pathname: string) {
  return (
    pathname === "/app/billing-required" || pathname === "/app/billing/complete"
  );
}

export const middleware: MiddlewareFunction[] = [
  async ({ request }, next) => {
    const url = new URL(request.url);
    if (isBillingRoutePath(url.pathname)) {
      return next();
    }

    const { admin, session } = await authenticate.admin(request);
    const access = await requireBillingAccess({
      admin,
      shop: session.shop,
    });
    if (access.access !== "allowed") {
      url.pathname = "/app/billing-required";
      url.searchParams.set(
        "billing_state",
        access.access === "billing_unavailable" ? "unavailable" : "required",
      );
      throw redirect(`${url.pathname}${url.search}`);
    }

    return next();
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  if (isBillingRoutePath(url.pathname)) {
    return {
      apiKey: process.env.SHOPIFY_API_KEY ?? "",
      canAdmin: false,
      accessState: "allowed" as const,
      accessIdentity: {
        shop: session.shop,
        shopifyUserId: null,
        email: null,
      },
    };
  }

  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app",
    shop: session.shop,
    supabase,
  });
  const permissions = await getPermissionContext({
    request,
    session,
    supabase,
  });
  const accessState = !permissions.hasOwner
    ? ("owner_setup_required" as const)
    : !permissions.isActiveMember
      ? ("no_access" as const)
      : ("allowed" as const);

  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    canAdmin: permissions.isAdmin,
    accessState,
    accessIdentity: {
      shop: permissions.identity.shop,
      shopifyUserId: permissions.identity.shopifyUserId,
      email: permissions.identity.email,
    },
  };
}

export default function App() {
  const { apiKey, canAdmin, accessState, accessIdentity } =
    useLoaderData<typeof loader>();
  const location = useLocation();
  const search = location.search;
  const setupSearchParams = new URLSearchParams(search);
  setupSearchParams.delete("tab");
  const setupQuery = setupSearchParams.toString();
  const setupPath = `/app/admin/setup${setupQuery ? `?${setupQuery}` : ""}`;
  const isBillingRoute = isBillingRoutePath(location.pathname);

  return (
    <AppProvider embedded apiKey={apiKey}>
      {isBillingRoute ? (
        <Outlet />
      ) : accessState !== "allowed" ? (
        <main
          style={{
            minHeight: "100vh",
            background: "#f6f6f7",
            padding: 28,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          }}
        >
          <section
            style={{
              maxWidth: 720,
              margin: "0 auto",
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 28 }}>Access required</h1>
            <p style={{ color: "#616161", margin: "8px 0 20px" }}>
              {accessState === "owner_setup_required"
                ? "ShopOps Studio setup must be completed by the Shopify store owner."
                : "You don't have access to ShopOps Studio. Contact the store owner."}
            </p>

            <dl style={{ display: "grid", gap: 12, margin: 0 }}>
              <div>
                <dt style={{ color: "#616161", fontWeight: 800 }}>Shop</dt>
                <dd style={{ margin: 0 }}>{accessIdentity.shop}</dd>
              </div>
              {accessIdentity.shopifyUserId ? (
                <div>
                  <dt style={{ color: "#616161", fontWeight: 800 }}>
                    Shopify user ID
                  </dt>
                  <dd style={{ margin: 0 }}>{accessIdentity.shopifyUserId}</dd>
                </div>
              ) : null}
              {accessIdentity.email ? (
                <div>
                  <dt style={{ color: "#616161", fontWeight: 800 }}>Email</dt>
                  <dd style={{ margin: 0 }}>{accessIdentity.email}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        </main>
      ) : (
        <>
          <ui-nav-menu>
            <a href={`/app/db-dashboard${search}`} rel="home">
              Profit Dashboard
            </a>
            <a href={`/app/locations${search}`}>Location Performance</a>
            {canAdmin ? <a href={setupPath}>Setup</a> : null}
            {canAdmin ? <a href={`/app/admin/staff${search}`}>Staff</a> : null}
            {canAdmin ? <a href={getDataSyncPath(search)}>Data sync</a> : null}
          </ui-nav-menu>

          <Outlet />
        </>
      )}
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
