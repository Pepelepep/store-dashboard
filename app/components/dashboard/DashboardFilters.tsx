import { Form } from "react-router";
import { useEffect, useState } from "react";

import type {
  DashboardFilterOption,
  LocationRow,
} from "../../lib/dashboard/dashboard-types";
import { AppButton } from "../ui/AppButton";
import { InlineResult } from "../ui/InlineResult";

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
}) {
  const canSwitchLocation = locations.length > 1;
  const [hasUnsavedFilters, setHasUnsavedFilters] = useState(false);
  const [startDateValue, setStartDateValue] = useState(startDate);
  const [endDateValue, setEndDateValue] = useState(endDate);

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
    <Form method="get" onSubmit={handleSubmit}>
      {preservedSearchParams.map(({ name, value }, index) => (
        <input
          key={`${name}-${index}`}
          type="hidden"
          name={name}
          value={value}
        />
      ))}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 260, flex: "1 1 420px" }}>
          <h1 style={{ margin: 0, fontSize: 34, fontWeight: 850 }}>
            Store dashboard
          </h1>

          <p style={{ marginTop: 8, color: "#6b7280", fontSize: 16 }}>
            Monitor sales, margin and operational risks by location.
          </p>
        </div>

        <div
          style={{
            width: 360,
            maxWidth: "100%",
            flex: "0 1 360px",
          }}
        >
          <label
            htmlFor="locationId"
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 6,
            }}
          >
            Location
          </label>
          <select
            id="locationId"
            name="locationId"
            defaultValue={selectedLocationId ?? ""}
            disabled={!canSwitchLocation}
            onChange={() => setHasUnsavedFilters(true)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #c9c9c9",
              background: canSwitchLocation ? "white" : "#f3f4f6",
              color: canSwitchLocation ? "#202223" : "#6b7280",
              fontSize: 14,
              minHeight: 44,
              boxSizing: "border-box",
              cursor: canSwitchLocation ? "pointer" : "not-allowed",
            }}
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
          {!canSwitchLocation ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              Location locked for this user.
            </div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          marginTop: 22,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 220px))",
          gap: 14,
          alignItems: "end",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <label
            htmlFor="startDate"
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 6,
            }}
          >
            Start date
          </label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            value={startDateValue}
            onChange={(event) => {
              setStartDateValue(event.target.value);
              setHasUnsavedFilters(true);
            }}
            style={{
              width: "100%",
              padding: "9px 10px",
              borderRadius: 12,
              border: "1px solid #c9c9c9",
              background: "white",
              fontSize: 14,
              minHeight: 44,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <label
            htmlFor="endDate"
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 6,
            }}
          >
            End date
          </label>
          <input
            id="endDate"
            name="endDate"
            type="date"
            value={endDateValue}
            onChange={(event) => {
              setEndDateValue(event.target.value);
              setHasUnsavedFilters(true);
            }}
            style={{
              width: "100%",
              padding: "9px 10px",
              borderRadius: 12,
              border: "1px solid #c9c9c9",
              background: "white",
              fontSize: 14,
              minHeight: 44,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ minWidth: 0 }}>
          <label
            htmlFor="staff"
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 6,
            }}
          >
            Staff
          </label>
          <select
            id="staff"
            name="staff"
            defaultValue={selectedStaff}
            onChange={() => setHasUnsavedFilters(true)}
            style={{
              width: "100%",
              padding: "9px 10px",
              borderRadius: 12,
              border: "1px solid #c9c9c9",
              background: "white",
              fontSize: 14,
              minHeight: 44,
              boxSizing: "border-box",
            }}
          >
            <option value="">All staff</option>
            {staffOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: 0 }}>
          <label
            htmlFor="vendor"
            style={{
              display: "block",
              fontSize: 14,
              fontWeight: 800,
              marginBottom: 6,
            }}
          >
            Vendor
          </label>
          <select
            id="vendor"
            name="vendor"
            defaultValue={selectedVendor}
            onChange={() => setHasUnsavedFilters(true)}
            style={{
              width: "100%",
              padding: "9px 10px",
              borderRadius: 12,
              border: "1px solid #c9c9c9",
              background: "white",
              fontSize: 14,
              minHeight: 44,
              boxSizing: "border-box",
            }}
          >
            <option value="">All vendors</option>
            {vendorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <AppButton
          type="submit"
          name="preset"
          value="today"
          variant="secondary"
          onClick={handleTodayClick}
          style={{ minHeight: 44, minWidth: 150, whiteSpace: "nowrap" }}
        >
          Today
        </AppButton>

        <AppButton
          type="submit"
          variant="primary"
          onClick={() => setHasUnsavedFilters(false)}
          style={{ minHeight: 44, minWidth: 150, whiteSpace: "nowrap" }}
        >
          Apply
        </AppButton>

        {hasUnsavedFilters ? (
          <InlineResult
            variant="info"
            style={{
              padding: "4px 8px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Filters changed. Click Apply to update.
          </InlineResult>
        ) : null}
      </div>
    </Form>
  );
}
