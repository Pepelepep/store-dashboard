import { formatStoreDateTime } from "../../lib/dashboard/dashboard-metrics";
import type {
  DashboardFilterOption,
  LocationRow,
} from "../../lib/dashboard/dashboard-types";
import { DashboardFilters } from "./DashboardFilters";

export function DashboardHeader({
  locations,
  selectedLocationId,
  selectedLocationName,
  selectedStaff,
  selectedVendor,
  staffOptions,
  vendorOptions,
  startDate,
  endDate,
  preservedSearchParams,
  lastSuccessfulSync,
  selectedDays,
  confidenceStatus,
}: {
  locations: LocationRow[];
  selectedLocationId: string | null;
  selectedLocationName: string | null;
  selectedStaff: string;
  selectedVendor: string;
  staffOptions: DashboardFilterOption[];
  vendorOptions: DashboardFilterOption[];
  startDate: string;
  endDate: string;
  preservedSearchParams: Array<{ name: string; value: string }>;
  lastSuccessfulSync: string | null;
  selectedDays: number;
  confidenceStatus: "Current" | "Preparing" | "Needs review";
}) {
  const confidenceTone =
    confidenceStatus === "Current"
      ? { background: "#ecfdf3", border: "#abefc6", color: "#067647" }
      : confidenceStatus === "Preparing"
        ? { background: "#eff8ff", border: "#b2ddff", color: "#175cd3" }
        : { background: "#fff8e5", border: "#f4c430", color: "#92400e" };

  return (
    <header
      style={{
        marginBottom: 24,
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 20,
        padding: 24,
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <div>
          <h1 style={{ fontSize: 32, lineHeight: 1.15, margin: 0 }}>
            Profit Dashboard
          </h1>
          <p style={{ color: "#616161", margin: "8px 0 0" }}>
            Track Shopify sales, discounts, refunds, COGS, margins, and inventory risk from synced store data.
          </p>
        </div>
        <span
          title="Report confidence is based on sync freshness, empty-state readiness, and recent sync errors."
          style={{
            background: confidenceTone.background,
            border: `1px solid ${confidenceTone.border}`,
            borderRadius: 999,
            color: confidenceTone.color,
            fontSize: 12,
            fontWeight: 800,
            padding: "6px 10px",
            whiteSpace: "nowrap",
          }}
        >
          {confidenceStatus}
        </span>
      </div>
      <DashboardFilters
        locations={locations}
        selectedLocationId={selectedLocationId}
        selectedStaff={selectedStaff}
        selectedVendor={selectedVendor}
        staffOptions={staffOptions}
        vendorOptions={vendorOptions}
        startDate={startDate}
        endDate={endDate}
        preservedSearchParams={preservedSearchParams}
      />

      <div
        style={{
          marginTop: 18,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 999,
            padding: "5px 9px",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          Current location: {selectedLocationName ?? "-"}
        </span>

        <span
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 999,
            padding: "5px 9px",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          Range: {startDate} → {endDate}
        </span>

        <span
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 999,
            padding: "5px 9px",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {selectedDays} {selectedDays > 1 ? "days" : "day"}
        </span>

        <span
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 999,
            padding: "5px 9px",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          Data updated:{" "}
          {lastSuccessfulSync
            ? formatStoreDateTime(lastSuccessfulSync)
            : "unavailable"}
        </span>
      </div>
    </header>
  );
}
