import type { CSSProperties, ChangeEventHandler, ReactNode } from "react";
import { Icon, type IconSource } from "@shopify/polaris";

export function ShopOpsPage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={`shopops-page ${className}`.trim()}>
      <style>{SHOPOPS_PRESENTATION_CSS}</style>
      <div className="shopops-page__inner">{children}</div>
    </main>
  );
}

export function PageHeader({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon: IconSource;
  action?: ReactNode;
}) {
  return (
    <header className="shopops-page-header">
      <div className="shopops-page-header__identity">
        <span className="shopops-page-header__icon" aria-hidden="true">
          <Icon source={icon} tone="info" />
        </span>
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {action ? (
        <div className="shopops-page-header__action">{action}</div>
      ) : null}
    </header>
  );
}

export function ContentCard({
  children,
  title,
  description,
  action,
  className = "",
  style,
}: {
  children: ReactNode;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={`shopops-content-card ${className}`.trim()}
      style={style}
    >
      {title || description || action ? (
        <div className="shopops-content-card__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? (
              <div className="shopops-helper-text">{description}</div>
            ) : null}
          </div>
          {action ? (
            <div className="shopops-content-card__action">{action}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function SummaryCard({
  label,
  value,
  detail,
  tone = "neutral",
  action,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "critical";
  action?: ReactNode;
}) {
  return (
    <article className="shopops-summary-card" data-tone={tone}>
      <div>
        <div className="shopops-summary-card__label">{label}</div>
        <div className="shopops-summary-card__value">{value}</div>
        {detail ? (
          <div className="shopops-summary-card__detail">{detail}</div>
        ) : null}
      </div>
      {action ? (
        <div className="shopops-summary-card__action">{action}</div>
      ) : null}
    </article>
  );
}

export function UsageSummary({
  label,
  usage,
  limit,
  action,
}: {
  label: string;
  usage: number;
  limit: number | null;
  action: ReactNode;
}) {
  const isOver = limit !== null && usage > limit;
  const capacity =
    limit === null ? null : Math.min(100, Math.max(0, (usage / limit) * 100));
  const singular =
    label === "Reporting locations" ? "reporting location" : "dashboard user";
  const resourceLabel =
    limit === null
      ? usage === 1
        ? singular
        : `${singular}s`
      : limit === 1
        ? singular
        : `${singular}s`;
  const usageText =
    limit === null
      ? `${usage} ${resourceLabel}`
      : `${usage} of ${limit} ${resourceLabel}`;

  return (
    <article
      className="shopops-usage-summary"
      data-capacity={isOver ? "over" : "within"}
    >
      <div>
        <div className="shopops-summary-card__label">{label}</div>
        <div className="shopops-summary-card__value">{usageText}</div>
        <div className="shopops-usage-summary__status">
          {isOver ? "Over plan capacity" : "Within plan capacity"}
        </div>
      </div>
      {capacity !== null ? (
        <div
          aria-label={`${Math.round(capacity)} percent of plan capacity used`}
          className="shopops-usage-summary__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(capacity)}
        >
          <span style={{ width: `${capacity}%` }} />
        </div>
      ) : null}
      <div className="shopops-summary-card__action">{action}</div>
    </article>
  );
}

export function SelectableCard({
  children,
  input,
}: {
  children: ReactNode;
  input: {
    "aria-label": string;
    checked?: boolean;
    defaultChecked?: boolean;
    disabled?: boolean;
    name: string;
    onChange?: ChangeEventHandler<HTMLInputElement>;
    type: "checkbox" | "radio";
    value: string;
  };
}) {
  return (
    <label className="shopops-selectable-card">
      <input {...input} />
      <span className="shopops-selectable-card__content">{children}</span>
      <span className="shopops-selectable-card__indicator" aria-hidden="true">
        ✓
      </span>
    </label>
  );
}

export function FormActions({
  children,
  feedback,
  equal = true,
}: {
  children: ReactNode;
  feedback?: ReactNode;
  equal?: boolean;
}) {
  return (
    <div className="shopops-form-footer">
      <div
        className="shopops-form-actions"
        data-equal={equal ? "true" : "false"}
      >
        {children}
      </div>
      {feedback ? (
        <div className="shopops-form-feedback">{feedback}</div>
      ) : null}
    </div>
  );
}

export function InlineNotice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "critical";
}) {
  return (
    <div
      className="shopops-inline-notice"
      data-tone={tone}
      role={tone === "warning" || tone === "critical" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="shopops-empty-state">
      <strong>{title}</strong>
      {description ? <div>{description}</div> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function ExternalAction({
  children,
  href,
  target = "_top",
}: {
  children: ReactNode;
  href: string;
  target?: string;
}) {
  return (
    <a className="shopops-external-action" href={href} target={target}>
      {children}
    </a>
  );
}

const SHOPOPS_PRESENTATION_CSS = `
  .shopops-page {
    --shopops-accent: var(--p-color-bg-fill-info, #2563eb);
    --shopops-accent-strong: var(--p-color-bg-fill-info-hover, #1d4ed8);
    --shopops-accent-soft: var(--p-color-bg-surface-info, #eff6ff);
    --shopops-teal: #0f766e;
    --shopops-surface: var(--p-color-bg-surface, #ffffff);
    --shopops-surface-subdued: var(--p-color-bg-surface-secondary, #f6f6f7);
    --shopops-border: var(--p-color-border-secondary, #e1e3e5);
    --shopops-muted: var(--p-color-text-secondary, #616161);
    background: var(--shopops-surface-subdued);
    color: var(--p-color-text, #202223);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    min-height: 100vh;
    padding: 28px;
  }
  .shopops-page__inner { margin: 0 auto; max-width: 1280px; }
  .shopops-page-header { align-items: flex-start; display: flex; gap: 20px; justify-content: space-between; margin-bottom: 20px; }
  .shopops-page-header__identity { align-items: flex-start; display: flex; gap: 14px; min-width: 0; }
  .shopops-page-header__icon { align-items: center; background: var(--shopops-accent-soft); border: 1px solid #bfdbfe; border-radius: 12px; display: inline-flex; flex: 0 0 auto; height: 42px; justify-content: center; width: 42px; }
  .shopops-page-header__icon .Polaris-Icon { height: 22px; margin: 0; width: 22px; }
  .shopops-page-header h1 { font-size: 30px; letter-spacing: -0.4px; line-height: 1.15; margin: 0; }
  .shopops-page-header p { color: var(--shopops-muted); font-size: 14px; line-height: 1.5; margin: 6px 0 0; max-width: 720px; }
  .shopops-page-header__action { flex: 0 0 auto; }
  .shopops-section-tabs { display: flex; gap: 8px; margin-bottom: 24px; overflow-x: auto; padding: 2px 2px 4px; scroll-snap-type: x proximity; scrollbar-color: #cbd5e1 transparent; scrollbar-width: thin; white-space: nowrap; }
  .shopops-section-tabs__item { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 10px; color: #374151; flex: 0 0 auto; font-size: 14px; font-weight: 750; min-height: 42px; padding: 10px 16px; scroll-snap-align: nearest; text-decoration: none; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
  .shopops-section-tabs__item:hover { background: #f8fafc; border-color: #93c5fd; }
  .shopops-section-tabs__item[aria-current="page"] { background: var(--shopops-accent-soft); border-color: var(--shopops-accent); box-shadow: inset 0 0 0 1px var(--shopops-accent); color: var(--shopops-accent-strong); }
  .shopops-content-card { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 16px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); margin-bottom: 20px; padding: 20px; }
  .shopops-content-card__header { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; margin-bottom: 16px; }
  .shopops-content-card__header h2 { font-size: 20px; line-height: 1.25; margin: 0; }
  .shopops-helper-text { color: var(--shopops-muted); font-size: 13px; line-height: 1.45; margin-top: 5px; }
  .shopops-summary-grid, .shopops-usage-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 20px; }
  .shopops-dashboard-pair { display: grid; gap: 20px; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); margin-bottom: 20px; }
  .shopops-summary-card, .shopops-usage-summary { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 16px; display: flex; flex-direction: column; gap: 14px; justify-content: space-between; min-height: 136px; padding: 18px; }
  .shopops-summary-card[data-tone="info"] { background: var(--shopops-accent-soft); border-color: #bfdbfe; }
  .shopops-summary-card[data-tone="success"] { background: #ecfdf3; border-color: #abefc6; }
  .shopops-summary-card[data-tone="warning"] { background: #fff8e5; border-color: #f1c96b; }
  .shopops-summary-card[data-tone="critical"] { background: #fef3f2; border-color: #fecdca; }
  .shopops-summary-card__label { color: var(--shopops-muted); font-size: 12px; font-weight: 750; letter-spacing: 0.01em; }
  .shopops-summary-card__value { font-size: 22px; font-variant-numeric: tabular-nums; font-weight: 800; line-height: 1.2; margin-top: 6px; }
  .shopops-summary-card__detail, .shopops-usage-summary__status { color: var(--shopops-muted); font-size: 12px; line-height: 1.4; margin-top: 6px; }
  .shopops-summary-card__action { margin-top: auto; }
  .shopops-summary-card__action > a, .shopops-summary-card__action > button { width: 100% !important; }
  .shopops-usage-summary__track { background: #e5e7eb; border-radius: 999px; height: 6px; overflow: hidden; }
  .shopops-usage-summary__track > span { background: var(--shopops-accent); border-radius: inherit; display: block; height: 100%; transition: width 160ms ease; }
  .shopops-usage-summary[data-capacity="over"] { border-color: #fecdca; }
  .shopops-usage-summary[data-capacity="over"] .shopops-usage-summary__status { color: #b42318; font-weight: 700; }
  .shopops-usage-summary[data-capacity="over"] .shopops-usage-summary__track > span { background: #d92d20; }
  .shopops-selectable-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .shopops-selectable-card { align-items: flex-start; background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 14px; cursor: pointer; display: grid; gap: 12px; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 118px; padding: 16px; transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
  .shopops-selectable-card:hover { border-color: #93c5fd; }
  .shopops-selectable-card:has(input:checked) { background: var(--shopops-accent-soft); border-color: var(--shopops-accent); box-shadow: inset 0 0 0 1px var(--shopops-accent); }
  .shopops-selectable-card:has(input:disabled) { background: #f9fafb; color: var(--shopops-muted); cursor: not-allowed; }
  .shopops-selectable-card input { accent-color: var(--shopops-accent); margin: 3px 0 0; }
  .shopops-selectable-card:focus-within { outline: 3px solid #93c5fd; outline-offset: 2px; }
  .shopops-selectable-card__content { display: grid; gap: 8px; min-width: 0; }
  .shopops-selectable-card__indicator { align-items: center; background: var(--shopops-accent); border-radius: 999px; color: white; display: inline-flex; font-size: 12px; font-weight: 900; height: 22px; justify-content: center; opacity: 0; width: 22px; }
  .shopops-selectable-card:has(input:checked) .shopops-selectable-card__indicator { opacity: 1; }
  .shopops-form-footer { border-top: 1px solid var(--shopops-border); display: grid; gap: 12px; margin-top: 20px; padding-top: 16px; }
  .shopops-form-actions { display: flex; gap: 12px; }
  .shopops-form-actions[data-equal="true"] > * { flex: 1 1 0; min-width: 0; width: 50% !important; }
  .shopops-form-feedback { min-width: 0; }
  .shopops-external-action { align-items: center; background: var(--shopops-accent); border: 1px solid var(--shopops-accent); border-radius: 10px; color: white; display: inline-flex; font-weight: 700; justify-content: center; min-height: 42px; padding: 10px 14px; text-decoration: none; transition: background-color 120ms ease, border-color 120ms ease; }
  .shopops-external-action:hover { background: var(--shopops-accent-strong); border-color: var(--shopops-accent-strong); }
  .shopops-inline-notice { background: var(--shopops-accent-soft); border: 1px solid #bfdbfe; border-radius: 12px; color: #1849a9; font-size: 13px; line-height: 1.5; padding: 12px 14px; }
  .shopops-inline-notice[data-tone="success"] { background: #ecfdf3; border-color: #abefc6; color: #075e45; }
  .shopops-inline-notice[data-tone="warning"] { background: #fff8e5; border-color: #f1c96b; color: #5c3a00; }
  .shopops-inline-notice[data-tone="critical"] { background: #fef3f2; border-color: #fecdca; color: #912018; }
  .shopops-empty-state { align-items: center; color: var(--shopops-muted); display: grid; font-size: 13px; gap: 6px; justify-items: center; line-height: 1.5; padding: 28px 16px; text-align: center; }
  .shopops-empty-state strong { color: var(--p-color-text, #202223); font-size: 14px; }
  .shopops-table-scroll { max-width: 100%; overflow-x: auto; }
  .shopops-page :where(a, button, input, select, summary):focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .shopops-page *, .shopops-page *::before, .shopops-page *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
  }
  @media (max-width: 768px) {
    .shopops-page { padding: 20px; }
    .shopops-page-header { align-items: stretch; flex-direction: column; }
    .shopops-page-header__action > * { width: 100% !important; }
    .shopops-dashboard-pair { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 640px) {
    .shopops-page { padding: 16px; }
    .shopops-page-header h1 { font-size: 27px; }
    .shopops-page-header__icon { height: 38px; width: 38px; }
    .shopops-content-card { padding: 16px; }
    .shopops-content-card__header { flex-direction: column; }
    .shopops-content-card__action, .shopops-content-card__action > * { width: 100% !important; }
    .shopops-summary-grid, .shopops-usage-grid, .shopops-selectable-grid { grid-template-columns: minmax(0, 1fr); }
    .shopops-form-actions { flex-direction: column; }
    .shopops-form-actions[data-equal="true"] > * { width: 100% !important; }
  }
`;
