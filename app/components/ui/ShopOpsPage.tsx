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
        <div className="shopops-page-header__copy">
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
  singularLabel,
}: {
  label: string;
  usage: number;
  limit: number | null;
  action: ReactNode;
  singularLabel?: string;
}) {
  const isOver = limit !== null && usage > limit;
  const capacity =
    limit === null ? null : Math.min(100, Math.max(0, (usage / limit) * 100));
  const singular =
    singularLabel ??
    (label === "Reporting locations" ? "reporting location" : "ShopOps user");
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

export function FilterPills<T extends string>({
  ariaLabel,
  items,
  onChange,
  value,
}: {
  ariaLabel: string;
  items: Array<{ label: ReactNode; value: T }>;
  onChange: (value: T) => void;
  value: T;
}) {
  return (
    <div aria-label={ariaLabel} className="shopops-filter-pills" role="toolbar">
      {items.map((item) => (
        <button
          aria-pressed={value === item.value}
          key={item.value}
          onClick={() => onChange(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
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

export function CompactEmptyDataNotice({
  title,
  guidance,
  action,
}: {
  title: string;
  guidance: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="shopops-compact-empty-data" role="status">
      <div className="shopops-compact-empty-data__copy">
        <strong>{title}</strong>
        <span>{guidance}</span>
      </div>
      {action ? (
        <div className="shopops-compact-empty-data__action">{action}</div>
      ) : null}
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
    --shopops-accent-selected: #dbeafe;
    --shopops-teal: #0f766e;
    --shopops-teal-soft: #ccfbf1;
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
  .shopops-page-header { align-items: flex-start; display: flex; gap: 20px; justify-content: space-between; margin-bottom: 16px; }
  .shopops-page-header__identity { align-items: center; display: flex; gap: 14px; min-width: 0; }
  .shopops-page-header__copy { min-width: 0; }
  .shopops-page-header__icon { align-items: center; background: var(--shopops-accent-soft); border: 1px solid #bfdbfe; border-radius: 11px; display: inline-flex; flex: 0 0 40px; height: 40px; justify-content: center; width: 40px; }
  .shopops-page-header__icon .Polaris-Icon { height: 21px; margin: 0; width: 21px; }
  .shopops-page-header h1 { font-size: 30px; letter-spacing: -0.4px; line-height: 1.15; margin: 0; }
  .shopops-page-header p { color: var(--shopops-muted); font-size: 14px; line-height: 1.45; margin: 4px 0 0; max-width: 720px; }
  .shopops-page-header__action { flex: 0 0 auto; }
  .shopops-section-tabs { display: flex; gap: 8px; margin-bottom: 18px; overflow-x: auto; padding: 2px 2px 4px; scroll-snap-type: x proximity; scrollbar-color: #cbd5e1 transparent; scrollbar-width: thin; white-space: nowrap; }
  .shopops-section-tabs__item { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 10px; color: #374151; flex: 0 0 auto; font-size: 14px; font-weight: 750; min-height: 42px; padding: 10px 16px; scroll-snap-align: nearest; text-decoration: none; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
  .shopops-section-tabs__item:hover { background: #f1f5f9; border-color: #60a5fa; color: #172554; }
  .shopops-section-tabs__item:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
  .shopops-section-tabs__item[aria-current="page"] { background: var(--shopops-accent-selected); border-color: var(--shopops-accent); box-shadow: inset 0 0 0 1px var(--shopops-accent); color: #163b7a; }
  .shopops-filter-pills { display: flex; gap: 6px; overflow-x: auto; padding: 2px; white-space: nowrap; }
  .shopops-filter-pills button { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 8px; color: #374151; cursor: pointer; flex: 0 0 auto; font-weight: 650; padding: 8px 11px; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
  .shopops-filter-pills button:hover { background: #f1f5f9; border-color: #60a5fa; color: #172554; }
  .shopops-filter-pills button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
  .shopops-filter-pills button[aria-pressed="true"] { background: var(--shopops-accent-selected); border-color: var(--shopops-accent); box-shadow: inset 0 0 0 1px var(--shopops-accent); color: #163b7a; font-weight: 750; }
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
  .shopops-report-filter-form { display: grid; gap: 0; }
  .shopops-report-filter-grid { align-items: end; display: grid; gap: 12px; grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .shopops-report-filter-field { display: grid; gap: 6px; min-width: 0; }
  .shopops-report-filter-field[data-wide="true"] { grid-column: 1 / -2; }
  .shopops-report-filter-field > label, .shopops-report-filter-label { color: #303030; font-size: 13px; font-weight: 750; line-height: 1.3; }
  .shopops-report-filter-control { background: var(--shopops-surface); border: 1px solid #b7b9bb; border-radius: 9px; box-sizing: border-box; color: var(--p-color-text, #202223); font: inherit; font-size: 14px; min-height: 40px; min-width: 0; padding: 8px 10px; width: 100%; }
  .shopops-report-filter-helper { color: var(--shopops-muted); font-size: 12px; line-height: 1.35; }
  .shopops-report-filter-readonly { align-items: center; background: #f8fafc; border: 1px solid var(--shopops-border); border-radius: 9px; box-sizing: border-box; display: flex; min-height: 40px; padding: 8px 10px; }
  .shopops-report-filter-readonly__value { color: var(--p-color-text, #202223); font-size: 14px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .shopops-report-filter-actions { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(74px, 1fr)); }
  .shopops-report-filter-actions > button, .shopops-report-filter-actions > a { min-height: 40px; white-space: nowrap; }
  .shopops-report-filter-feedback { background: var(--shopops-accent-soft); border: 1px solid #b2ddff; border-radius: 9px; color: #175cd3; font-size: 12px; font-weight: 700; margin-top: 10px; padding: 7px 9px; width: fit-content; }
  .shopops-report-filter-meta { border-top: 1px solid var(--shopops-border); display: flex; flex-wrap: wrap; gap: 7px; margin-top: 14px; padding-top: 12px; }
  .shopops-report-filter-meta > span { background: var(--shopops-surface-subdued); border: 1px solid var(--shopops-border); border-radius: 999px; font-size: 12px; font-weight: 750; padding: 4px 8px; }
  .shopops-report-filter-options { display: flex; flex-wrap: wrap; gap: 8px; min-height: 40px; }
  .shopops-report-filter-option { align-items: center; background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 999px; color: var(--p-color-text, #202223); cursor: pointer; display: inline-flex; font: inherit; font-size: 13px; gap: 7px; min-height: 36px; padding: 6px 10px; }
  .shopops-report-filter-option:hover { background: #f1f5f9; border-color: #60a5fa; }
  .shopops-report-filter-option[data-selected="true"] { background: var(--shopops-accent-selected); border-color: var(--shopops-accent); color: #163b7a; font-weight: 750; }
  .shopops-report-filter-option input { accent-color: var(--shopops-accent); margin: 0; }
  .shopops-external-action { align-items: center; background: var(--shopops-accent); border: 1px solid var(--shopops-accent); border-radius: 10px; color: white; display: inline-flex; font-weight: 700; justify-content: center; min-height: 42px; padding: 10px 14px; text-decoration: none; transition: background-color 120ms ease, border-color 120ms ease; }
  .shopops-external-action:hover { background: var(--shopops-accent-strong); border-color: var(--shopops-accent-strong); }
  .shopops-inline-notice { background: var(--shopops-accent-soft); border: 1px solid #bfdbfe; border-radius: 12px; color: #1849a9; font-size: 13px; line-height: 1.5; padding: 12px 14px; }
  .shopops-inline-notice[data-tone="success"] { background: #ecfdf3; border-color: #abefc6; color: #075e45; }
  .shopops-inline-notice[data-tone="warning"] { background: #fff8e5; border-color: #f1c96b; color: #5c3a00; }
  .shopops-inline-notice[data-tone="critical"] { background: #fef3f2; border-color: #fecdca; color: #912018; }
  .shopops-empty-state { align-items: center; color: var(--shopops-muted); display: grid; font-size: 13px; gap: 6px; justify-items: center; line-height: 1.5; padding: 28px 16px; text-align: center; }
  .shopops-empty-state strong { color: var(--p-color-text, #202223); font-size: 14px; }
  .shopops-kpi-grid { display: grid; gap: 14px; grid-template-columns: repeat(5, minmax(0, 1fr)); margin-bottom: 14px; }
  .shopops-kpi-grid[data-item-count="8"] { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .shopops-kpi-grid[data-item-count="9"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .shopops-kpi-grid[data-item-count="11"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .shopops-kpi-grid[data-item-count="11"] > .shopops-kpi-card { min-width: 0; }
  .shopops-kpi-card { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 16px; border-top: 3px solid #cbd5e1; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05); display: flex; flex-direction: column; min-height: 128px; padding: 16px; }
  .shopops-kpi-card[data-category="commercial"] { border-top-color: var(--shopops-accent); }
  .shopops-kpi-card[data-category="activity"] { border-top-color: var(--shopops-teal); }
  .shopops-kpi-label { color: var(--shopops-muted); font-size: 14px; font-weight: 750; line-height: 1.3; margin-bottom: 7px; }
  .shopops-kpi-value { color: var(--p-color-text, #202223); font-size: clamp(20px, 2vw, 27px); font-variant-numeric: tabular-nums; font-weight: 800; line-height: 1.15; margin-bottom: 6px; overflow-wrap: anywhere; }
  .shopops-kpi-detail { color: var(--shopops-muted); font-size: 12px; line-height: 1.35; }
  .shopops-kpi-notice { border: 1px solid var(--shopops-border); border-radius: 9px; padding: 6px 7px; }
  .shopops-kpi-notice[data-tone="info"] { background: var(--shopops-accent-soft); border-color: #bfdbfe; color: #1e3a5f; }
  .shopops-kpi-notice[data-tone="neutral"] { background: #f8fafc; border-color: #d9dee5; color: #4b5563; }
  .shopops-kpi-notice[data-tone="warning"] { background: #fff8e5; border-color: #e5c07b; color: #5c4813; }
  .shopops-kpi-notice__action { color: #1d4ed8; display: inline-block; margin-top: 3px; }
  .shopops-metric-definitions { color: var(--shopops-muted); font-size: 13px; line-height: 1.5; margin: -2px 0 20px; }
  .shopops-metric-definitions summary { cursor: pointer; font-weight: 800; }
  .shopops-metric-definitions > div { margin-top: 8px; }
  .shopops-compact-empty-data { align-items: center; background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-left: 3px solid var(--shopops-teal); border-radius: 12px; display: flex; gap: 14px; justify-content: space-between; margin-bottom: 16px; padding: 12px 14px; }
  .shopops-compact-empty-data__copy { align-items: baseline; display: flex; flex-wrap: wrap; gap: 5px 8px; min-width: 0; }
  .shopops-compact-empty-data__copy strong { font-size: 13px; }
  .shopops-compact-empty-data__copy span { color: var(--shopops-muted); font-size: 13px; line-height: 1.4; }
  .shopops-compact-empty-data__action { flex: 0 0 auto; }
  .shopops-table-scroll { max-width: 100%; overflow-x: auto; }
  .shopops-page :where(a, button, input, select, summary):focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .shopops-page *, .shopops-page *::before, .shopops-page *::after { scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
  }
  @media (max-width: 1100px) {
    .shopops-report-filter-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .shopops-report-filter-field[data-wide="true"] { grid-column: auto; }
  }
  @media (min-width: 1024px) {
    .shopops-kpi-grid[data-item-count="11"] { grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .shopops-kpi-grid[data-item-count="11"] > .shopops-kpi-card { grid-column: span 2; }
    .shopops-kpi-grid[data-item-count="11"] > .shopops-kpi-card:nth-child(7) { grid-column: 2 / span 2; }
  }
  @media (max-width: 1023px) {
    .shopops-kpi-grid[data-item-count="11"] > .shopops-kpi-card { grid-column: auto; }
  }
  @media (max-width: 900px) {
    .shopops-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .shopops-kpi-grid[data-item-count="9"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .shopops-kpi-grid[data-item-count="11"] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  @media (max-width: 767px) {
    .shopops-kpi-grid[data-item-count="11"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 768px) {
    .shopops-page { padding: 20px; }
    .shopops-page-header { align-items: stretch; flex-direction: column; }
    .shopops-page-header__action > * { width: 100% !important; }
    .shopops-dashboard-pair { grid-template-columns: minmax(0, 1fr); }
    .shopops-report-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .shopops-report-filter-field[data-wide="true"], .shopops-report-filter-actions { grid-column: 1 / -1; }
  }
  @media (max-width: 640px) {
    .shopops-page { padding: 16px; }
    .shopops-page-header h1 { font-size: 27px; }
    .shopops-page-header__icon { flex-basis: 40px; height: 40px; width: 40px; }
    .shopops-content-card { padding: 16px; }
    .shopops-content-card__header { flex-direction: column; }
    .shopops-content-card__action, .shopops-content-card__action > * { width: 100% !important; }
    .shopops-summary-grid, .shopops-usage-grid, .shopops-selectable-grid { grid-template-columns: minmax(0, 1fr); }
    .shopops-form-actions { flex-direction: column; }
    .shopops-form-actions[data-equal="true"] > * { width: 100% !important; }
    .shopops-report-filter-grid { grid-template-columns: minmax(0, 1fr); }
    .shopops-report-filter-field[data-wide="true"], .shopops-report-filter-actions { grid-column: auto; }
    .shopops-report-filter-meta { align-items: flex-start; flex-direction: column; }
    .shopops-kpi-grid, .shopops-kpi-grid[data-item-count] { grid-template-columns: minmax(0, 1fr); }
    .shopops-compact-empty-data { align-items: flex-start; flex-direction: column; }
    .shopops-compact-empty-data__action, .shopops-compact-empty-data__action > * { width: 100% !important; }
  }
`;
