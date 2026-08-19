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

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
  marginTop: 12,
};

const thStyle = {
  textAlign: "left" as const,
  borderBottom: "2px solid #dde1e5",
  padding: "6px 10px 6px 0",
  fontSize: 13,
  color: "#5c5f62",
};

const tdStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "8px 10px 8px 0",
  fontSize: 15,
};

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
            Last updated: August 19, 2026. ShopOps Studio is operated by Pierre-Paul
            Quilichini, based in Québec, Canada. This policy explains how we
            collect, use, disclose, and protect information in connection with
            the ShopOps Studio app.
          </p>

          <section style={sectionStyle}>
            <h2>1. Scope and role</h2>
            <p>
              ShopOps Studio acts as a data processor / service provider on the
              merchant&apos;s behalf and instructions for the store data
              described below. The merchant remains the data controller for
              its own store&apos;s business and customer data. Where this
              policy uses terms defined by applicable law, those terms carry
              the meaning given by the law that applies to you, including
              Québec&apos;s{" "}
              <em>Act Respecting the Protection of Personal Information in
              the Private Sector</em>{" "}
              (&quot;Law 25&quot;), Canada&apos;s{" "}
              <em>Personal Information Protection and Electronic Documents
              Act</em>{" "}
              (&quot;PIPEDA&quot;), the EU/UK GDPR, and the California
              Consumer Privacy Act, to the extent any of these apply to a
              given merchant or transaction.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>2. Information we collect</h2>
            <p>
              To provide the service, ShopOps Studio syncs and stores the
              following categories of data from the merchant&apos;s Shopify
              store, scoped to that merchant&apos;s shop:
            </p>
            <ul>
              <li>
                Shop and session data: shop domain, Shopify session tokens,
                OAuth/session metadata, and app authentication records.
              </li>
              <li>
                Locations: Shopify location IDs, names, active status, and
                related metadata.
              </li>
              <li>
                Products, variants, vendors, and SKUs, including titles,
                status, and related product metadata.
              </li>
              <li>
                Inventory and cost data used to calculate margin, including
                unit cost and cost snapshots.
              </li>
              <li>
                Orders and order lines, including quantities, prices,
                discounts, returns, taxes, shipping amount, revenue, cost of
                goods sold, gross profit, and (where available) staff
                attribution fields.
              </li>
              <li>
                Refunds, returns, and transactions, including amounts,
                statuses, and processed timestamps.
              </li>
              <li>
                App permission identities: staff email addresses entered by
                admins, the current session&apos;s Shopify user ID where
                available, role, and location assignments.
              </li>
              <li>
                Optional staff/user metadata used only for staff-sales
                attribution and access administration.
              </li>
              <li>
                Fixed expenses configured in the app: names, categories,
                amounts, assigned locations, and effective date ranges.
              </li>
              <li>
                Sync, job, webhook, and compliance logs used for
                troubleshooting and audit evidence.
              </li>
            </ul>
            <p>
              <strong>
                We do not intentionally collect, store, or display direct
                customer profile fields.
              </strong>{" "}
              Customer name, mailing address, phone number, and email address
              are not stored in ShopOps Studio&apos;s reporting tables.{" "}
              <code>orders.shipping</code> is a shipping <em>amount</em>, not
              a customer address, and <code>staff_member_email</code> /{" "}
              <code>user_email</code> fields identify staff or app users, not
              customers.
            </p>
            <p>
              We do not use cookies or browser local storage to authenticate
              you; the app uses Shopify session tokens exchanged through
              Shopify&apos;s App Bridge.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>3. How we use information</h2>
            <p>We use the data described above to:</p>
            <ul>
              <li>
                provide sales, margin, cost-of-goods-sold, inventory, and
                location reporting inside the Shopify Admin;
              </li>
              <li>
                calculate gross profit, gross margin, net profit, and related
                metrics;
              </li>
              <li>keep reports current through webhooks and scheduled syncs;</li>
              <li>
                administer role- and location-based permissions that
                administrators configure;
              </li>
              <li>diagnose sync failures and data-quality issues;</li>
              <li>verify and enforce the merchant&apos;s Shopify App Pricing subscription; and</li>
              <li>receive and respond to Shopify&apos;s mandatory privacy webhooks.</li>
            </ul>
            <p>
              We do not use merchant or customer data to train third-party
              AI/ML models, we do not sell personal information as defined
              under the CCPA, and we do not share data for cross-context
              behavioral advertising.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>4. Legal basis for processing</h2>
            <p>
              Where GDPR applies, we rely on performance of the contract
              between the merchant and ShopOps Studio, the merchant&apos;s
              legitimate interest in understanding its own business, and
              compliance with legal obligations such as Shopify&apos;s
              compliance webhooks. Where Law 25 or PIPEDA applies, processing
              is carried out because it is necessary to provide the service
              the merchant has requested.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>5. Subprocessors and infrastructure providers</h2>
            <p>
              We do not sell merchant or customer data. Data is shared only
              with the infrastructure providers required to operate the app:
            </p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Provider</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Location</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tdStyle}>Shopify Inc.</td>
                  <td style={tdStyle}>Platform, Admin API, App Pricing billing</td>
                  <td style={tdStyle}>Global (Shopify-operated)</td>
                </tr>
                <tr>
                  <td style={tdStyle}>Render Services, Inc.</td>
                  <td style={tdStyle}>Application hosting</td>
                  <td style={tdStyle}>Oregon, United States</td>
                </tr>
                <tr>
                  <td style={tdStyle}>Supabase, Inc. (PostgreSQL)</td>
                  <td style={tdStyle}>Database storage</td>
                  <td style={tdStyle}>United States</td>
                </tr>
              </tbody>
            </table>
            <p>
              We may add or change subprocessors as operationally necessary;
              material changes will be reflected in an updated version of
              this policy.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>6. International data transfers</h2>
            <p>
              ShopOps Studio is operated from Québec, Canada, but the
              providers listed above process and store data in the United
              States. If you or your customers are located in Québec, the
              European Economic Area, the United Kingdom, or another
              jurisdiction with its own cross-border transfer rules, this
              means personal information may be transferred to and processed
              in a jurisdiction whose privacy laws differ from your own. We
              take reasonable contractual, technical, and organizational
              measures with our subprocessors to protect information
              transferred this way.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>7. Data retention and deletion</h2>
            <p>
              Shop-scoped business analytics data may be retained for up to{" "}
              <strong>30 days</strong> after uninstall to support accidental
              reinstall recovery and short-term support, unless Shopify&apos;s{" "}
              <code>shop/redact</code> webhook or another valid deletion
              request requires deletion sooner. Minimal compliance audit
              events (topic, status, timestamp, and non-sensitive details —
              never raw customer contact values) are retained for one year.
              Uninstalling the app immediately deletes Shopify sessions and
              the billing cache; reinstalling always requires fresh
              authentication and a fresh billing check.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>8. Shopify&apos;s mandatory privacy webhooks</h2>
            <p>ShopOps Studio implements Shopify&apos;s three mandatory compliance webhooks:</p>
            <ul>
              <li>
                <code>customers/data_request</code> — we record a compliance
                audit event and do not log raw customer contact values from
                the webhook payload.
              </li>
              <li>
                <code>customers/redact</code> — where Shopify provides order
                IDs, we redact the display fields of the matching orders
                while preserving aggregate financial totals.
              </li>
              <li>
                <code>shop/redact</code> — we delete all shop-scoped business
                analytics data and Shopify sessions for the requesting shop.
              </li>
            </ul>
            <p>
              All three routes verify Shopify&apos;s HMAC signature; requests
              that fail verification receive an HTTP 401 response and are
              not processed.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>9. Your rights</h2>
            <p>
              Depending on where you or your customers are located, you may
              have rights to access, correct, delete, or receive a copy of
              personal information, and to object to or restrict certain
              processing. Because ShopOps Studio acts as a processor for the
              merchant&apos;s store data, requests from a merchant&apos;s
              customers should generally be directed to the merchant first.
              Merchants may exercise the same rights over their own account
              and configuration data by contacting us directly.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>10. Security</h2>
            <p>
              We use Shopify OAuth sessions, Shopify webhook signature
              verification, and bearer-secret protection for internal
              cron/maintenance endpoints. No method of transmission or
              storage is completely secure, but we take reasonable,
              industry-standard measures to protect the data described in
              this policy.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>11. Children&apos;s privacy</h2>
            <p>
              The app is a business tool for Shopify merchants and is not
              directed at, or knowingly used to collect information from,
              children.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>12. Changes to this policy</h2>
            <p>
              We may update this policy to reflect changes in the app, our
              infrastructure, or applicable law. We will update the date
              above and, for material changes, make reasonable efforts to
              notify merchants before the change takes effect.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>13. Contact</h2>
            <p>
              Questions, requests, or complaints about this policy can be
              sent to{" "}
              <a style={linkStyle} href="mailto:support@shopopsstudio.com">
                support@shopopsstudio.com
              </a>
              . We aim to respond within 2 business days; security or
              privacy-sensitive requests are prioritized. You can also review
              the{" "}
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
