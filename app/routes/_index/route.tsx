import type {
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, redirect } from "react-router";
import { AnimatePresence, LazyMotion, MotionConfig } from "motion/react";
import * as m from "motion/react-m";
import {
  ArrowUp,
  ArrowRight,
  BarChart3,
  Check,
  CircleDollarSign,
  DatabaseZap,
  MapPin,
  Menu,
  ShieldCheck,
  Sparkles,
  Users,
  X,
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
const loadMotionFeatures = () =>
  import("./motion-features").then((module) => module.default);
const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;

function getPlanContactHref(planName: string) {
  const subject = encodeURIComponent(`ShopOps Studio — ${planName} trial`);
  const body = encodeURIComponent(
    `Hi ShopOps Studio,\n\nI'd like to start the 14-day ${planName} trial.\n\nShopify store: \nNumber of locations: \n\nThank you.`,
  );
  return `mailto:support@shopopsstudio.com?subject=${subject}&body=${body}`;
}

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ amount: 0.18, once: true }}
      transition={{ delay, duration: 0.58, ease: REVEAL_EASE }}
    >
      {children}
    </m.div>
  );
}

function MarketingNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    const scrollToCurrentHash = () => {
      const targetId = window.location.hash.slice(1);
      if (!targetId) return;

      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ block: "start" });
      });
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("hashchange", scrollToCurrentHash);
    scrollToCurrentHash();

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("hashchange", scrollToCurrentHash);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
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
          <a href="#tour">Product tour</a>
          <a href="#pricing">Pricing</a>
          <Link to="/support">Support</Link>
        </nav>
        <a
          className="marketing-button marketing-button-small nav-cta"
          href={CONTACT_HREF}
        >
          Get started <ArrowRight aria-hidden="true" size={16} />
        </a>
        <button
          aria-controls="mobile-navigation"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          className="mobile-menu-button"
          onClick={() => setMenuOpen((open) => !open)}
          type="button"
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {menuOpen ? (
          <m.nav
            animate={{ height: "auto", opacity: 1 }}
            aria-label="Mobile navigation"
            className="mobile-navigation"
            exit={{ height: 0, opacity: 0 }}
            id="mobile-navigation"
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: REVEAL_EASE }}
          >
            <div className="marketing-shell mobile-navigation-inner">
              <a href="#product" onClick={closeMenu}>
                Product
              </a>
              <a href="#tour" onClick={closeMenu}>
                Product tour
              </a>
              <a href="#pricing" onClick={closeMenu}>
                Pricing
              </a>
              <Link to="/support" onClick={closeMenu}>
                Support
              </Link>
              <a className="marketing-button" href={CONTACT_HREF}>
                Start free trial <ArrowRight aria-hidden="true" size={17} />
              </a>
            </div>
          </m.nav>
        ) : null}
      </AnimatePresence>
    </header>
  );
}

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 720);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  return (
    <AnimatePresence>
      {visible ? (
        <m.a
          animate={{ opacity: 1, scale: 1, y: 0 }}
          aria-label="Back to top"
          className="back-to-top"
          exit={{ opacity: 0, scale: 0.92, y: 8 }}
          href="#top"
          initial={{ opacity: 0, scale: 0.92, y: 8 }}
          onClick={(event) => {
            event.preventDefault();
            window.history.pushState(null, "", "#top");
            window.scrollTo({ top: 0 });
          }}
          transition={{ duration: 0.2 }}
        >
          <ArrowUp aria-hidden="true" size={18} />
          <span>Top</span>
        </m.a>
      ) : null}
    </AnimatePresence>
  );
}

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
    title: "Sales trends",
    body: "Follow daily momentum with net sales, order volume, and period context in one focused view.",
    image: `${SCREENSHOT_ROOT}/04-location-kpis-trend-1600x900.png`,
    alt: "ShopOps Studio daily net sales and order trend",
  },
] as const;

export default function MarketingHome() {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadMotionFeatures} strict>
        <main className="marketing-page">
          <MarketingNavigation />

          <section className="marketing-hero" id="top">
            <div className="marketing-shell hero-grid">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="eyebrow-dot" /> Built for Shopify retailers
                </div>
                <h1>Profit clarity for every Shopify location.</h1>
                <p className="hero-lead">
                  Turn sales, COGS, margins, expenses, inventory, and team
                  performance into one clear operational view — without
                  rebuilding another spreadsheet.
                </p>
                <div className="hero-actions">
                  <a className="marketing-button" href={CONTACT_HREF}>
                    Start with ShopOps{" "}
                    <ArrowRight aria-hidden="true" size={18} />
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
                    <Check aria-hidden="true" size={16} /> Shopify-managed
                    billing
                  </span>
                  <span>
                    <Check aria-hidden="true" size={16} /> No setup fee
                  </span>
                </div>
              </div>

              <m.div
                className="hero-visual"
                initial={false}
                whileHover={{ rotateY: -1, rotateX: 0, y: -4 }}
                transition={{ duration: 0.35, ease: REVEAL_EASE }}
              >
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
                    fetchPriority="high"
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
              </m.div>
            </div>
          </section>

          <section className="trust-strip" aria-label="ShopOps capabilities">
            <div className="marketing-shell trust-grid">
              <div>
                <DatabaseZap aria-hidden="true" />
                <span>
                  <strong>Automatic sync</strong> for orders, products,
                  inventory, and locations
                </span>
              </div>
              <div>
                <ShieldCheck aria-hidden="true" />
                <span>
                  <strong>Location-aware access</strong> for owners and store
                  teams
                </span>
              </div>
              <div>
                <BarChart3 aria-hidden="true" />
                <span>
                  <strong>Operational reporting</strong> designed to be
                  reviewed, not decoded
                </span>
              </div>
            </div>
          </section>

          <section className="marketing-section" id="product">
            <div className="marketing-shell">
              <Reveal className="section-heading section-heading-center">
                <span className="section-kicker">
                  One operational workspace
                </span>
                <h2>From top-line sales to the details that explain them.</h2>
                <p>
                  ShopOps keeps performance, profitability, people, and
                  reporting readiness connected inside Shopify.
                </p>
              </Reveal>
              <div className="feature-grid">
                {FEATURES.map(({ icon: Icon, title, body, tone }, index) => (
                  <m.article
                    className="feature-card"
                    initial={{ opacity: 0, y: 20 }}
                    key={title}
                    transition={{
                      delay: index * 0.07,
                      duration: 0.48,
                      ease: REVEAL_EASE,
                    }}
                    viewport={{ amount: 0.25, once: true }}
                    whileHover={{ y: -6 }}
                    whileInView={{ opacity: 1, y: 0 }}
                  >
                    <div className={`feature-icon feature-icon-${tone}`}>
                      <Icon aria-hidden="true" size={22} />
                    </div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </m.article>
                ))}
              </div>
            </div>
          </section>

          <section className="marketing-section product-tour" id="tour">
            <div className="marketing-shell product-tour-list">
              {PRODUCT_VIEWS.map((view, index) => (
                <m.article
                  className={`product-view ${index % 2 === 1 ? "product-view-reverse" : ""}`}
                  initial={{ opacity: 0, y: 30 }}
                  key={view.title}
                  transition={{ duration: 0.62, ease: REVEAL_EASE }}
                  viewport={{ amount: 0.16, once: true }}
                  whileInView={{ opacity: 1, y: 0 }}
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
                </m.article>
              ))}
            </div>
          </section>

          <section className="marketing-section data-section">
            <Reveal className="marketing-shell data-grid">
              <div className="data-copy">
                <span className="section-kicker">
                  Confidence before conclusions
                </span>
                <h2>Know when your reporting is ready.</h2>
                <p>
                  ShopOps surfaces data freshness, missing product costs, and
                  sync status so gaps are visible before they become decisions.
                </p>
                <ul className="check-list">
                  <li>
                    <Check aria-hidden="true" /> Orders, products, inventory,
                    and locations
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
              <div
                aria-label="Illustrative ShopOps data readiness view"
                className="product-frame data-frame data-health-card"
              >
                <div className="data-health-header">
                  <div>
                    <span className="data-health-label">Data readiness</span>
                    <strong>Ready for reporting</strong>
                  </div>
                  <span className="data-health-status">
                    <ShieldCheck aria-hidden="true" size={16} /> Up to date
                  </span>
                </div>
                <div className="data-health-score">
                  <span>Reporting coverage</span>
                  <strong>100%</strong>
                  <div aria-hidden="true">
                    <span />
                  </div>
                </div>
                <div className="data-health-resources">
                  {[
                    "Orders and refunds",
                    "Products and costs",
                    "Inventory levels",
                    "Retail locations",
                  ].map((resource) => (
                    <div key={resource}>
                      <span>
                        <Check aria-hidden="true" size={14} />
                      </span>
                      <strong>{resource}</strong>
                      <small>Current</small>
                    </div>
                  ))}
                </div>
                <div className="data-health-footer">
                  <DatabaseZap aria-hidden="true" size={17} />
                  Automatic checks keep reporting gaps visible.
                </div>
              </div>
            </Reveal>
          </section>

          <section className="marketing-section pricing-section" id="pricing">
            <div className="marketing-shell">
              <Reveal className="section-heading section-heading-center pricing-heading">
                <span className="section-kicker">Simple pricing</span>
                <h2>Start with the operation you have today.</h2>
                <p>
                  Every public plan includes a 14-day free trial and
                  Shopify-managed billing.
                </p>
                <a className="section-return-link" href="#product">
                  Review what is included{" "}
                  <ArrowRight aria-hidden="true" size={15} />
                </a>
              </Reveal>
              <div className="pricing-grid">
                {PLANS.map((plan, index) => (
                  <m.article
                    className={`pricing-card ${plan.featured ? "pricing-card-featured" : ""}`}
                    initial={{ opacity: 0, y: 26 }}
                    key={plan.name}
                    transition={{
                      delay: index * 0.08,
                      duration: 0.52,
                      ease: REVEAL_EASE,
                    }}
                    viewport={{ amount: 0.2, once: true }}
                    whileHover={{ y: plan.featured ? -14 : -6 }}
                    whileInView={{
                      opacity: 1,
                      y: plan.featured ? -9 : 0,
                    }}
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
                      href={getPlanContactHref(plan.name)}
                    >
                      Choose {plan.name}{" "}
                      <ArrowRight aria-hidden="true" size={17} />
                    </a>
                  </m.article>
                ))}
              </div>
              <div className="pricing-assurance">
                <Sparkles aria-hidden="true" size={16} />
                <span>
                  14 days free · No setup fee · Change or cancel through Shopify
                </span>
              </div>
            </div>
          </section>

          <section className="marketing-section final-cta-section">
            <div className="marketing-shell">
              <Reveal className="final-cta">
                <div>
                  <span className="section-kicker">
                    Built for clearer decisions
                  </span>
                  <h2>Run every location with the same view of the truth.</h2>
                  <p>
                    Bring sales, costs, profit, inventory, and teams together
                    inside Shopify.
                  </p>
                </div>
                <a
                  className="marketing-button marketing-button-light"
                  href={CONTACT_HREF}
                >
                  Talk to ShopOps <ArrowRight aria-hidden="true" size={18} />
                </a>
              </Reveal>
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
              <nav aria-label="Site links">
                <a href="#product">Product</a>
                <a href="#tour">Tour</a>
                <a href="#pricing">Pricing</a>
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
          <BackToTop />
        </main>
      </LazyMotion>
    </MotionConfig>
  );
}
