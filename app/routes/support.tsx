import type { LinksFunction, MetaFunction } from "react-router";
import { Link } from "react-router";

import { PublicPageLayout } from "../components/public-page-layout";
import publicPageStylesHref from "../styles/public-pages.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: publicPageStylesHref },
];

export const meta: MetaFunction = () => [
  { title: "Support | ShopOps Studio" },
  {
    name: "description",
    content:
      "ShopOps Studio support contact information for Shopify merchants.",
  },
];

export default function Support() {
  return (
    <PublicPageLayout
      title="Support"
      description="Need help with ShopOps Studio? Use the contact details and request checklist below so we can investigate quickly."
    >
      <section>
        <h2>Contact</h2>
        <p>
          Support email:{" "}
          <a href="mailto:support@shopopsstudio.com">
            support@shopopsstudio.com
          </a>
        </p>
        <p>
          Expected response time: <strong>within 2 business days</strong>
        </p>
        <p>
          Privacy and security contact:{" "}
          <a href="mailto:support@shopopsstudio.com">
            support@shopopsstudio.com
          </a>
          . Security or privacy requests are prioritized.
        </p>
      </section>

      <section>
        <h2>What to include</h2>
        <ul>
          <li>Shopify shop domain.</li>
          <li>Contact name and role.</li>
          <li>Page or workflow affected.</li>
          <li>Date, time, and timezone when the issue occurred.</li>
          <li>Screenshots or screen recording if available.</li>
          <li>Whether the issue affects all staff or one staff user.</li>
          <li>
            Recent Shopify changes, such as new locations, products, refunds,
            returns, staff, or permissions.
          </li>
          <li>
            For reporting issues, the expected value, observed value, and sample
            order, product, or location IDs.
          </li>
        </ul>
        <p>
          Please do not send customer addresses, phone numbers, full payment
          details, or unnecessary customer personal data in support requests.
        </p>
      </section>

      <section>
        <h2>Legal pages</h2>
        <p>
          Review the <Link to="/privacy">Privacy Policy</Link> and{" "}
          <Link to="/terms">Terms of Service</Link> for more information about
          app usage and data handling.
        </p>
      </section>
    </PublicPageLayout>
  );
}
