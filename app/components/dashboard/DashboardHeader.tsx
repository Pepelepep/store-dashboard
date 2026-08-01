import { formatStoreDateTime } from "../../lib/dashboard/dashboard-metrics";
import type {
  DashboardFilterOption,
  LocationRow,
} from "../../lib/dashboard/dashboard-types";
import { ChartVerticalIcon } from "@shopify/polaris-icons";
import { ContentCard, PageHeader } from "../ui/ShopOpsPage";
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
}) {
  return (
    <>
      <PageHeader
        description="Track Shopify sales, discounts, refunds, COGS, margins, and inventory risk from synced store data."
        icon={ChartVerticalIcon}
        title="Dashboard"
      />
      <ContentCard>
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
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 18,
          }}
        >
          {[
            `Current location: ${selectedLocationName ?? "-"}`,
            `Range: ${startDate} → ${endDate}`,
            `${selectedDays} ${selectedDays > 1 ? "days" : "day"}`,
            `Data updated: ${
              lastSuccessfulSync
                ? formatStoreDateTime(lastSuccessfulSync)
                : "unavailable"
            }`,
          ].map((label) => (
            <span
              key={label}
              style={{
                background: "var(--shopops-surface-subdued)",
                border: "1px solid var(--shopops-border)",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                padding: "5px 9px",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </ContentCard>
    </>
  );
}
