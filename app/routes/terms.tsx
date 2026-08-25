import type { LinksFunction, MetaFunction } from "react-router";
import { Link } from "react-router";

import { PublicPageLayout } from "../components/public-page-layout";
import publicPageStylesHref from "../styles/public-pages.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: publicPageStylesHref },
];

export const meta: MetaFunction = () => [
  { title: "Terms of Service | ShopOps Studio" },
  {
    name: "description",
    content: "ShopOps Studio terms of service for Shopify merchants.",
  },
];

export default function TermsOfService() {
  return (
    <PublicPageLayout
      title="Terms of Service"
      description="These terms describe how merchants may use ShopOps Studio, a Shopify app for operational reporting."
    >
      <section>
        <h2>Using the app</h2>
        <p>
          Merchants may use ShopOps Studio to sync Shopify store data into
          reporting views, review location, product, staff, inventory, and
          financial metrics, configure fixed expenses, manage app-level access
          where supported, and monitor sync health and data quality.
        </p>
        <p>
          Merchants may not use the app to violate Shopify policies or
          applicable law, access another shop&apos;s data, interfere with the
          service, or share app access with unauthorized users.
        </p>
      </section>

      <section>
        <h2>Merchant responsibilities</h2>
        <p>
          Merchants are responsible for their Shopify account, app installation
          choices, staff access, source data accuracy, configured expenses,
          inventory costs, permissions, and compliance with laws that apply to
          their business.
        </p>
      </section>

      <section>
        <h2>Reporting disclaimer</h2>
        <p>
          ShopOps Studio provides informational operational reporting only. It
          is not financial, accounting, legal, tax, payroll, or professional
          advice. Merchants remain responsible for validating reports before
          relying on them for business decisions or regulated filings.
        </p>
      </section>

      <section>
        <h2>Subscription and billing</h2>
        <p>
          ShopOps Studio subscriptions, trials, billing, cancellation, and
          related payment handling are managed through Shopify. Merchants should
          review the Shopify App Store listing and Shopify billing screens for
          current plan and pricing details.
        </p>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>
          The app may be unavailable during maintenance, Shopify platform
          incidents, infrastructure issues, or other operational events. ShopOps
          Studio may add, remove, or modify features over time.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the maximum extent allowed by law, ShopOps Studio is not liable for
          indirect, incidental, special, consequential, punitive, or lost-profit
          damages arising from use of the app. The app is provided for
          operational reporting, and merchants are responsible for confirming
          data before acting on it.
        </p>
      </section>

      <section>
        <h2>Privacy and support</h2>
        <p>
          Data handling is described in the{" "}
          <Link to="/privacy">Privacy Policy</Link>. For help, contact{" "}
          <a href="mailto:support@shopopsstudio.com">
            support@shopopsstudio.com
          </a>{" "}
          or visit <Link to="/support">ShopOps Studio support</Link>. Support
          requests receive a response within 2 business days. Security or
          privacy requests are prioritized.
        </p>
      </section>
    </PublicPageLayout>
  );
}
