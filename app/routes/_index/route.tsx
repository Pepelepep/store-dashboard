import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { Link, redirect } from "react-router";
import {
  ArrowRight,
  BarChart3,
  Check,
  CircleDollarSign,
  DatabaseZap,
  MapPin,
  ShieldCheck,
  Users,
} from "lucide-react";

import marketingStylesHref from "./marketing.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: marketingStylesHref },
];

export const meta: MetaFunction = () => [
  { title: "ShopOps Studio | Profit clarity for every Shopify location" },
  {
    name: "description",
    content:
      "Turn Shopify sales, COGS, margins, expenses, inventory, and location performance into one clear operational view.",
  },
  { property: "og:title", content: "ShopOps Studio" },
  {
    property: "og:description",
    content:
      "Profit clarity for every Shopify location — without rebuilding another spreadsheet.",
  },
  { property: "og:type", content: "website" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.has("shop")) {
    return redirect(`/app${url.search}`);
  }
  return null;
}

const CONTACT_HREF =
  "mailto:support@shopopsstudio.com?subject=ShopOps%20Studio%20-%20Getting%20started";
const SCREENSHOT_ROOT = "/marketplace/screenshots/2026-08-final";

const FEATURES = [
  {
    icon: CircleDollarSign,
    title: "Know what you actually keep",
    body: "See net sales, COGS, gross profit, gross margin, fixed expenses, and net profit in one consistent view.",
    tone: "emerald",
  },
  {
    icon: MapPin,
    title: "Compare every location",
    body: "Spot which stores lead or lag with clear sales share, profitability, and versus-average comparisons.",
    tone: "blue",
  },
  {
    icon: BarChart3,
    title: "Understand what drives sales",
    body: "Explore hourly performance, best sellers, vendors, order lines, discounts, refunds, and returns.",
    tone: "violet",
  },
  {
    icon: Users,
    title: "Give each team the right view",
    body: "Connect POS sales attribution and control ShopOps access by role and reporting location.",
    tone: "amber",
  },
] as const;

const PLANS = [
  {
    name: "Solo",
    price: "$19",
    summary: "For one owner operating one location.",
    features: ["1 reporting location", "1 ShopOps user", "All core reporting"],
    featured: false,
  },
  {
    name: "Growth",
    price: "$49",
    summary: "For growing teams that need shared visibility.",
    features: [
      "Up to 5 locations",
      "Up to 5 ShopOps users",
      "Location-aware access",
    ],
    featured: true,
  },
  {
    name: "Multi-location",
    price: "$99",
    summary: "For established retail operations.",
    features: [
      "Up to 10 locations",
      "Unlimited ShopOps users",
      "Full multi-location reporting",
    ],
    featured: false,
  },
] as const;

const PRODUCT_VIEWS = [
  {
    title: "Overview",
    body: "A complete operational picture, with period-over-period context built into the metrics that matter.",
    image: `${SCREENSHOT_ROOT}/01-overview-kpis-1600x900.png`,
    alt: "ShopOps Studio overview with sales, profit, cost, refund, and period comparison metrics",
  },
  {
    title: "Location performance",
    body: "Compare stores across sales, orders, COGS, margin, expenses, and net profit — on one screen.",
    image: `${SCREENSHOT_ROOT}/05-location-comparison-1600x900.png`,
    alt: "ShopOps Studio multi-location comparison table",
  },
  {
    title: "Costs and expenses",
    body: "Complete missing product costs and allocate recurring operating expenses without leaving Shopify.",
    image: `${SCREENSHOT_ROOT}/07-operating-expenses-1600x900.png`,
    alt: "ShopOps Studio operating expense management",
  },
  {
    title: "People and access",
    body: "Keep reporting useful and focused with role-based access and location assignments.",
    image: `${SCREENSHOT_ROOT}/09-location-access-1600x900.png`,
    alt: "ShopOps Studio people and location access management",
  },
] as const;

export default function MarketingHome() {
  return (
    <main className="marketing-page">
      <header className="marketing-nav-wrap">
        <div className="marketing-shell marketing-nav">
          <a className="brand" href="#top" aria-label="ShopOps Studio home">
            <img
              src="/marketplace/shopops-studio-logo-horizontal.jpg"
              alt="ShopOps Studio"
              width="180"
              height="90"
            />
          </a>
          <nav className="marketing-nav-links" aria-label="Primary navigation">
            <a href="#product">Product</a>
            <a href="#pricing">Pricing</a>
            <Link to="/support">Support</Link>
          </nav>
          <a
            className="marketing-button marketing-button-small"
            href={CONTACT_HREF}
          >
            Get started <ArrowRight aria-hidden="true" size={16} />
          </a>
        </div>
      </header>

      <section className="marketing-hero" id="top">
        <div className="marketing-shell hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="eyebrow-dot" /> Built for Shopify retailers
            </div>
            <h1>Profit clarity for every Shopify location.</h1>
            <p className="hero-lead">
              Turn sales, COGS, margins, expenses, inventory, and team
              performance into one clear operational view — without rebuilding
              another spreadsheet.
            </p>
            <div className="hero-actions">
              <a className="marketing-button" href={CONTACT_HREF}>
                Start with ShopOps <ArrowRight aria-hidden="true" size={18} />
              </a>
              <a
                className="marketing-button marketing-button-secondary"
                href="#product"
              >
                See the product
              </a>
            </div>
            <div className="hero-proof" aria-label="Product highlights">
              <span>
                <Check aria-hidden="true" size={16} /> 14-day free trial
              </span>
              <span>
                <Check aria-hidden="true" size={16} /> Shopify-managed billing
              </span>
              <span>
                <Check aria-hidden="true" size={16} /> No setup fee
              </span>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-glow" aria-hidden="true" />
            <div className="product-frame hero-frame">
              <div className="frame-toolbar" aria-hidden="true">
                <span />
                <span />
                <span />
                <div>ShopOps Studio</div>
              </div>
              <img
                src={`${SCREENSHOT_ROOT}/01-overview-kpis-1600x900.png`}
                alt="ShopOps Studio profitability overview"
                width="1600"
                height="900"
              />
            </div>
            <div className="hero-float hero-float-profit">
              <span>Net profit</span>
              <strong>$4,471.73</strong>
              <small>↑ 2.8% vs previous period</small>
            </div>
            <div className="hero-float hero-float-status">
              <ShieldCheck aria-hidden="true" size={18} /> Data up to date
            </div>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="ShopOps capabilities">
        <div className="marketing-shell trust-grid">
          <div>
            <DatabaseZap aria-hidden="true" />
            <span>
              <strong>Automatic sync</strong> for orders, products, inventory,
              and locations
            </span>
          </div>
          <div>
            <ShieldCheck aria-hidden="true" />
            <span>
              <strong>Location-aware access</strong> for owners and store teams
            </span>
          </div>
          <div>
            <BarChart3 aria-hidden="true" />
            <span>
              <strong>Operational reporting</strong> designed to be reviewed,
              not decoded
            </span>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="product">
        <div className="marketing-shell">
          <div className="section-heading section-heading-center">
            <span className="section-kicker">One operational workspace</span>
            <h2>From top-line sales to the details that explain them.</h2>
            <p>
              ShopOps keeps performance, profitability, people, and reporting
              readiness connected inside Shopify.
            </p>
          </div>
          <div className="feature-grid">
            {FEATURES.map(({ icon: Icon, title, body, tone }) => (
              <article className="feature-card" key={title}>
                <div className={`feature-icon feature-icon-${tone}`}>
                  <Icon aria-hidden="true" size={22} />
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="marketing-section product-tour">
        <div className="marketing-shell product-tour-list">
          {PRODUCT_VIEWS.map((view, index) => (
            <article
              className={`product-view ${index % 2 === 1 ? "product-view-reverse" : ""}`}
              key={view.title}
            >
              <div className="product-view-copy">
                <span className="view-number">0{index + 1}</span>
                <h2>{view.title}</h2>
                <p>{view.body}</p>
              </div>
              <div className="product-frame product-view-frame">
                <img
                  src={view.image}
                  alt={view.alt}
                  width="1600"
                  height="900"
                  loading="lazy"
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="marketing-section data-section">
        <div className="marketing-shell data-grid">
          <div className="data-copy">
            <span className="section-kicker">
              Confidence before conclusions
            </span>
            <h2>Know when your reporting is ready.</h2>
            <p>
              ShopOps surfaces data freshness, missing product costs, and sync
              status so gaps are visible before they become decisions.
            </p>
            <ul className="check-list">
              <li>
                <Check aria-hidden="true" /> Orders, products, inventory, and
                locations
              </li>
              <li>
                <Check aria-hidden="true" /> Clear cost coverage and
                estimated-cost context
              </li>
              <li>
                <Check aria-hidden="true" /> Recent activity and actionable
                status messages
              </li>
            </ul>
          </div>
          <div className="product-frame data-frame">
            <img
              src={`${SCREENSHOT_ROOT}/11-data-sync-1600x900.png`}
              alt="ShopOps Studio data synchronization status"
              width="1600"
              height="900"
              loading="lazy"
            />
          </div>
        </div>
      </section>

      <section className="marketing-section pricing-section" id="pricing">
        <div className="marketing-shell">
          <div className="section-heading section-heading-center">
            <span className="section-kicker">Simple pricing</span>
            <h2>Start with the operation you have today.</h2>
            <p>
              Every public plan includes a 14-day free trial and Shopify-managed
              billing.
            </p>
          </div>
          <div className="pricing-grid">
            {PLANS.map((plan) => (
              <article
                className={`pricing-card ${plan.featured ? "pricing-card-featured" : ""}`}
                key={plan.name}
              >
                {plan.featured ? (
                  <span className="popular-label">Most popular</span>
                ) : null}
                <h3>{plan.name}</h3>
                <p className="plan-summary">{plan.summary}</p>
                <p className="plan-price">
                  <strong>{plan.price}</strong>
                  <span> USD / month</span>
                </p>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>
                      <Check aria-hidden="true" size={17} /> {feature}
                    </li>
                  ))}
                </ul>
                <a
                  className={`marketing-button ${plan.featured ? "" : "marketing-button-secondary"}`}
                  href={CONTACT_HREF}
                >
                  Start free trial
                </a>
              </article>
            ))}
          </div>
          <p className="pricing-note">
            Cancel or change plans through Shopify. No setup fees.
          </p>
        </div>
      </section>

      <section className="marketing-section final-cta-section">
        <div className="marketing-shell">
          <div className="final-cta">
            <div>
              <span className="section-kicker">
                Built for clearer decisions
              </span>
              <h2>Run every location with the same view of the truth.</h2>
              <p>
                Bring sales, costs, profit, inventory, and teams together inside
                Shopify.
              </p>
            </div>
            <a
              className="marketing-button marketing-button-light"
              href={CONTACT_HREF}
            >
              Talk to ShopOps <ArrowRight aria-hidden="true" size={18} />
            </a>
          </div>
        </div>
      </section>

      <footer className="marketing-footer">
        <div className="marketing-shell footer-grid">
          <div>
            <a className="brand brand-footer" href="#top">
              <img
                src="/marketplace/shopops-studio-logo-horizontal.jpg"
                alt="ShopOps Studio"
                width="180"
                height="90"
              />
            </a>
            <p>Operational reporting for Shopify retailers.</p>
          </div>
          <nav aria-label="Legal and support">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/support">Support</Link>
          </nav>
        </div>
        <div className="marketing-shell footer-disclaimer">
          <span>© {new Date().getFullYear()} ShopOps Studio.</span>
          <span>
            Reports are informational and do not constitute accounting, tax,
            legal, payroll, or financial advice.
          </span>
        </div>
      </footer>
    </main>
  );
}
