import { AppButton } from "../ui/AppButton";
import { StatusBadge } from "../ui/StatusBadge";
import type { DashboardDrilldown } from "../../lib/dashboard/dashboard-types";

function getDrilldownTypeLabel(type: DashboardDrilldown["type"]) {
  if (type === "hour") return "Hour";
  if (type === "product") return "Product";
  if (type === "staff") return "Staff";
  return "Vendor";
}

export function ActiveDrilldownBadge({
  activeDrilldown,
  onClear,
}: {
  activeDrilldown: DashboardDrilldown | null;
  onClear: () => void;
}) {
  if (!activeDrilldown) {
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
      <StatusBadge variant="info">
        Filtered by {getDrilldownTypeLabel(activeDrilldown.type)}:{" "}
        {activeDrilldown.label}
      </StatusBadge>

      <AppButton variant="ghost" compact onClick={onClear}>
        Clear
      </AppButton>
    </div>
  );
}
