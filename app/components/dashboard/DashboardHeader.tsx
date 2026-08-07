import {
  formatNumber,
  formatStoreDate,
  formatStoreDateTime,
} from "../../lib/dashboard/dashboard-metrics";
import type {
  DashboardFilterOption,
  LocationRow,
} from "../../lib/dashboard/dashboard-types";
import { ChartVerticalIcon } from "@shopify/polaris-icons";
import { ContentCard, PageHeader } from "../ui/ShopOpsPage";
import { StatusBadge } from "../ui/StatusBadge";
import { DashboardFilters } from "./DashboardFilters";
import { ReportFilterMeta } from "./ReportFilters";

export type DashboardConfidenceStatus =
  | "Up to date"
  | "Syncing"
  | "Needs attention";

const CONFIDENCE_BADGE_VARIANT = {
  "Up to date": "success",
  Syncing: "info",
  "Needs attention": "warning",
} as const;

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
  locationAccessRestricted,
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
  locationAccessRestricted: boolean;
  confidenceStatus: DashboardConfidenceStatus;
}) {
  return (
    <>
      <PageHeader
        action={
          <StatusBadge variant={CONFIDENCE_BADGE_VARIANT[confidenceStatus]}>
            {confidenceStatus}
          </StatusBadge>
        }
        description="Track Shopify sales, discounts, refunds, COGS, margins, and inventory risk from synced store data."
        icon={ChartVerticalIcon}
        title="Overview"
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
          locationAccessRestricted={locationAccessRestricted}
        />

        <ReportFilterMeta
          items={[
            `Current location: ${selectedLocationName ?? "-"}`,
            `Range: ${formatStoreDate(startDate)} → ${formatStoreDate(endDate)}`,
            `${formatNumber(selectedDays)} ${selectedDays > 1 ? "days" : "day"}`,
            `Data updated: ${
              lastSuccessfulSync
                ? formatStoreDateTime(lastSuccessfulSync)
                : "unavailable"
            }`,
          ]}
        />
      </ContentCard>
    </>
  );
}
