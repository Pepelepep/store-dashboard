import { ShopOpsDrilldownBar } from "../ui/ShopOpsDrilldownBar";
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

  return (
    <ShopOpsDrilldownBar
      chips={chips}
      onClearAll={onClearAll}
      onClearOne={onClearOne}
    />
  );
}
