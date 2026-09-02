import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import {
  buildHostedPricingUrl,
  getBillingState,
  refreshBillingState,
} from "../lib/billing.server";
import {
  getCurrentUserIdentity,
  getPermissionContext,
  OwnerBootstrapError,
} from "../lib/auth/permissions.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { ensureShopInitialized } from "../lib/shop/shop-initialization.server";
import { getShopLevelAdminClient } from "../lib/shopify/shop-level-admin.server";
import { authenticate } from "../shopify.server";

function buildEmbeddedPath(
  pathname: string,
  currentUrl: URL,
  updates: Record<string, string> = {},
) {
  const searchParams = new URLSearchParams(currentUrl.search);
  searchParams.delete("billing_state");
  for (const [key, value] of Object.entries(updates)) {
    searchParams.set(key, value);
  }
  const search = searchParams.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  const url = new URL(request.url);

  await ensureShopInitialized({
    route: "billing-required",
    shop: session.shop,
    supabase,
  });

  const identity = getCurrentUserIdentity({ session });
  if (!identity.isShopifyAccountOwner) {
    return {
      view: "owner_setup" as const,
      supportUrl: "/support",
    };
  }

  try {
    const permissions = await getPermissionContext({
      request,
      session,
      supabase,
      route: "billing-required",
    });
    if (!permissions.capabilities.manage_billing) {
      console.error("[owner-bootstrap] controlled failure", {
        route: "billing-required",
        shop: session.shop,
        reason: "membership_unresolved",
      });
      return {
        view: "unavailable" as const,
        description:
          "ShopOps could not finish setting up owner access. Nothing was changed. Please retry in a moment.",
        retryUrl: buildEmbeddedPath("/app/billing-required", url, {
          retry: "1",
        }),
        supportUrl: "/support",
      };
    }
  } catch (error) {
    if (!(error instanceof OwnerBootstrapError)) throw error;
    return {
      view: "unavailable" as const,
      description:
        "ShopOps could not finish setting up owner access. Nothing was changed. Please retry in a moment.",
      retryUrl: buildEmbeddedPath("/app/billing-required", url, {
        retry: "1",
      }),
      supportUrl: "/support",
    };
  }

  const billingAdmin = await getShopLevelAdminClient({
    shop: session.shop,
    route: "billing-required",
  });
  const billing =
    url.searchParams.get("retry") === "1"
      ? await refreshBillingState({ admin: billingAdmin, shop: session.shop })
      : await getBillingState({ admin: billingAdmin, shop: session.shop });

  if (
    billing.state === "disabled" ||
    billing.state === "active" ||
    billing.state === "trial" ||
    billing.state === "canceling"
  ) {
    throw redirect(buildEmbeddedPath("/app/db-dashboard", url));
  }

  if (billing.state === "billing_unavailable") {
    return {
      view: "unavailable" as const,
      description:
        "Shopify could not confirm this store's plan right now. Your subscription has not been changed. Please retry in a moment.",
      retryUrl: buildEmbeddedPath("/app/billing-required", url, {
        retry: "1",
      }),
      supportUrl: "/support",
    };
  }

  return {
    view: "required" as const,
    reason: billing.state,
    pricingUrl: buildHostedPricingUrl({ shop: session.shop }),
    supportUrl: "/support",
  };
}

const pageStyle = {
  background: "#f6f6f7",
  minHeight: "100vh",
  padding: "32px 20px",
};

const cardStyle = {
  background: "white",
  border: "1px solid #dfe3e8",
  borderRadius: 12,
  margin: "0 auto",
  maxWidth: 680,
  padding: 28,
};

const primaryLinkStyle = {
  background: "#2563eb",
  borderRadius: 10,
  color: "white",
  display: "inline-flex",
  fontWeight: 700,
  padding: "11px 16px",
  textDecoration: "none",
};

export default function BillingRequired() {
  const data = useLoaderData<typeof loader>();

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        {data.view === "unavailable" ? (
          <>
            <h1 style={{ margin: "0 0 12px", fontSize: 28 }}>
              Billing temporarily unavailable
            </h1>
            <p
              style={{ color: "#45484d", lineHeight: 1.6, margin: "0 0 22px" }}
            >
              {data.description}
            </p>
            <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
              <a href={data.retryUrl} style={primaryLinkStyle}>
                Retry
              </a>
              <a href={data.supportUrl}>Contact support</a>
            </div>
          </>
        ) : data.view === "owner_setup" ? (
          <>
            <h1 style={{ margin: "0 0 12px", fontSize: 28 }}>
              Store owner action required
            </h1>
            <p
              style={{ color: "#45484d", lineHeight: 1.6, margin: "0 0 22px" }}
            >
              Only the Shopify store owner can complete plan selection in
              ShopOps Studio. Shopify may separately allow staff with billing
              and app permissions to manage app charges in Shopify admin. Ask
              the store owner to open ShopOps Studio and confirm the plan.
            </p>
            <a href={data.supportUrl}>Contact support</a>
          </>
        ) : (
          <>
            <h1 style={{ margin: "0 0 12px", fontSize: 28 }}>
              Choose a plan to continue
            </h1>
            <p
              style={{ color: "#45484d", lineHeight: 1.6, margin: "0 0 22px" }}
            >
              {data.reason === "unsupported_plan"
                ? "Shopify returned a plan ShopOps does not recognize. Choose a supported plan or contact support."
                : "An active ShopOps Studio plan is required. Shopify hosts plan selection and charge approval securely in Shopify admin."}
            </p>
            <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
              <a href={data.pricingUrl} style={primaryLinkStyle} target="_top">
                Choose a plan
              </a>
              <a href={data.supportUrl}>Contact support</a>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
