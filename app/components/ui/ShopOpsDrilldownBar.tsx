import { AppButton } from "./AppButton";
import { StatusBadge } from "./StatusBadge";

export type ShopOpsDrilldownChip<TKey extends string> = {
  key: TKey;
  label: string;
  value: string;
};

export function ShopOpsDrilldownBar<TKey extends string>({
  chips,
  onClearAll,
  onClearOne,
}: {
  chips: Array<ShopOpsDrilldownChip<TKey>>;
  onClearAll: () => void;
  onClearOne: (key: TKey) => void;
}) {
  if (chips.length === 0) return null;

  return (
    <div className="shopops-drilldown-bar">
      <div className="shopops-drilldown-bar__chips">
        <span className="shopops-drilldown-bar__label">Filtered by:</span>
        {chips.map((chip) => (
          <StatusBadge
            key={chip.key}
            variant="info"
            style={{ gap: 6, paddingRight: 6 }}
          >
            {chip.label}: {chip.value}
            <button
              aria-label={`Clear ${chip.label} drilldown`}
              className="shopops-drilldown-bar__remove"
              onClick={() => onClearOne(chip.key)}
              type="button"
            >
              ×
            </button>
          </StatusBadge>
        ))}
      </div>
      <AppButton compact onClick={onClearAll} variant="ghost">
        Clear all
      </AppButton>
    </div>
  );
}
