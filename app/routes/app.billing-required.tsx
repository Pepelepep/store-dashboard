import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import {
  getBillingGateState,
  SHOP_OPS_STUDIO_PLAN,
} from "../lib/billing.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const billing = await getBillingGateState({ admin, shop: session.shop });
  const url = new URL(request.url);

  if (!billing.billingEnabled || !billing.requiresBilling) {
    throw redirect(`/app/db-dashboard${url.search}`);
  }

  return {
    plan: SHOP_OPS_STUDIO_PLAN,
  };
}

export default function BillingRequired() {
  const { plan } = useLoaderData<typeof loader>();

  return (
    <main
      style={{
        background: "#f6f6f7",
        minHeight: "100vh",
        padding: "32px 20px",
      }}
    >
      <section
        style={{
          margin: "0 auto",
          maxWidth: 840,
        }}
      >
        <div
          style={{
            background: "white",
            border: "1px solid #dfe3e8",
            borderRadius: 8,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            padding: 28,
          }}
        >
          <p
            style={{
              color: "#5c5f62",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0,
              margin: "0 0 8px",
              textTransform: "uppercase",
            }}
          >
            Shopify managed billing
          </p>
          <h1
            style={{
              color: "#202223",
              fontSize: 28,
              lineHeight: 1.2,
              margin: "0 0 12px",
            }}
          >
            Choose a plan to continue
          </h1>
          <p
            style={{
              color: "#45484d",
              fontSize: 16,
              lineHeight: 1.6,
              margin: "0 0 24px",
              maxWidth: 660,
            }}
          >
            ShopOps Studio uses Shopify App Store pricing. Select the{" "}
            <strong>{plan.name}</strong> plan in Shopify to unlock reporting for
            this store.
          </p>

          <div
            style={{
              border: "1px solid #dfe3e8",
              borderRadius: 8,
              marginBottom: 24,
              padding: 20,
            }}
          >
            <div
              style={{
                alignItems: "baseline",
                display: "flex",
                flexWrap: "wrap",
                gap: "8px 14px",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <h2
                style={{
                  color: "#202223",
                  fontSize: 20,
                  lineHeight: 1.25,
                  margin: 0,
                }}
              >
                {plan.name}
              </h2>
              <strong
                style={{
                  color: "#1f6f43",
                  fontSize: 18,
                }}
              >
                {plan.price}
              </strong>
            </div>
            <p
              style={{
                color: "#5c5f62",
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              Includes a {plan.trialDays}-day free trial. Billing is processed
              by Shopify.
            </p>
          </div>

          <ol
            style={{
              color: "#45484d",
              display: "grid",
              gap: 12,
              lineHeight: 1.5,
              margin: 0,
              paddingLeft: 22,
            }}
          >
            <li>Connect your store</li>
            <li>Sync your data</li>
            <li>Trust your reporting</li>
          </ol>
        </div>
      </section>
    </main>
  );
}
