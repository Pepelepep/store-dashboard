import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import {
  buildHostedPricingUrl,
  getBillingState,
  refreshBillingState,
} from "../lib/billing.server";
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
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const billing =
    url.searchParams.get("retry") === "1"
      ? await refreshBillingState({ admin, shop: session.shop })
      : await getBillingState({ admin, shop: session.shop });

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
      retryUrl: buildEmbeddedPath("/app/billing-required", url, {
        retry: "1",
      }),
      supportUrl: "/support",
    };
  }

  return {
    view: "required" as const,
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
              Shopify could not confirm this store&apos;s plan right now. Your
              subscription has not been changed. Please retry in a moment.
            </p>
            <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
              <a href={data.retryUrl} style={primaryLinkStyle}>
                Retry
              </a>
              <a href={data.supportUrl}>Contact support</a>
            </div>
          </>
        ) : (
          <>
            <h1 style={{ margin: "0 0 12px", fontSize: 28 }}>
              Choose a plan to continue
            </h1>
            <p
              style={{ color: "#45484d", lineHeight: 1.6, margin: "0 0 22px" }}
            >
              An active ShopOps Studio plan is required. Shopify hosts plan
              selection and charge approval securely in Shopify admin.
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
