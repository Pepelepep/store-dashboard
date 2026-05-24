import type { ReactNode } from "react";

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
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "1px solid #d1d5db",
        background: "#ffffff",
        borderRadius: 10,
        padding: "7px 10px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        color: "#202223",
        whiteSpace: "nowrap",
      }}
    >
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
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        minHeight: 420,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 14,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{title}</h2>
          {subtitle ? (
            <p
              style={{
                margin: "6px 0 0",
                color: "#616161",
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {subtitle}
            </p>
          ) : null}
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
  );
}
