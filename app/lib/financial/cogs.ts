export type CogsLine = {
  quantity: number | null | undefined;
  returned_quantity?: number | null;
  cost_at_sale?: number | null;
  unit_cost?: number | null;
};

function finiteNumber(value: number | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getRemainingProductQuantity(line: CogsLine) {
  return Math.max(
    finiteNumber(line.quantity) - finiteNumber(line.returned_quantity),
    0,
  );
}

export function getActualUnitCost(line: CogsLine) {
  const value =
    line.cost_at_sale !== null && line.cost_at_sale !== undefined
      ? line.cost_at_sale
      : line.unit_cost;

  if (value === null || value === undefined) return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function calculateRemainingLineCogs(line: CogsLine) {
  const unitCost = getActualUnitCost(line);
  if (unitCost === null) return null;

  return unitCost * getRemainingProductQuantity(line);
}

export function summarizeCogs(lines: CogsLine[]) {
  let knownCogs = 0;
  let missingCostLineCount = 0;

  for (const line of lines) {
    const lineCogs = calculateRemainingLineCogs(line);

    if (lineCogs === null) {
      missingCostLineCount += 1;
    } else {
      knownCogs += lineCogs;
    }
  }

  return {
    cogs: missingCostLineCount > 0 ? null : knownCogs,
    knownCogs,
    missingCostLineCount,
    profitComplete: missingCostLineCount === 0,
  };
}
