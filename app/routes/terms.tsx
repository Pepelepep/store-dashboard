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
            Last updated: August 19, 2026. These Terms govern access to and
            use of ShopOps Studio, operated by Pierre-Paul Quilichini, based
            in Québec, Canada. By installing or using the app, the installing
            merchant agrees to these Terms.
          </p>

          <section style={sectionStyle}>
            <h2>1. The service</h2>
            <p>
              ShopOps Studio is a Shopify embedded app that provides
              operational reporting for merchants, including location
              performance, product and vendor sales, cost of goods sold,
              gross profit and margin, inventory and stock-alert insights,
              best-effort staff sales attribution, merchant-configured fixed
              expenses, and sync/data-quality visibility.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>2. Eligibility and accounts</h2>
            <p>
              You must have the authority to install and operate apps on the
              Shopify store on which you install the service, and your use
              must comply with Shopify&apos;s own Merchant/Partner agreements
              and Acceptable Use Policy. You are responsible for the access
              you grant to others under your store.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>3. Acceptable use</h2>
            <p>
              Merchants may use ShopOps Studio to sync Shopify store data
              into reporting views, review location, product, staff,
              inventory, and financial metrics, configure fixed expenses,
              manage app-level access where supported, and monitor sync
              health and data quality.
            </p>
            <p>Merchants may not, and may not permit anyone else to:</p>
            <ul>
              <li>use the app to violate Shopify&apos;s policies or applicable law;</li>
              <li>attempt to access data belonging to a shop other than their own;</li>
              <li>
                reverse engineer, decompile, probe, or attempt to bypass the
                security of the app or its infrastructure;
              </li>
              <li>interfere with, overload, or disrupt the app or systems it depends on; or</li>
              <li>share access credentials with anyone not authorized under their own permissions.</li>
            </ul>
          </section>

          <section style={sectionStyle}>
            <h2>4. Reporting and financial disclaimer</h2>
            <p>
              ShopOps Studio provides operational reporting and analytics
              only. <strong>It does not provide accounting, legal, tax,
              payroll, financial, or other professional advice</strong>, and
              nothing in the app should be treated as such. Reports depend on
              synced Shopify data, merchant-configured expenses, available
              inventory cost data, Shopify API behavior, and sync timing.
              Merchants remain solely responsible for independently
              validating all financial reports — including sales, discounts,
              refunds, returns, taxes, shipping, cost of goods sold, gross
              profit, expenses, and net profit — before relying on them for
              business, tax, accounting, payroll, or regulatory purposes.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>5. Subscription and billing</h2>
            <p>
              The service is billed exclusively through{" "}
              <strong>Shopify App Pricing</strong>; ShopOps Studio does not
              collect payment details directly. As of the date above, public
              plans are Solo (US $19/month), Growth (US $49/month), and
              Multi-location (US $99/month), each with a 14-day free trial; a
              private QA plan may also be offered to specific test/review
              stores at no charge. Current pricing and plan limits are
              authoritative in the Shopify Admin at the time of subscription.
            </p>
            <p>
              Your subscription status is verified against Shopify&apos;s
              Partner API on each protected request. You may upgrade,
              downgrade, or cancel your plan at any time from the Shopify
              Admin; cancellation remains in effect through the end of the
              billing cycle already paid for.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>6. Data and privacy</h2>
            <p>
              Our collection and use of data is described in our{" "}
              <Link style={linkStyle} to="/privacy">
                Privacy Policy
              </Link>
              , which is incorporated into these Terms by reference. You are
              responsible for ensuring that your own use of the app complies
              with your obligations to your customers, staff, and regulators.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>7. Intellectual property</h2>
            <p>
              ShopOps Studio and its original content, features, branding,
              and functionality are owned by us. These Terms do not grant you
              any right to use our name, logos, or branding except as
              necessary to use the service as intended. You retain all
              rights to your own store data; we claim no ownership over it.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>8. Availability, changes, and support</h2>
            <p>
              The app may be unavailable during maintenance, Shopify platform
              incidents, hosting or database issues, or other operational
              events outside our reasonable control. We may add, remove, or
              modify features over time. Support is available at{" "}
              <a style={linkStyle} href="mailto:support@shopopsstudio.com">
                support@shopopsstudio.com
              </a>
              ; target response times are described on our{" "}
              <Link style={linkStyle} to="/support">
                support page
              </Link>
              . These are service targets, not a contractual guarantee unless
              separately agreed in writing.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>9. Termination</h2>
            <p>
              You may uninstall the app at any time through Shopify.
              Uninstalling immediately terminates active sessions; data
              retention and deletion are described in our Privacy Policy. We
              may suspend or terminate access for suspected abuse, security
              risk, non-payment on an active subscription, violation of
              these Terms or Shopify&apos;s policies, or unlawful use.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>10. Disclaimer of warranties</h2>
            <p>
              The service is provided <strong>&quot;as is&quot; and &quot;as
              available&quot;</strong>, without warranties of any kind,
              whether express, implied, or statutory, to the maximum extent
              permitted by applicable law. We do not warrant that the
              service will be uninterrupted, error-free, or that reports
              will be complete or accurate in every circumstance.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>11. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by applicable law, ShopOps
              Studio will not be liable for any indirect, incidental,
              special, consequential, exemplary, or punitive damages, or for
              loss of profits, revenue, data, or business opportunity,
              arising from your use of the service. Our total aggregate
              liability will not exceed the amount you paid us for the
              service in the 12 months preceding the event giving rise to
              the claim. Nothing in these Terms limits liability that cannot
              be limited under applicable law.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>12. Indemnification</h2>
            <p>
              You agree to indemnify and hold us harmless from claims,
              damages, liabilities, and reasonable expenses arising from your
              use of the service in violation of these Terms, applicable law,
              or a third party&apos;s rights, including a customer&apos;s or
              employee&apos;s rights in connection with data you configure in
              the app.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>13. Governing law and disputes</h2>
            <p>
              These Terms are governed by the laws of the Province of Québec
              and the federal laws of Canada applicable therein. Subject to
              any mandatory rules that cannot be waived under applicable law,
              the parties submit to the exclusive jurisdiction of the courts
              located in Québec, Canada, for any dispute arising out of or
              relating to these Terms or the service.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>14. General</h2>
            <p>
              <strong>Force majeure.</strong> Neither party is liable for
              delay or failure caused by events beyond its reasonable
              control, including outages of Shopify or our hosting/database
              providers.
            </p>
            <p>
              <strong>Assignment.</strong> You may not assign these Terms
              without our prior written consent; we may assign these Terms in
              connection with a merger, acquisition, or sale of substantially
              all of our assets.
            </p>
            <p>
              <strong>Severability.</strong> If any provision is held
              unenforceable, the remaining provisions remain in full force
              and effect.
            </p>
            <p>
              <strong>Entire agreement.</strong> These Terms, together with
              the Privacy Policy, constitute the entire agreement between you
              and us regarding the service.
            </p>
            <p>
              <strong>Changes.</strong> We may update these Terms; we will
              update the date above and, for material changes, make
              reasonable efforts to notify merchants before the change takes
              effect. Continued use after a change takes effect constitutes
              acceptance of the updated Terms.
            </p>
          </section>

          <section style={sectionStyle}>
            <h2>15. Contact</h2>
            <p>
              Questions about these Terms can be sent to{" "}
              <a style={linkStyle} href="mailto:support@shopopsstudio.com">
                support@shopopsstudio.com
              </a>
              .
            </p>
          </section>
        </article>
      </div>
    </main>
  );
}
