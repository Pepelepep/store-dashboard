import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
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
import { getBillingGateState } from "../lib/billing.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";

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

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app",
    shop: session.shop,
    supabase,
  });
  const billing = await getBillingGateState({ admin, shop: session.shop });

  if (billing.requiresBilling && url.pathname !== "/app/billing-required") {
    throw redirect(`/app/billing-required${url.search}`);
  }

  const permissions = await getPermissionContext({ request, session, supabase });
  const accessRequired =
    !permissions.isAdmin && permissions.allowedLocationIds.size === 0;

  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    billingEnabled: billing.billingEnabled,
    canAdmin: permissions.isAdmin,
    accessRequired,
    accessIdentity: {
      shop: permissions.identity.shop,
      shopifyUserId: permissions.identity.shopifyUserId,
      email: permissions.identity.email,
    },
  };
}

export default function App() {
  const {
    apiKey,
    billingEnabled,
    canAdmin,
    accessRequired,
    accessIdentity,
  } = useLoaderData<typeof loader>();
  const location = useLocation();
  const search = location.search;

  return (
    <AppProvider embedded apiKey={apiKey}>
      {accessRequired ? (
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
              Ask your admin to add your email or link this Shopify user ID to your existing Team Access.
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

            <p style={{ color: "#616161", margin: "20px 0 0" }}>
              If no email is shown, send the Shopify user ID to your admin.
              They can add an access label like{" "}
              <span>Maya - POS Laval</span>.
            </p>
          </section>
        </main>
      ) : (
        <>
          <ui-nav-menu>
            <a href={`/app/db-dashboard${search}`} rel="home">
              Profit Dashboard
            </a>
            {canAdmin ? (
              <a href={`/app/locations${search}`}>Location Performance</a>
            ) : null}
            {canAdmin ? (
              <a href={`/app/admin/expenses${search}`}>Expense Setup</a>
            ) : null}
            {canAdmin ? (
              <a href={`/app/admin/staff${search}`}>Staff &amp; access</a>
            ) : null}
            {canAdmin ? (
              <a href={`/app/admin/staff${search}`}>Staff</a>
            ) : null}
            {canAdmin ? (
              <a href={`/app/data-quality${search}`}>Sync Status</a>
            ) : null}
            {billingEnabled ? (
              <a href={`/app/billing-required${search}`}>Billing</a>
            ) : null}
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
