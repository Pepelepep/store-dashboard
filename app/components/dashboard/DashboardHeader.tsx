import { formatStoreDateTime } from "../../lib/dashboard/dashboard-metrics";
import type { LocationRow } from "../../lib/dashboard/dashboard-types";
import { DashboardFilters } from "./DashboardFilters";

export function DashboardHeader({
  locations,
  selectedLocationId,
  selectedLocationName,
  startDate,
  endDate,
  preservedSearchParams,
  lastSuccessfulSync,
  selectedDays,
}: {
  locations: LocationRow[];
  selectedLocationId: string | null;
  selectedLocationName: string | null;
  startDate: string;
  endDate: string;
  preservedSearchParams: Array<{ name: string; value: string }>;
  lastSuccessfulSync: string | null;
  selectedDays: number;
}) {
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
      <DashboardFilters
        locations={locations}
        selectedLocationId={selectedLocationId}
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
