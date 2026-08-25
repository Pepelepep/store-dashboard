import type { LinksFunction, MetaFunction } from "react-router";
import { Link } from "react-router";

import { PublicPageLayout } from "../components/public-page-layout";
import publicPageStylesHref from "../styles/public-pages.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: publicPageStylesHref },
];

export const meta: MetaFunction = () => [
  { title: "Privacy Policy | ShopOps Studio" },
  {
    name: "description",
    content:
      "ShopOps Studio privacy policy for Shopify App Store review and merchants.",
  },
];

export default function PrivacyPolicy() {
  return (
    <PublicPageLayout
      title="Privacy Policy"
      description="ShopOps Studio helps Shopify merchants understand store operations, inventory, margins, and reporting health. This page summarizes the data we process to provide the app."
    >
      <section>
        <h2>Data we process</h2>
        <p>
          ShopOps Studio processes shop-scoped Shopify data needed to power
          merchant reporting, including shop and session records, locations,
          products, variants, vendors, SKUs, inventory levels, inventory item
          costs, orders, order lines, refunds, returns, transactions, sync
          status, webhook status, and app-configured reporting data such as
          fixed expenses.
        </p>
        <p>
          Order, product, inventory, and reporting data is used to calculate
          operational metrics such as sales, discounts, refunds, returns, cost
          of goods sold, gross profit, gross margin, expenses, net profit, stock
          alerts, best sellers, vendor reporting, location reporting, and data
          quality status.
        </p>
      </section>

      <section>
        <h2>Staff and user data</h2>
        <p>
          If Shopify approves user access for the app, ShopOps Studio may
          process Shopify staff or user IDs, names, email addresses where
          available, active status, and related metadata. This data is used for
          staff attribution, admin controls, and location-based permissions. It
          is not used for marketing.
        </p>
      </section>

      <section>
        <h2>Why we process data</h2>
        <p>
          We process merchant shop data to provide reporting inside Shopify,
          keep reports current through syncs and webhooks, diagnose sync issues,
          support data quality checks, manage app permissions, and respond to
          Shopify privacy webhook requests.
        </p>
      </section>

      <section>
        <h2>Data isolation and sharing</h2>
        <p>
          ShopOps Studio keeps business analytics data scoped to the Shopify
          shop that installed the app. One merchant should not be able to access
          another merchant&apos;s shop data through the app.
        </p>
        <p>
          We do not sell merchant or customer data. We do not use customer data
          for marketing. Data is shared only as needed to operate, secure,
          maintain, and support the app and to comply with Shopify platform
          requirements or applicable law.
        </p>
      </section>

      <section>
        <h2>Data retention</h2>
        <p>
          Shop-scoped business analytics data may be retained for up to 30 days
          after uninstall to support accidental reinstall recovery and
          short-term support, unless deletion or redaction is required earlier.
        </p>
        <p>
          ShopOps Studio supports Shopify&apos;s mandatory privacy webhooks:
          <code> customers/data_request</code>, <code> customers/redact</code>,
          and <code> shop/redact</code>.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For privacy, security, or support questions, contact{" "}
          <a href="mailto:support@shopopsstudio.com">
            support@shopopsstudio.com
          </a>
          . Security or privacy requests are prioritized. You can also review
          the <Link to="/support">support page</Link>.
        </p>
      </section>
    </PublicPageLayout>
  );
}
