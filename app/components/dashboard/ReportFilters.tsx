import type { FormEventHandler, ReactNode } from "react";
import { Form } from "react-router";

type PreservedSearchParam = {
  name: string;
  value: string;
};

export function ReportFilterPanel({
  actions,
  changed = false,
  changedMessage = "Filters changed. Click Apply to update.",
  children,
  hiddenFields,
  id,
  onSubmit,
  preservedSearchParams,
}: {
  actions: ReactNode;
  changed?: boolean;
  changedMessage?: string;
  children: ReactNode;
  hiddenFields?: ReactNode;
  id?: string;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  preservedSearchParams: PreservedSearchParam[];
}) {
  return (
    <Form
      className="shopops-report-filter-form"
      id={id}
      method="get"
      onSubmit={onSubmit}
    >
      {preservedSearchParams.map(({ name, value }, index) => (
        <input
          key={`${name}-${index}`}
          name={name}
          type="hidden"
          value={value}
        />
      ))}
      {hiddenFields}

      <div className="shopops-report-filter-grid">
        {children}
        <div className="shopops-report-filter-actions">{actions}</div>
      </div>

      {changed ? (
        <div className="shopops-report-filter-feedback" role="status">
          {changedMessage}
        </div>
      ) : null}
    </Form>
  );
}

export function ReportFilterField({
  children,
  helper,
  htmlFor,
  label,
  wide = false,
}: {
  children: ReactNode;
  helper?: ReactNode;
  htmlFor?: string;
  label: string;
  wide?: boolean;
}) {
  return (
    <div
      aria-label={htmlFor ? undefined : label}
      className="shopops-report-filter-field"
      data-wide={wide ? "true" : "false"}
      role={htmlFor ? undefined : "group"}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor}>{label}</label>
      ) : (
        <div className="shopops-report-filter-label">{label}</div>
      )}
      {children}
      {helper ? (
        <div className="shopops-report-filter-helper">{helper}</div>
      ) : null}
    </div>
  );
}

export function ReadOnlyReportLocation({
  helper,
  value,
}: {
  helper?: string;
  value: string;
}) {
  return (
    <div className="shopops-report-filter-readonly" title={helper}>
      <span className="shopops-report-filter-readonly__value">{value}</span>
    </div>
  );
}

export function ReportFilterMeta({ items }: { items: string[] }) {
  return (
    <div className="shopops-report-filter-meta">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}
