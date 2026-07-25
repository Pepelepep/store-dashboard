export type CogsLine = {
  quantity: number | null | undefined;
  returned_quantity?: number | null;
  cost_at_sale?: number | null;
  unit_cost?: number | null;
};

export const COGS_INCOMPLETE_WARNING =
  "Some product costs are missing. Profit metrics use available costs only and may be overstated.";

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
  let missingCogsLineCount = 0;
  let knownCogsLineCount = 0;

  for (const line of lines) {
    const lineCogs = calculateRemainingLineCogs(line);

    if (lineCogs === null) {
      missingCogsLineCount += 1;
    } else {
      knownCogs += lineCogs;
      knownCogsLineCount += 1;
    }
  }

  return {
    cogs: knownCogs,
    knownCogs,
    cogsIncomplete: missingCogsLineCount > 0,
    missingCogsLineCount,
    knownCogsLineCount,
  };
}

export function calculateProvisionalProfit({
  netSales,
  knownCogs,
  expenses,
}: {
  netSales: number;
  knownCogs: number;
  expenses: number | null;
}) {
  const grossProfit = netSales - knownCogs;

  return {
    grossProfit,
    grossMarginPct: netSales > 0 ? (grossProfit / netSales) * 100 : null,
    netProfit: expenses === null ? null : grossProfit - expenses,
  };
}
