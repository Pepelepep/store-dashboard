import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy | ShopOps Studio" },
  {
    name: "description",
    content:
      "ShopOps Studio privacy policy for Shopify App Store review and merchants.",
  },
];

const pageStyle = {
  background: "#f6f7f8",
  color: "#202223",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  minHeight: "100vh",
  padding: "32px 18px 48px",
} as const;

const shellStyle = {
  margin: "0 auto",
  maxWidth: 920,
} as const;

const navStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 14,
  marginBottom: 28,
} as const;

const linkStyle = {
  color: "#1f5fbf",
  fontWeight: 700,
  textDecoration: "none",
} as const;

const cardStyle = {
  background: "white",
  border: "1px solid #dde1e5",
  borderRadius: 8,
  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  padding: "30px clamp(18px, 4vw, 44px)",
} as const;

const sectionStyle = {
  borderTop: "1px solid #e5e7eb",
  marginTop: 26,
  paddingTop: 22,
} as const;

export default function PrivacyPolicy() {
  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <nav aria-label="Legal pages" style={navStyle}>
          <Link style={linkStyle} to="/privacy">
            Privacy
          </Link>
          <Link style={linkStyle} to="/terms">
            Terms
          </Link>
          <Link style={linkStyle} to="/support">
            Support
          </Link>
        </nav>

        <article style={cardStyle}>
          <p style={{ color: "#5c5f62", fontWeight: 700, margin: "0 0 8px" }}>
            ShopOps Studio
          </p>
          <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: "0 0 12px" }}>
            Privacy Policy
          </h1>
          <p style={{ color: "#5c5f62", lineHeight: 1.6, margin: 0 }}>
            ShopOps Studio helps Shopify merchants understand store operations,
            inventory, margins, and reporting health. This page summarizes the
            data we process to provide the app.
          </p>

          <section style={sectionStyle}>
            <h2>Data We Process</h2>
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
              operational metrics such as sales, discounts, refunds, returns,
              cost of goods sold, gross profit, gross margin, expenses, net
              profit, stock alerts, best sellers, vendor reporting, location
              reporting, and data quality status.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Staff and User Data</h2>
            <p>
              If Shopify approves user access for the app, ShopOps Studio may
              process Shopify staff or user IDs, names, email addresses where
              available, active status, and related metadata. This data is used
              for staff attribution, admin controls, and location-based
              permissions. It is not used for marketing.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Why We Process Data</h2>
            <p>
              We process merchant shop data to provide reporting inside Shopify,
              keep reports current through syncs and webhooks, diagnose sync
              issues, support data quality checks, manage app permissions, and
              respond to Shopify privacy webhook requests.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Data Isolation and Sharing</h2>
            <p>
              ShopOps Studio keeps business analytics data scoped to the Shopify
              shop that installed the app. One merchant should not be able to
              access another merchant&apos;s shop data through the app.
            </p>
            <p>
              We do not sell merchant or customer data. We do not use customer
              data for marketing. Data is shared only as needed to operate,
              secure, maintain, and support the app and to comply with Shopify
              platform requirements or applicable law.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Data Retention</h2>
            <p>
              Shop-scoped business analytics data may be retained for up to 30
              days after uninstall to support accidental reinstall recovery and
              short-term support, unless deletion or redaction is required
              earlier.
            </p>
            <p>
              ShopOps Studio supports Shopify&apos;s mandatory privacy webhooks:
              <code> customers/data_request</code>, <code> customers/redact</code>,
              and <code> shop/redact</code>.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Contact</h2>
            <p>
              For privacy, security, or support questions, contact{" "}
              <a style={linkStyle} href="mailto:support@shopopsstudio.com">
                support@shopopsstudio.com
              </a>
              . Security or privacy requests are prioritized. You can also
              review the{" "}
              <Link style={linkStyle} to="/support">
                support page
              </Link>
              .
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
