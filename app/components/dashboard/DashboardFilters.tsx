import { useNavigation } from "react-router";
import { useEffect, useState } from "react";

import type {
  DashboardFilterOption,
  LocationRow,
} from "../../lib/dashboard/dashboard-types";
import { AppButton } from "../ui/AppButton";
import {
  ReadOnlyReportLocation,
  ReportFilterField,
  ReportFilterPanel,
} from "./ReportFilters";

export function DashboardFilters({
  locations,
  selectedLocationId,
  selectedStaff,
  selectedVendor,
  staffOptions,
  vendorOptions,
  startDate,
  endDate,
  preservedSearchParams,
  locationAccessRestricted,
}: {
  locations: LocationRow[];
  selectedLocationId: string | null;
  selectedStaff: string;
  selectedVendor: string;
  staffOptions: DashboardFilterOption[];
  vendorOptions: DashboardFilterOption[];
  startDate: string;
  endDate: string;
  preservedSearchParams: Array<{ name: string; value: string }>;
  locationAccessRestricted: boolean;
}) {
  const navigation = useNavigation();
  const canSwitchLocation = locations.length > 1;
  const [hasUnsavedFilters, setHasUnsavedFilters] = useState(false);
  const [startDateValue, setStartDateValue] = useState(startDate);
  const [endDateValue, setEndDateValue] = useState(endDate);
  const isApplying =
    navigation.state !== "idle" && navigation.formMethod === "GET";
  const isApplyingToday =
    isApplying && navigation.formData?.get("preset") === "today";
  const selectedLocation =
    locations.find(
      (location) => location.shopify_location_id === selectedLocationId,
    ) ??
    locations[0] ??
    null;

  useEffect(() => {
    setStartDateValue(startDate);
    setEndDateValue(endDate);
    setHasUnsavedFilters(false);
  }, [startDate, endDate, selectedLocationId, selectedStaff, selectedVendor]);

  function getTodayDateValue() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function handleSubmit() {
    setHasUnsavedFilters(false);
  }

  function handleTodayClick() {
    const today = getTodayDateValue();

    setStartDateValue(today);
    setEndDateValue(today);
    setHasUnsavedFilters(false);
  }

  return (
    <ReportFilterPanel
      actions={
        <>
          <AppButton
            type="submit"
            name="preset"
            value="today"
            variant="secondary"
            onClick={handleTodayClick}
            disabled={isApplying}
          >
            {isApplyingToday ? "Applying today..." : "Today"}
          </AppButton>

          <AppButton
            type="submit"
            variant="primary"
            onClick={() => setHasUnsavedFilters(false)}
            disabled={isApplying}
          >
            {isApplying && !isApplyingToday ? "Applying..." : "Apply"}
          </AppButton>
        </>
      }
      changed={hasUnsavedFilters}
      onSubmit={handleSubmit}
      preservedSearchParams={preservedSearchParams}
    >
      <ReportFilterField
        htmlFor={canSwitchLocation ? "locationId" : undefined}
        label="Location"
      >
        {canSwitchLocation ? (
          <select
            className="shopops-report-filter-control"
            id="locationId"
            name="locationId"
            defaultValue={selectedLocationId ?? ""}
            onChange={() => setHasUnsavedFilters(true)}
          >
            {locations.map((location) => (
              <option
                key={location.shopify_location_id}
                value={location.shopify_location_id}
              >
                {location.name}
              </option>
            ))}
          </select>
        ) : (
          <ReadOnlyReportLocation
            helper={
              locationAccessRestricted
                ? "Restricted by your ShopOps access."
                : selectedLocation
                  ? "Only reporting location."
                  : "No reporting location is available."
            }
            value={selectedLocation?.name ?? "No location access"}
          />
        )}
      </ReportFilterField>

      <ReportFilterField htmlFor="startDate" label="Start date">
        <input
          className="shopops-report-filter-control"
          id="startDate"
          name="startDate"
          type="date"
          value={startDateValue}
          onChange={(event) => {
            setStartDateValue(event.target.value);
            setHasUnsavedFilters(true);
          }}
        />
      </ReportFilterField>

      <ReportFilterField htmlFor="endDate" label="End date">
        <input
          className="shopops-report-filter-control"
          id="endDate"
          name="endDate"
          type="date"
          value={endDateValue}
          onChange={(event) => {
            setEndDateValue(event.target.value);
            setHasUnsavedFilters(true);
          }}
        />
      </ReportFilterField>

      <ReportFilterField htmlFor="staff" label="Staff">
        <select
          className="shopops-report-filter-control"
          id="staff"
          name="staff"
          defaultValue={selectedStaff}
          onChange={() => setHasUnsavedFilters(true)}
        >
          <option value="">All staff</option>
          {staffOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ReportFilterField>

      <ReportFilterField htmlFor="vendor" label="Vendor">
        <select
          className="shopops-report-filter-control"
          id="vendor"
          name="vendor"
          defaultValue={selectedVendor}
          onChange={() => setHasUnsavedFilters(true)}
        >
          <option value="">All vendors</option>
          {vendorOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </ReportFilterField>
    </ReportFilterPanel>
  );
}
