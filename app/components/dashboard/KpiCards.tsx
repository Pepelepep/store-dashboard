import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import type { DashboardLoaderData } from "../../lib/dashboard/dashboard-types";

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

function KpiCard({
  title,
  value,
  subtitle,
  exportValue,
  selectedLocationName,
  startDate,
  endDate,
}: {
  title: string;
  value: string;
  subtitle: string;
  exportValue: string | number;
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
}) {
  return (
    <section
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
        minHeight: 132,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <div style={{ color: "#5f6368", fontSize: 14, fontWeight: 700 }}>
          {title}
        </div>
        <ExportButton
          onClick={() =>
            downloadCsv(
              `${title.toLowerCase().replaceAll(" ", "-")}.csv`,
              ["Metric", "Value", "Location", "Start date", "End date"],
              [
                [
                  title,
                  exportValue,
                  selectedLocationName ?? "-",
                  startDate,
                  endDate,
                ],
              ],
            )
          }
        />
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
        {value}
      </div>
      <div style={{ color: "#707070", fontSize: 13, lineHeight: 1.35 }}>
        {subtitle}
      </div>
    </section>
  );
}

export function KpiCards({
  kpis,
  selectedLocationName,
  startDate,
  endDate,
}: {
  kpis: DashboardLoaderData["kpis"];
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 16,
        marginBottom: 22,
      }}
    >
      <KpiCard
        title="Revenue"
        value={formatCurrency(kpis.revenue)}
        subtitle="Synced retail sales"
        exportValue={kpis.revenue}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
      <KpiCard
        title="Orders"
        value={formatNumber(kpis.ordersCount)}
        subtitle="Unique orders for this location"
        exportValue={kpis.ordersCount}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
      <KpiCard
        title="Units sold"
        value={formatNumber(kpis.unitsSold)}
        subtitle="Quantity sold from order lines"
        exportValue={kpis.unitsSold}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
      <KpiCard
        title="COGS"
        value={formatCurrency(kpis.cogs)}
        subtitle="Product costs"
        exportValue={kpis.cogs}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
      <KpiCard
        title="Gross profit"
        value={formatCurrency(kpis.grossProfit)}
        subtitle="Revenue minus COGS"
        exportValue={kpis.grossProfit}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
      <KpiCard
        title="Gross margin"
        value={formatPercent(kpis.grossMarginPct)}
        subtitle="Gross profit / revenue"
        exportValue={kpis.grossMarginPct ?? ""}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
      <KpiCard
        title="Expenses"
        value={
          kpis.expenses === null ? "Not configured" : formatCurrency(kpis.expenses)
        }
        subtitle="Fixed expenses from DB"
        exportValue={kpis.expenses ?? "Not configured"}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
      <KpiCard
        title="Net profit"
        value={
          kpis.netProfit === null ? "Not available" : formatCurrency(kpis.netProfit)
        }
        subtitle="Gross profit minus expenses"
        exportValue={kpis.netProfit ?? "Not available"}
        selectedLocationName={selectedLocationName}
        startDate={startDate}
        endDate={endDate}
      />
    </section>
  );
}
