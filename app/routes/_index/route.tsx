import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, redirect } from "react-router";

export const meta: MetaFunction = () => [
  { title: "ShopOps Studio | Shopify reporting for multi-location retailers" },
  {
    name: "description",
    content:
      "ShopOps Studio gives Shopify merchants a clearer view of store performance: sales, margins, COGS, refunds, returns, discounts, inventory, expenses, staff attribution, and location-aware permissions.",
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.has("shop")) {
    return redirect(`/app${url.search}`);
  }
  return null;
}

const pageStyle = {
  background: "#f6f7f8",
  color: "#202223",
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  minHeight: "100vh",
} as const;

const shellStyle = {
  margin: "0 auto",
  maxWidth: 1080,
  padding: "0 18px",
} as const;

const linkStyle = {
  color: "#1f5fbf",
  fontWeight: 700,
  textDecoration: "none",
} as const;

const navBarStyle = {
  alignItems: "center",
  display: "flex",
  justifyContent: "space-between",
  padding: "22px 0",
} as const;

const navLinksStyle = {
  alignItems: "center",
  display: "flex",
  gap: 22,
} as const;

const primaryButtonStyle = {
  background: "#1f5fbf",
  borderRadius: 8,
  color: "white",
  display: "inline-block",
  fontWeight: 700,
  padding: "12px 22px",
  textDecoration: "none",
} as const;

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  background: "transparent",
  border: "1px solid #dde1e5",
  color: "#202223",
} as const;

const cardStyle = {
  background: "white",
  border: "1px solid #dde1e5",
  borderRadius: 10,
  boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  padding: "24px",
} as const;

const sectionHeadingStyle = {
  fontSize: 28,
  margin: "0 0 8px",
} as const;

const sectionLeadStyle = {
  color: "#5c5f62",
  lineHeight: 1.6,
  margin: "0 0 32px",
  maxWidth: 640,
} as const;

const CONTACT_HREF =
  "mailto:support@shopopsstudio.com?subject=ShopOps%20Studio%20-%20Getting%20started";

const BENEFITS = [
  {
    title: "See margins, not just sales",
    body: "COGS, gross profit, and gross margin computed from real Shopify cost and order data, per location.",
  },
  {
    title: "Compare every location",
    body: "One dashboard for downtown stores, malls, pop-ups, or warehouses — filter by location and date range.",
  },
  {
    title: "Trust your numbers",
    body: "Data Health flags missing costs, stale syncs, and reporting gaps before they reach a spreadsheet.",
  },
  {
    title: "Discounts, refunds, returns",
    body: "Reporting accounts for discounts, refunds, and returns instead of showing gross sales as if nothing changed.",
  },
  {
    title: "Give managers their own view",
    body: "Location-scoped permissions mean a store manager sees their store's performance — nothing more, nothing less.",
  },
  {
    title: "Know your true profit",
    body: "Add fixed expenses by location or globally to see net profit, not just gross margin.",
  },
] as const;

const FEATURES = [
  "Dashboard: sales, net sales, COGS, gross profit, gross margin, expenses, net profit",
  "Location performance for stores, pop-ups, warehouses, or any Shopify location",
  "Product, SKU, vendor, and best-seller reporting",
  "Inventory visibility and low-stock signals",
  "Discount, refund, return, and transaction-aware reporting",
  "Fixed expense management, global or per location",
  "Best-effort Sales by Staff where Shopify order data supports it",
  "Location-based permissions managed by staff email",
  "Data Health checks for sync freshness and reporting gaps",
] as const;

export default function MarketingHome() {
  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <header style={navBarStyle}>
          <span style={{ fontSize: 20, fontWeight: 800 }}>ShopOps Studio</span>
          <nav aria-label="Primary" style={navLinksStyle}>
            <a href="#features" style={linkStyle}>
              Features
            </a>
            <a href="#pricing" style={linkStyle}>
              Pricing
            </a>
            <Link style={linkStyle} to="/support">
              Support
            </Link>
            <a href={CONTACT_HREF} style={primaryButtonStyle}>
              Get started
            </a>
          </nav>
        </header>

        <section style={{ padding: "48px 0 56px" }}>
          <p
            style={{
              background: "#e7f0ff",
              borderRadius: 999,
              color: "#1f5fbf",
              display: "inline-block",
              fontSize: 13,
              fontWeight: 700,
              margin: "0 0 18px",
              padding: "6px 14px",
            }}
          >
            Built for multi-location Shopify retailers
          </p>
          <h1
            style={{
              fontSize: "clamp(32px, 5vw, 52px)",
              lineHeight: 1.1,
              margin: "0 0 20px",
              maxWidth: 760,
            }}
          >
            Shopify reporting for margins, COGS, refunds, returns, discounts,
            and Data Health.
          </h1>
          <p
            style={{
              color: "#5c5f62",
              fontSize: 18,
              lineHeight: 1.6,
              margin: "0 0 30px",
              maxWidth: 640,
            }}
          >
            ShopOps Studio gives Shopify merchants with physical stores a
            clear, location-aware view of performance — so owners see it
            all, and store managers see exactly their own store.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <a href={CONTACT_HREF} style={primaryButtonStyle}>
              Get started
            </a>
            <a href="#pricing" style={secondaryButtonStyle}>
              See pricing
            </a>
          </div>
        </section>

        <section id="features" style={{ padding: "8px 0 56px" }}>
          <h2 style={sectionHeadingStyle}>Everything a multi-location merchant needs to trust their numbers</h2>
          <p style={sectionLeadStyle}>
            Reports are informational and built to support operational
            review — not accounting, tax, legal, or payroll advice.
          </p>
          <div
            style={{
              display: "grid",
              gap: 18,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            {BENEFITS.map((benefit) => (
              <div key={benefit.title} style={cardStyle}>
                <h3 style={{ fontSize: 17, margin: "0 0 8px" }}>
                  {benefit.title}
                </h3>
                <p style={{ color: "#5c5f62", lineHeight: 1.6, margin: 0 }}>
                  {benefit.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ padding: "8px 0 56px" }}>
          <div style={{ ...cardStyle, padding: "32px clamp(20px, 4vw, 44px)" }}>
            <h2 style={{ fontSize: 22, margin: "0 0 18px" }}>
              What&apos;s included
            </h2>
            <ul
              style={{
                columnGap: 32,
                columns: "1",
                lineHeight: 1.9,
                margin: 0,
                paddingLeft: 22,
              }}
            >
              {FEATURES.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" style={{ padding: "8px 0 64px" }}>
          <h2 style={sectionHeadingStyle}>Simple, predictable pricing</h2>
          <p style={sectionLeadStyle}>
            One plan. No setup fees. Billing is managed securely through
            Shopify.
          </p>
          <div
            style={{
              ...cardStyle,
              maxWidth: 380,
              padding: "32px clamp(20px, 4vw, 40px)",
            }}
          >
            <p style={{ color: "#5c5f62", fontWeight: 700, margin: "0 0 4px" }}>
              ShopOps Studio
            </p>
            <p style={{ margin: "0 0 4px" }}>
              <span style={{ fontSize: 40, fontWeight: 800 }}>$59.99</span>
              <span style={{ color: "#5c5f62" }}>/month</span>
            </p>
            <p style={{ color: "#5c5f62", margin: "0 0 22px" }}>
              14-day free trial. Cancel anytime through Shopify.
            </p>
            <a
              href={CONTACT_HREF}
              style={{ ...primaryButtonStyle, display: "block", textAlign: "center" }}
            >
              Get started
            </a>
          </div>
        </section>

        <footer
          style={{
            borderTop: "1px solid #e5e7eb",
            padding: "26px 0 40px",
          }}
        >
          <nav
            aria-label="Legal"
            style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 12 }}
          >
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
          <p style={{ color: "#8a8f93", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            ShopOps Studio provides operational reporting for Shopify
            merchants. It is not accounting, tax, legal, payroll, or
            financial advice. Merchants remain responsible for validating
            reports before business use.
          </p>
        </footer>
      </div>
    </main>
  );
}
