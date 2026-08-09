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
import {
  getPermissionContext,
  OwnerBootstrapError,
  type PermissionContext,
} from "../lib/auth/permissions.server";
import { requireBillingAccess } from "../lib/billing.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { getShopLevelAdminClient } from "../lib/shopify/shop-level-admin.server";
import {
  getShopOpsDefaultPath,
  getShopOpsNavigation,
} from "../lib/auth/role-capabilities";

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

function getNavigationHref({
  href,
  navigationSearchParams,
  tab,
}: {
  href: string;
  navigationSearchParams: URLSearchParams;
  tab?: "plan" | "sync";
}) {
  const searchParams = new URLSearchParams(navigationSearchParams);
  if (tab) searchParams.set("tab", tab);
  const search = searchParams.toString();
  return `${href}${search ? `?${search}` : ""}`;
}

export const middleware: MiddlewareFunction[] = [
  async ({ request }, next) => {
    const url = new URL(request.url);
    if (isBillingRoutePath(url.pathname)) {
      return next();
    }

    const { session } = await authenticate.admin(request);
    const requestUrl = new URL(request.url);
    const authorization = request.headers.get("authorization");
    const sessionToken =
      requestUrl.searchParams.get("id_token") ??
      (authorization?.match(/^Bearer\s+(.+)$/i)?.[1] || undefined);
    const supabase = getSupabaseAdminClient();
    let permissions: PermissionContext;
    try {
      permissions = await getPermissionContext({
        request,
        session,
        supabase,
        route: "app.billing-middleware",
      });
    } catch (error) {
      if (!(error instanceof OwnerBootstrapError)) throw error;
      url.pathname = "/app/billing-required";
      url.searchParams.set("billing_state", "unavailable");
      throw redirect(`${url.pathname}${url.search}`);
    }

    if (!permissions.isActiveMember) {
      return next();
    }

    const billingAdmin = await getShopLevelAdminClient({
      shop: session.shop,
      route: "app.billing-middleware",
      sessionToken,
    });
    const access = await requireBillingAccess({
      admin: billingAdmin,
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
      defaultPath: "/app/db-dashboard",
      navigationItems: [],
      accessState: "allowed" as const,
      accessIdentity: {
        shop: session.shop,
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
    route: "app.loader",
  });
  const accessState = !permissions.hasOwner
    ? ("owner_setup_required" as const)
    : !permissions.isActiveMember
      ? ("no_access" as const)
      : ("allowed" as const);

  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    defaultPath: permissions.role
      ? getShopOpsDefaultPath(permissions.role)
      : "/app/db-dashboard",
    navigationItems: getShopOpsNavigation(permissions.role),
    accessState,
    accessIdentity: {
      shop: permissions.identity.shop,
      email: permissions.identity.email,
    },
  };
}

export default function App() {
  const { apiKey, defaultPath, navigationItems, accessState, accessIdentity } =
    useLoaderData<typeof loader>();
  const location = useLocation();
  const navigationSearchParams = new URLSearchParams(location.search);
  navigationSearchParams.delete("tab");
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
            <h1 style={{ margin: 0, fontSize: 28 }}>ShopOps access required</h1>
            <p style={{ color: "#616161", margin: "8px 0 20px" }}>
              {accessState === "owner_setup_required"
                ? "ShopOps Studio setup must be completed by the Shopify store owner."
                : "Contact the store owner to request ShopOps access for your email address."}
            </p>

            <dl style={{ display: "grid", gap: 12, margin: 0 }}>
              <div>
                <dt style={{ color: "#616161", fontWeight: 800 }}>Shop</dt>
                <dd style={{ margin: 0 }}>{accessIdentity.shop}</dd>
              </div>
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
            {navigationItems.map((item) => (
              <a
                href={getNavigationHref({
                  href: item.href,
                  navigationSearchParams,
                  tab: "tab" in item ? item.tab : undefined,
                })}
                key={`${item.href}:${"tab" in item ? item.tab : ""}`}
                rel={item.href === defaultPath ? "home" : undefined}
              >
                {item.label}
              </a>
            ))}
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
