import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "react-router";

export function PublicPageLayout({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <main className="public-page">
      <header className="public-page-header">
        <div className="public-page-shell public-page-nav">
          <Link
            className="public-page-brand"
            to="/"
            aria-label="ShopOps Studio home"
          >
            <img
              src="/marketplace/shopops-studio-logo-horizontal.jpg"
              alt="ShopOps Studio"
              width="180"
              height="90"
            />
          </Link>
          <nav aria-label="Public site navigation">
            <Link to="/">Home</Link>
            <Link to="/#product">Product</Link>
            <Link to="/#pricing">Pricing</Link>
            <Link to="/support">Support</Link>
          </nav>
        </div>
      </header>

      <div className="public-page-shell public-page-content">
        <Link className="public-page-back" to="/">
          <ArrowLeft aria-hidden="true" size={16} /> Back to ShopOps Studio
        </Link>
        <article className="public-page-card">
          <span className="public-page-kicker">ShopOps Studio</span>
          <h1>{title}</h1>
          <p className="public-page-intro">{description}</p>
          <div className="public-page-body">{children}</div>
        </article>
      </div>

      <footer className="public-page-footer">
        <div className="public-page-shell public-page-footer-inner">
          <span>Operational reporting for Shopify retailers.</span>
          <Link to="/#pricing">
            View pricing <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </div>
      </footer>
    </main>
  );
}
