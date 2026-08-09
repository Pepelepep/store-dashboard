import type { CSSProperties, ChangeEventHandler, ReactNode } from "react";
import { Icon, type IconSource } from "@shopify/polaris";
import { Card } from "./primitives/card";

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
    <Card asChild>
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
    </Card>
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
    <Card asChild>
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
    </Card>
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
    --shopops-accent-selected: #d8e8ff;
    --shopops-teal: #0f766e;
    --shopops-teal-soft: #ccfbf1;
    --shopops-surface: var(--p-color-bg-surface, #ffffff);
    --shopops-surface-subdued: var(--p-color-bg-surface-secondary, #f6f6f7);
    --shopops-border: var(--p-color-border-secondary, #e1e3e5);
    --shopops-muted: var(--p-color-text-secondary, #616161);
    --shopops-radius-card: 14px;
    --shopops-radius-control: 9px;
    --shopops-shadow-card: 0 1px 2px rgba(15, 23, 42, 0.045);
    background: var(--shopops-surface-subdued);
    color: var(--p-color-text, #202223);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    min-height: 100vh;
    padding: 28px;
  }
  .shopops-page__inner { margin: 0 auto; max-width: 1280px; }
  .shopops-page-header { align-items: center; display: flex; gap: 20px; justify-content: space-between; margin-bottom: 14px; }
  .shopops-page-header__identity { align-items: center; display: flex; gap: 14px; min-width: 0; }
  .shopops-page-header__copy { min-width: 0; }
  .shopops-page-header__icon { align-items: center; background: var(--shopops-accent-soft); border: 1px solid #bfdbfe; border-radius: 12px; display: inline-flex; flex: 0 0 44px; height: 44px; justify-content: center; width: 44px; }
  .shopops-page-header__icon .Polaris-Icon { height: 23px; margin: 0; width: 23px; }
  .shopops-page-header h1 { font-size: 28px; letter-spacing: -0.45px; line-height: 1.15; margin: 0; }
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
  .shopops-content-card { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: var(--shopops-radius-card); box-shadow: var(--shopops-shadow-card); margin-bottom: 18px; padding: 18px; }
  .shopops-dashboard-filter-card { padding: 14px 16px; }
  .shopops-content-card__header { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; margin-bottom: 16px; }
  .shopops-content-card__header h2 { font-size: 20px; line-height: 1.25; margin: 0; }
  .shopops-helper-text { color: var(--shopops-muted); font-size: 13px; line-height: 1.45; margin-top: 5px; }
  .shopops-summary-grid, .shopops-usage-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 20px; }
  .shopops-dashboard-pair { align-items: stretch; display: grid; gap: 20px; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); margin-bottom: 20px; }
  .shopops-dashboard-loading-chart { margin: 20px 0; }
  .shopops-dashboard-section { margin-bottom: 20px; }
  .shopops-dashboard-notice { margin-bottom: 14px; }
  .shopops-dashboard-secondary-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 20px; }
  .shopops-onboarding { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 12px; margin-bottom: 18px; padding: 12px 16px; }
  .shopops-onboarding summary { cursor: pointer; font-weight: 800; }
  .shopops-onboarding__items { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 12px; }
  .shopops-drilldown-bar { align-items: center; background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 12px; display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; margin-bottom: 16px; padding: 9px 11px; }
  .shopops-drilldown-bar__chips { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
  .shopops-drilldown-bar__label { color: var(--shopops-muted); font-size: 12px; font-weight: 750; }
  .shopops-drilldown-bar__remove { align-items: center; background: transparent; border: 0; border-radius: 999px; color: inherit; cursor: pointer; display: inline-flex; font-size: 13px; font-weight: 900; height: 18px; justify-content: center; line-height: 1; margin-left: 2px; padding: 0; width: 18px; }
  .shopops-drilldown-bar__remove:hover { background: rgba(37, 99, 235, 0.1); }
  .shopops-data-scope-note { color: var(--shopops-muted); font-size: 12px; line-height: 1.45; margin: 0 0 16px; }
  .shopops-support-diagnostics { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 12px; margin-bottom: 20px; padding: 13px 14px; }
  .shopops-support-diagnostics summary { cursor: pointer; font-weight: 800; }
  .shopops-support-diagnostics pre { background: #111827; border-radius: 10px; color: #f9fafb; font-size: 12px; line-height: 1.45; margin: 10px 0 0; overflow-x: auto; padding: 12px; white-space: pre-wrap; }
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
  .shopops-form-stack { display: grid; gap: 16px; }
  .shopops-form-grid { align-items: start; display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .shopops-form-field { display: grid; font-size: 13px; font-weight: 750; gap: 6px; }
  .shopops-form-control { background: var(--shopops-surface); border: 1px solid #b7b9bb; border-radius: var(--shopops-radius-control); box-sizing: border-box; color: var(--p-color-text, #202223); font: inherit; font-size: 14px; min-height: 40px; padding: 8px 10px; width: 100%; }
  .shopops-form-control:hover { border-color: #8c9196; }
  .shopops-form-control:focus { border-color: var(--shopops-accent); box-shadow: 0 0 0 1px var(--shopops-accent); outline: none; }
  .shopops-form-control[data-invalid="true"] { border-color: #d92d20; }
  .shopops-form-control[data-invalid="true"]:focus { box-shadow: 0 0 0 1px #d92d20; }
  .shopops-form-option-details { border-top: 1px solid var(--shopops-border); display: grid; gap: 18px; margin-top: 18px; padding-top: 18px; }
  .shopops-form-field--compact { max-width: 280px; }
  .shopops-form-control-row { align-items: center; display: flex; gap: 8px; }
  .shopops-form-control--short { width: 120px; }
  .shopops-checkbox-field { align-items: flex-start; display: flex; gap: 10px; }
  .shopops-checkbox-field input { accent-color: var(--shopops-accent); margin-top: 3px; }
  .shopops-checkbox-field > span { display: grid; gap: 4px; }
  .shopops-notice-spaced { margin-top: 18px; }
  .shopops-preview { border-top: 1px solid var(--shopops-border); margin-top: 20px; padding-top: 18px; }
  .shopops-preview h3 { font-size: 16px; margin: 0; }
  .shopops-preview-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 12px; }
  .shopops-preview-cell { align-content: start; background: var(--shopops-surface-subdued); border: 1px solid var(--shopops-border); border-radius: 12px; display: grid; gap: 8px; min-height: 88px; padding: 14px; }
  .shopops-preview-value { display: block; font-size: 19px; font-variant-numeric: tabular-nums; font-weight: 800; line-height: 1.25; }
  .shopops-preview-note { margin-top: 10px; }
  .shopops-table-toolbar { align-items: end; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; margin-top: 14px; }
  .shopops-table-search { max-width: 360px; width: 100%; }
  .shopops-table-pagination { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  .shopops-link { color: var(--shopops-accent); font-weight: 700; }
  .shopops-muted { color: var(--shopops-muted); }
  .shopops-report-filter-form { display: grid; gap: 0; }
  .shopops-report-filter-grid { align-items: end; display: grid; gap: 12px; grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .shopops-report-filter-field { display: grid; gap: 6px; min-width: 0; }
  .shopops-report-filter-field[data-wide="true"] { grid-column: 1 / -2; }
  .shopops-report-filter-field > label, .shopops-report-filter-label { color: #303030; font-size: 13px; font-weight: 750; line-height: 1.3; }
  .shopops-report-filter-control { background: var(--shopops-surface); border: 1px solid #b7b9bb; border-radius: var(--shopops-radius-control); box-sizing: border-box; color: var(--p-color-text, #202223); font: inherit; font-size: 14px; min-height: 38px; min-width: 0; padding: 7px 10px; width: 100%; }
  .shopops-report-filter-control:hover { border-color: #8c9196; }
  .shopops-report-filter-control:focus { border-color: var(--shopops-accent); box-shadow: 0 0 0 1px var(--shopops-accent); outline: none; }
  .shopops-report-filter-helper { color: var(--shopops-muted); font-size: 12px; line-height: 1.35; }
  .shopops-report-filter-readonly { align-items: center; background: #f8fafc; border: 1px solid var(--shopops-border); border-radius: 9px; box-sizing: border-box; display: flex; min-height: 40px; padding: 8px 10px; }
  .shopops-report-filter-readonly__value { color: var(--p-color-text, #202223); font-size: 14px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .shopops-report-filter-actions { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(74px, 1fr)); }
  .shopops-report-filter-actions > button, .shopops-report-filter-actions > a { min-height: 40px; white-space: nowrap; }
  .shopops-report-filter-feedback { background: var(--shopops-accent-soft); border: 1px solid #b2ddff; border-radius: 9px; color: #175cd3; font-size: 12px; font-weight: 700; margin-top: 10px; padding: 7px 9px; width: fit-content; }
  .shopops-report-filter-meta { border-top: 1px solid var(--shopops-border); color: var(--shopops-muted); display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 11px; padding-top: 10px; }
  .shopops-report-filter-meta > span { font-size: 12px; font-weight: 650; }
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
  .shopops-kpi-card { --shopops-kpi-color: #64748b; --shopops-kpi-soft: #f8fafc; background: linear-gradient(180deg, var(--shopops-kpi-soft) 0, var(--shopops-surface) 36%); border: 1px solid var(--shopops-border); border-radius: var(--shopops-radius-card); box-shadow: var(--shopops-shadow-card); display: flex; flex-direction: column; min-height: 142px; overflow: hidden; padding: 15px; position: relative; transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease; }
  .shopops-kpi-card::before { background: var(--shopops-kpi-color); content: ""; height: 3px; inset: 0 0 auto; position: absolute; }
  .shopops-kpi-card[data-category="commercial"] { --shopops-kpi-color: #2563eb; --shopops-kpi-soft: #eff6ff; }
  .shopops-kpi-card[data-category="activity"] { --shopops-kpi-color: #7c3aed; --shopops-kpi-soft: #f5f3ff; }
  .shopops-kpi-card[data-category="negative"] { --shopops-kpi-color: #dc2626; --shopops-kpi-soft: #fef2f2; }
  .shopops-kpi-card[data-category="cost"] { --shopops-kpi-color: #d97706; --shopops-kpi-soft: #fffbeb; }
  .shopops-kpi-card[data-category="profit"] { --shopops-kpi-color: #059669; --shopops-kpi-soft: #ecfdf5; }
  .shopops-kpi-card:hover { border-color: #c4c9cf; box-shadow: 0 3px 10px rgba(15, 23, 42, 0.07); transform: translateY(-1px); }
  .shopops-kpi-card__heading { align-items: flex-start; display: flex; gap: 8px; justify-content: space-between; }
  .shopops-kpi-label { color: var(--shopops-muted); font-size: 11px; font-weight: 800; letter-spacing: 0.045em; line-height: 1.35; margin-bottom: 8px; text-transform: uppercase; }
  .shopops-kpi-info { align-items: center; background: color-mix(in srgb, var(--shopops-kpi-color) 9%, white); border: 1px solid color-mix(in srgb, var(--shopops-kpi-color) 28%, white); border-radius: 999px; color: var(--shopops-kpi-color); cursor: help; display: inline-flex; flex: 0 0 17px; font-size: 11px; font-style: normal; font-weight: 800; height: 17px; justify-content: center; line-height: 1; }
  .shopops-kpi-value { color: var(--p-color-text, #202223); font-size: clamp(21px, 2vw, 28px); font-variant-numeric: tabular-nums; font-weight: 800; letter-spacing: -0.025em; line-height: 1.12; margin-bottom: 7px; overflow-wrap: anywhere; }
  .shopops-kpi-comparison { align-items: center; display: flex; flex-wrap: wrap; font-size: 11px; gap: 4px 6px; margin: 0 0 7px; }
  .shopops-kpi-comparison strong { border-radius: 999px; font-variant-numeric: tabular-nums; font-weight: 850; padding: 3px 7px; }
  .shopops-kpi-comparison-context { align-items: center; color: var(--shopops-muted); display: flex; font-size: 11px; gap: 5px; justify-content: flex-end; margin: 0 2px 7px; }
  .shopops-kpi-comparison-context strong { color: #475569; font-weight: 750; }
  .shopops-kpi-comparison[data-tone="positive"] strong { background: #dcfce7; color: #067647; }
  .shopops-kpi-comparison[data-tone="negative"] strong { background: #fee2e2; color: #b42318; }
  .shopops-kpi-comparison[data-tone="neutral"] strong { background: #e5e7eb; color: #4b5563; }
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
  .shopops-data-table-scroll { border: 1px solid var(--shopops-border); border-radius: 11px; max-height: 320px; overflow: auto; }
  .shopops-data-table-scroll--spaced { margin-top: 12px; }
  .shopops-data-table { border-collapse: collapse; font-size: 13px; width: 100%; }
  .shopops-data-table th { background: #f8fafc; border-bottom: 1px solid var(--shopops-border); color: var(--shopops-muted); font-size: 11px; font-weight: 800; letter-spacing: 0.035em; padding: 10px 12px; position: sticky; text-align: left; text-transform: uppercase; top: 0; white-space: nowrap; z-index: 1; }
  .shopops-data-table td { border-bottom: 1px solid #edf0f2; font-variant-numeric: tabular-nums; padding: 10px 12px; text-align: left; vertical-align: top; }
  .shopops-data-table th[data-align="right"], .shopops-data-table td[data-align="right"] { text-align: right; }
  .shopops-data-table tbody tr:last-child td { border-bottom: 0; }
  .shopops-data-table tbody tr[data-selectable="true"] { cursor: pointer; transition: background-color 100ms ease; }
  .shopops-data-table tbody tr[data-selectable="true"]:hover { background: #f8fafc; }
  .shopops-data-table tbody tr[data-selected="true"] { background: var(--shopops-accent-soft); }
  .shopops-data-table tbody tr[data-selectable="true"]:focus-visible { outline: 3px solid #93c5fd; outline-offset: -3px; }
  .shopops-data-table__empty { color: var(--shopops-muted); padding: 16px !important; text-align: left !important; }
  .shopops-data-table__sort { align-items: center; background: transparent; border: 0; color: inherit; cursor: pointer; display: inline-flex; font: inherit; font-weight: inherit; gap: 4px; padding: 0; text-transform: inherit; }
  .shopops-data-table__sort-indicator { color: #94a3b8; font-size: 12px; font-weight: 900; line-height: 1; }
  .shopops-data-table__sort-indicator[data-active="true"] { color: var(--shopops-accent); }
  .shopops-data-table__primary { display: grid; gap: 4px; }
  .shopops-location-comparison-table th:first-child, .shopops-location-comparison-table td:first-child { background: var(--shopops-surface); box-shadow: 1px 0 0 var(--shopops-border); left: 0; min-width: 190px; position: sticky; width: 190px; z-index: 1; }
  .shopops-location-comparison-table th:first-child { background: #f9fafb; z-index: 2; }
  .shopops-location-comparison-table .shopops-data-table__primary > strong { font-size: 13px; line-height: 1.3; }
  .shopops-location-benchmark { align-items: flex-start; color: var(--shopops-muted); display: grid; font-size: 10px; font-weight: 650; gap: 4px; line-height: 1.25; justify-items: start; }
  .shopops-location-benchmark span, .shopops-location-benchmark strong { white-space: nowrap; }
  .shopops-location-benchmark strong { border-radius: 999px; font-size: 10px; padding: 3px 7px; }
  .shopops-location-benchmark strong[data-tone="above"] { background: #dcfce7; color: #067647; }
  .shopops-location-benchmark strong[data-tone="below"] { background: #fff7ed; color: #b54708; }
  .shopops-location-benchmark strong[data-tone="neutral"] { background: #e5e7eb; color: #4b5563; }
  .shopops-location-sales-value { display: grid; gap: 6px; justify-items: end; min-width: 96px; }
  .shopops-location-sales-value > strong { font-variant-numeric: tabular-nums; }
  .shopops-location-sales-value > span { background: #dbeafe; border-radius: 999px; display: block; height: 4px; overflow: hidden; width: 72px; }
  .shopops-location-sales-value > span > i { background: linear-gradient(90deg, #2563eb, #38bdf8); border-radius: inherit; display: block; height: 100%; }
  .shopops-table-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
  .shopops-section-card { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: var(--shopops-radius-card); box-shadow: var(--shopops-shadow-card); padding: 18px; }
  .shopops-section-card__header { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; margin-bottom: 14px; }
  .shopops-section-card__header h2 { font-size: 18px; font-weight: 800; letter-spacing: -0.015em; line-height: 1.25; margin: 0; }
  .shopops-section-card__header p { color: var(--shopops-muted); font-size: 13px; line-height: 1.4; margin: 4px 0 0; }
  .shopops-chart-export { background: var(--shopops-surface); border: 1px solid var(--shopops-border); border-radius: 8px; color: var(--p-color-text, #202223); cursor: pointer; font-size: 12px; font-weight: 750; padding: 6px 9px; white-space: nowrap; }
  .shopops-chart-export:hover { background: #f1f5f9; border-color: #94a3b8; }
  .shopops-section-intro { color: var(--shopops-muted); font-size: 13px; line-height: 1.45; margin: 0 0 12px; }
  .shopops-subtle-notice { background: #f8fafc; border: 1px solid var(--shopops-border); border-radius: 11px; color: var(--shopops-muted); font-size: 13px; line-height: 1.45; margin-bottom: 12px; padding: 11px 12px; }
  .shopops-table-empty-inline { border: 1px solid var(--shopops-border); border-radius: 11px; color: var(--shopops-muted); font-size: 13px; padding: 14px; }
  .shopops-adjustment-row { align-items: baseline; border-bottom: 1px solid #edf0f2; display: flex; font-size: 13px; gap: 12px; justify-content: space-between; padding: 8px 0; }
  .shopops-adjustment-row:last-of-type { border-bottom: 0; }
  .shopops-adjustment-row > span { color: var(--shopops-muted); }
  .shopops-adjustment-row > strong { font-variant-numeric: tabular-nums; text-align: right; }
  .shopops-adjustment-row[data-tone="commercial"] > strong { color: #1d4ed8; }
  .shopops-adjustment-row[data-tone="negative"] > strong { color: #b42318; }
  .shopops-adjustment-warning { color: #7a4b00; font-size: 12px; margin-top: 8px; }
  .shopops-chart-tooltip { background: rgba(17, 24, 39, 0.96); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 10px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18); color: white; font-size: 12px; line-height: 1.5; padding: 9px 11px; }
  .shopops-chart-empty { align-items: center; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 11px; color: var(--shopops-muted); display: flex; min-height: 180px; padding: 16px; }
  .shopops-location-trend-card { margin-bottom: 20px; }
  .shopops-location-chart-header { align-items: flex-start; display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; margin-bottom: 14px; }
  .shopops-location-chart-header h2 { font-size: 18px; font-weight: 800; letter-spacing: -0.015em; margin: 0; }
  .shopops-location-chart-header p { color: var(--shopops-muted); font-size: 13px; line-height: 1.45; margin: 4px 0 0; }
  .shopops-location-chart-grouping { align-items: center; color: var(--shopops-muted); display: flex; font-size: 12px; font-weight: 800; gap: 8px; max-width: 100%; white-space: nowrap; }
  .shopops-vendor-bars { display: grid; gap: 6px; overflow-x: auto; }
  .shopops-vendor-row { align-items: center; border: 1px solid transparent; border-radius: 8px; display: grid; gap: 8px; grid-template-columns: minmax(160px, 1fr) minmax(100px, 2fr) 150px; min-height: 38px; min-width: 500px; padding: 6px 8px; }
  .shopops-vendor-row[data-selectable="true"] { cursor: pointer; }
  .shopops-vendor-row[data-selectable="true"][data-hovered="true"] { background: #f8fafc; }
  .shopops-vendor-row[data-selected="true"] { background: var(--shopops-accent-soft); border-color: #93c5fd; }
  .shopops-vendor-row__label { color: var(--p-color-text, #202223); font-size: 13px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .shopops-vendor-row__label small { color: #1d4ed8; display: block; font-size: 10px; }
  .shopops-vendor-row__track { align-self: center; background: #eef2f7; border-radius: 999px; height: 10px; overflow: hidden; }
  .shopops-vendor-row__fill { background: linear-gradient(90deg, #1d4ed8, #2563eb); border-radius: 999px; box-shadow: 0 0 0 1px rgba(29, 78, 216, 0.08); height: 100%; }
  .shopops-vendor-row__value { align-items: center; display: flex; font-size: 12px; font-variant-numeric: tabular-nums; gap: 7px; justify-content: flex-end; text-align: right; white-space: nowrap; }
  .shopops-vendor-row__value > strong { color: #334155; font-weight: 800; }
  .shopops-vendor-row__percent { background: #dbeafe; border: 1px solid #bfdbfe; border-radius: 999px; color: #1d4ed8; font-size: 11px; font-weight: 850; padding: 2px 6px; }
  .shopops-breakdown-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 20px; }
  .shopops-chart-interactive:focus-visible, .shopops-chart-export:focus-visible, .shopops-chart-point:focus-visible, .shopops-mirror-sales-chart:focus-visible, .shopops-recharts .recharts-wrapper:focus-visible { outline: 3px solid #93c5fd !important; outline-offset: 2px; }
  .shopops-chart-scroll { scrollbar-color: #cbd5e1 transparent; scrollbar-width: thin; }
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
    .shopops-dashboard-filter-card { padding: 12px; }
    .shopops-section-card { padding: 16px; }
    .shopops-chart-tooltip { left: 70px !important; right: auto !important; }
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
