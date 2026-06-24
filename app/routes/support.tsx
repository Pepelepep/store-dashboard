import type { MetaFunction } from "react-router";
import { Link } from "react-router";

export const meta: MetaFunction = () => [
  { title: "Support | ShopOps Studio" },
  {
    name: "description",
    content: "ShopOps Studio support contact information for Shopify merchants.",
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

export default function Support() {
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
            Support
          </h1>
          <p style={{ color: "#5c5f62", lineHeight: 1.6, margin: 0 }}>
            Need help with ShopOps Studio? Use the contact details and request
            checklist below so we can investigate quickly.
          </p>

          <section style={sectionStyle}>
            <h2>Contact</h2>
            <p>
              Support email:{" "}
              <a style={linkStyle} href="mailto:support@shopopsstudio.com">
                support@shopopsstudio.com
              </a>
            </p>
            <p>
              Expected response time: <strong>within 2 business days</strong>
            </p>
            <p>
              Privacy and security contact:{" "}
              <a style={linkStyle} href="mailto:support@shopopsstudio.com">
                support@shopopsstudio.com
              </a>
              . Security or privacy requests are prioritized.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>What to Include</h2>
            <ul style={{ lineHeight: 1.7, paddingLeft: 22 }}>
              <li>Shopify shop domain.</li>
              <li>Contact name and role.</li>
              <li>Page or workflow affected.</li>
              <li>Date, time, and timezone when the issue occurred.</li>
              <li>Screenshots or screen recording if available.</li>
              <li>Whether the issue affects all staff or one staff user.</li>
              <li>
                Recent Shopify changes, such as new locations, products,
                refunds, returns, staff, or permissions.
              </li>
              <li>
                For reporting issues, the expected value, observed value, and
                sample order, product, or location IDs.
              </li>
            </ul>
            <p>
              Please do not send customer addresses, phone numbers, full payment
              details, or unnecessary customer personal data in support requests.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>Legal Pages</h2>
            <p>
              Review the{" "}
              <Link style={linkStyle} to="/privacy">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link style={linkStyle} to="/terms">
                Terms of Service
              </Link>{" "}
              for more information about app usage and data handling.
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
