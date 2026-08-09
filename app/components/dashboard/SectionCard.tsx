import type { ReactNode } from "react";
import { Card } from "../ui/primitives/card";

function escapeCsvValue(value: unknown) {
  const stringValue = String(value ?? "");
  const escaped = stringValue.replace(/"/g, '""');

  return `"${escaped}"`;
}

function downloadCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<unknown>>,
) {
  const csvContent = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function ExportButton({
  label = "CSV",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button className="shopops-chart-export" type="button" onClick={onClick}>
      {label}
    </button>
  );
}

export function SectionCard({
  title,
  subtitle,
  children,
  exportConfig,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  exportConfig?: {
    filename: string;
    headers: string[];
    rows: Array<Array<unknown>>;
  };
}) {
  return (
    <Card asChild>
      <section className="shopops-section-card">
        <div className="shopops-section-card__header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {exportConfig ? (
            <ExportButton
              onClick={() =>
                downloadCsv(
                  exportConfig.filename,
                  exportConfig.headers,
                  exportConfig.rows,
                )
              }
            />
          ) : null}
        </div>
        {children}
      </section>
    </Card>
  );
}
