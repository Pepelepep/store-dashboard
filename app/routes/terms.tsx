import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Terms of Service | ShopOps Studio" },
  {
    name: "description",
    content: "ShopOps Studio terms of service for Shopify merchants.",
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

export default function TermsOfService() {
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
            Terms of Service
          </h1>
          <p style={{ color: "#5c5f62", lineHeight: 1.6, margin: 0 }}>
            These terms describe how merchants may use ShopOps Studio, a Shopify
            app for operational reporting.
          </p>

          <section style={sectionStyle}>
            <h2>Using the App</h2>
            <p>
              Merchants may use ShopOps Studio to sync Shopify store data into
              reporting views, review location, product, staff, inventory, and
              financial metrics, configure fixed expenses, manage app-level
              access where supported, and monitor sync health and data quality.
            </p>
            <p>
              Merchants may not use the app to violate Shopify policies or
              applicable law, access another shop&apos;s data, interfere with the
              service, or share app access with unauthorized users.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Merchant Responsibilities</h2>
            <p>
              Merchants are responsible for their Shopify account, app
              installation choices, staff access, source data accuracy,
              configured expenses, inventory costs, permissions, and compliance
              with laws that apply to their business.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Reporting Disclaimer</h2>
            <p>
              ShopOps Studio provides informational operational reporting only.
              It is not financial, accounting, legal, tax, payroll, or
              professional advice. Merchants remain responsible for validating
              reports before relying on them for business decisions or regulated
              filings.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Subscription and Billing</h2>
            <p>
              ShopOps Studio subscriptions, trials, billing, cancellation, and
              related payment handling are managed through Shopify. Merchants
              should review the Shopify App Store listing and Shopify billing
              screens for current plan and pricing details.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Availability and Changes</h2>
            <p>
              The app may be unavailable during maintenance, Shopify platform
              incidents, infrastructure issues, or other operational events.
              ShopOps Studio may add, remove, or modify features over time.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Limitation of Liability</h2>
            <p>
              To the maximum extent allowed by law, ShopOps Studio is not liable
              for indirect, incidental, special, consequential, punitive, or
              lost-profit damages arising from use of the app. The app is
              provided for operational reporting, and merchants are responsible
              for confirming data before acting on it.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Privacy and Support</h2>
            <p>
              Data handling is described in the{" "}
              <Link style={linkStyle} to="/privacy">
                Privacy Policy
              </Link>
              . For help, contact{" "}
              <a style={linkStyle} href="mailto:support@shopopsstudio.com">
                support@shopopsstudio.com
              </a>{" "}
              or visit{" "}
              <Link style={linkStyle} to="/support">
                ShopOps Studio support
              </Link>
              . Support requests receive a response within 2 business days.
              Security or privacy requests are prioritized.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
