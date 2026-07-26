export type CogsLine = {
  quantity: number | null | undefined;
  returned_quantity?: number | null;
  cost_at_sale?: number | null;
  unit_cost?: number | null;
  cogs?: number | null;
  cost_source?: string | null;
};

export const SHOP_PERCENT_ESTIMATE_SOURCE = "SHOP_PERCENT_ESTIMATE";

export type EstimateSettings = {
  enabled: boolean;
  percent: number | null;
  estimateCustomSales: boolean;
};

export type EstimateLine = CogsLine & {
  unit_price?: number | null;
  gross_sales?: number | null;
  net_sales?: number | null;
  revenue?: number | null;
  shopify_variant_id?: string | null;
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
  const value = line.cost_at_sale;

  if (value !== null && value !== undefined) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  if (line.cost_source === SHOP_PERCENT_ESTIMATE_SOURCE) return null;

  const storedUnitCost = line.unit_cost;

  if (storedUnitCost === null || storedUnitCost === undefined) return null;

  const number = Number(storedUnitCost);
  return Number.isFinite(number) ? number : null;
}

export function calculateRemainingLineCogs(line: CogsLine) {
  if (getRemainingProductQuantity(line) === 0) return 0;

  const unitCost = getActualUnitCost(line);
  if (unitCost !== null) {
    return unitCost * getRemainingProductQuantity(line);
  }

  if (
    line.cost_source === SHOP_PERCENT_ESTIMATE_SOURCE &&
    line.cogs !== null &&
    line.cogs !== undefined
  ) {
    const estimatedCogs = Number(line.cogs);
    return Number.isFinite(estimatedCogs) ? estimatedCogs : null;
  }

  return null;
}

export function summarizeCogs(lines: CogsLine[]) {
  let knownCogs = 0;
  let actualCogs = 0;
  let estimatedCogs = 0;
  let missingCogsLineCount = 0;
  let knownCogsLineCount = 0;
  let actualCogsLineCount = 0;
  let estimatedCogsLineCount = 0;

  for (const line of lines) {
    if (getRemainingProductQuantity(line) === 0) continue;

    const lineCogs = calculateRemainingLineCogs(line);

    if (lineCogs === null) {
      missingCogsLineCount += 1;
    } else {
      knownCogs += lineCogs;
      knownCogsLineCount += 1;

      if (line.cost_source === SHOP_PERCENT_ESTIMATE_SOURCE) {
        estimatedCogs += lineCogs;
        estimatedCogsLineCount += 1;
      } else {
        actualCogs += lineCogs;
        actualCogsLineCount += 1;
      }
    }
  }

  return {
    cogs: knownCogs,
    knownCogs,
    actualCogs,
    estimatedCogs,
    cogsIncomplete: missingCogsLineCount > 0,
    includesEstimatedCogs: estimatedCogsLineCount > 0,
    missingCogsLineCount,
    knownCogsLineCount,
    actualCogsLineCount,
    estimatedCogsLineCount,
  };
}

export function calculateReportedProfit({
  netSales,
  knownCogs,
  expenses,
  cogsIncomplete,
}: {
  netSales: number;
  knownCogs: number;
  expenses: number | null;
  cogsIncomplete: boolean;
}) {
  if (cogsIncomplete) {
    return {
      grossProfit: null,
      grossMarginPct: null,
      netProfit: null,
    };
  }

  const grossProfit = netSales - knownCogs;

  return {
    grossProfit,
    grossMarginPct: netSales > 0 ? (grossProfit / netSales) * 100 : null,
    netProfit: expenses === null ? null : grossProfit - expenses,
  };
}

export function isValidEstimatePercent(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function getPreDiscountUnitPrice(line: EstimateLine) {
  const quantity = Math.max(Number(line.quantity ?? 0), 0);
  const grossSales =
    line.gross_sales === null || line.gross_sales === undefined
      ? null
      : Number(line.gross_sales);

  if (
    quantity > 0 &&
    grossSales !== null &&
    Number.isFinite(grossSales) &&
    grossSales >= 0
  ) {
    return grossSales / quantity;
  }

  const unitPrice = Number(line.unit_price);
  return Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
}

export function resolveLineCogs(
  line: EstimateLine,
  settings: EstimateSettings,
) {
  const actualUnitCost = getActualUnitCost(line);
  const remainingQuantity = getRemainingProductQuantity(line);

  if (remainingQuantity === 0) {
    return {
      kind: "returned" as const,
      cogs: 0,
      unitCost: null,
      estimatePercent: null,
    };
  }

  if (actualUnitCost !== null) {
    return {
      kind: "actual" as const,
      cogs: actualUnitCost * remainingQuantity,
      unitCost: actualUnitCost,
      estimatePercent: null,
    };
  }

  const isCustomSale = !line.shopify_variant_id;
  const eligible =
    settings.enabled &&
    settings.percent !== null &&
    isValidEstimatePercent(Number(settings.percent)) &&
    (!isCustomSale || settings.estimateCustomSales);

  if (eligible) {
    const percent = Number(settings.percent);
    const estimatedUnitCost = getPreDiscountUnitPrice(line) * (percent / 100);

    return {
      kind: "estimated" as const,
      cogs: estimatedUnitCost * remainingQuantity,
      unitCost: estimatedUnitCost,
      estimatePercent: percent,
    };
  }

  return {
    kind: "missing" as const,
    cogs: null,
    unitCost: null,
    estimatePercent: null,
  };
}

export function previewEstimateImpact(
  lines: EstimateLine[],
  settings: EstimateSettings,
) {
  let affectedLineCount = 0;
  let estimatedCogs = 0;
  let totalCogs = 0;
  let netSales = 0;
  let missingLineCount = 0;

  for (const line of lines) {
    const resolved = resolveLineCogs(line, settings);
    netSales += Number(line.net_sales ?? line.revenue ?? 0);

    if (resolved.kind === "missing") {
      missingLineCount += 1;
      continue;
    }

    totalCogs += resolved.cogs;

    if (resolved.kind === "estimated") {
      affectedLineCount += 1;
      estimatedCogs += resolved.cogs;
    }
  }

  return {
    affectedLineCount,
    estimatedCogs,
    estimatedProfit: missingLineCount === 0 ? netSales - totalCogs : null,
    missingLineCount,
  };
}
