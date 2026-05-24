import { AppButton } from "../ui/AppButton";
import { StatusBadge } from "../ui/StatusBadge";
import type { ActiveDrilldowns } from "../../lib/dashboard/dashboard-types";

function getActiveChips(activeDrilldowns: ActiveDrilldowns) {
  const chips: Array<{
    key: keyof ActiveDrilldowns;
    label: string;
    value: string;
  }> = [];

  if (activeDrilldowns.vendor) {
    chips.push({
      key: "vendor",
      label: "Vendor",
      value: activeDrilldowns.vendor.label,
    });
  }

  if (activeDrilldowns.hour !== null && activeDrilldowns.hour !== undefined) {
    chips.push({
      key: "hour",
      label: "Hour",
      value: `${String(activeDrilldowns.hour).padStart(2, "0")}:00`,
    });
  }

  if (activeDrilldowns.staff) {
    chips.push({
      key: "staff",
      label: "Staff",
      value: activeDrilldowns.staff.label,
    });
  }

  if (activeDrilldowns.product) {
    chips.push({
      key: "product",
      label: "Product",
      value: activeDrilldowns.product.label,
    });
  }

  return chips;
}

export function ActiveDrilldownBadge({
  activeDrilldowns,
  onClearOne,
  onClearAll,
}: {
  activeDrilldowns: ActiveDrilldowns;
  onClearOne: (key: keyof ActiveDrilldowns) => void;
  onClearAll: () => void;
}) {
  const chips = getActiveChips(activeDrilldowns);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        alignItems: "center",
        background: "white",
        border: "1px solid #e3e3e3",
        borderRadius: 12,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        justifyContent: "space-between",
        marginBottom: 16,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span style={{ color: "#616161", fontSize: 13, fontWeight: 700 }}>
          Filtered by:
        </span>
        {chips.map((chip) => (
          <StatusBadge
            key={chip.key}
            variant="info"
            style={{ gap: 6, paddingRight: 6 }}
          >
            {chip.label}: {chip.value}
            <button
              type="button"
              aria-label={`Clear ${chip.label} drilldown`}
              onClick={() => onClearOne(chip.key)}
              style={{
                alignItems: "center",
                background: "transparent",
                border: 0,
                borderRadius: 999,
                color: "inherit",
                cursor: "pointer",
                display: "inline-flex",
                fontSize: 13,
                fontWeight: 900,
                height: 18,
                justifyContent: "center",
                lineHeight: 1,
                marginLeft: 2,
                padding: 0,
                width: 18,
              }}
            >
              ×
            </button>
          </StatusBadge>
        ))}
      </div>

      <AppButton variant="ghost" compact onClick={onClearAll}>
        Clear all
      </AppButton>
    </div>
  );
}
