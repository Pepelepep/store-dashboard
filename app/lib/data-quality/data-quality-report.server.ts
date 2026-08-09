import { getSupabaseAdminClient } from "../db/supabase.server";
import type { LocationRow } from "../dashboard/dashboard-types";

export type HealthStatus = "OK" | "Warning" | "Critical";

type ExpenseRow = {
  shopify_location_id: string | null;
  is_active: boolean;
};

export type IssueSample = Record<string, unknown>;

export type QualityIssue = {
  key: string;
  title: string;
  explanation: string;
  count: number;
  status: HealthStatus;
  optional?: boolean;
  samples: IssueSample[];
};

export type ExpenseCoverage = {
  covered: number;
  missing: number;
  rows: Array<{ locationName: string; status: "Covered" | "Missing" }>;
};

export type DataQualityReport = {
  issues: QualityIssue[];
  optionalIssues: QualityIssue[];
  expenseCoverage: ExpenseCoverage;
  errors: string[];
};

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function reportIssue(
  report: Record<string, unknown>,
  key: string,
): { count: number; samples: IssueSample[] } {
  const rawIssue = report[key];

  if (!rawIssue || typeof rawIssue !== "object") {
    return { count: 0, samples: [] };
  }

  const issue = rawIssue as Record<string, unknown>;
  const samples = Array.isArray(issue.samples)
    ? (issue.samples as IssueSample[]).slice(0, 10)
    : [];

  return {
    count: numberValue(issue.count),
    samples,
  };
}

function buildIssue({
  report,
  key,
  title,
  explanation,
  severity,
  optional = false,
}: {
  report: Record<string, unknown>;
  key: string;
  title: string;
  explanation: string;
  severity: "warning" | "critical";
  optional?: boolean;
}): QualityIssue {
  const issue = reportIssue(report, key);

  return {
    key,
    title,
    explanation,
    count: issue.count,
    status:
      issue.count > 0
        ? severity === "critical"
          ? "Critical"
          : "Warning"
        : "OK",
    optional,
    samples: issue.samples,
  };
}

export async function loadDataQualityReport({
  supabase,
  shop,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  shop: string;
}): Promise<DataQualityReport> {
  const errors: string[] = [];

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name, is_active")
    .eq("shop_domain", shop)
    .eq("shopify_is_active", true)
    .eq("reporting_enabled", true)
    .order("name", { ascending: true });

  if (locationsError) errors.push(locationsError.message);

  const accessibleLocations = (locationsData ?? []) as LocationRow[];
  const accessibleLocationIds = accessibleLocations.map(
    (location) => location.shopify_location_id,
  );

  const [expensesResult, reportResult] = await Promise.allSettled([
    supabase
      .from("fixed_expenses")
      .select("shopify_location_id, is_active")
      .eq("shop_domain", shop)
      .eq("is_active", true),
    supabase.rpc("get_data_quality_report", {
      p_shop_domain: shop,
      p_location_ids: accessibleLocationIds,
    }),
  ]);

  const expenses =
    expensesResult.status === "fulfilled" && !expensesResult.value.error
      ? ((expensesResult.value.data ?? []) as ExpenseRow[])
      : [];
  const report =
    reportResult.status === "fulfilled" && !reportResult.value.error
      ? ((reportResult.value.data ?? {}) as Record<string, unknown>)
      : {};

  if (expensesResult.status === "fulfilled" && expensesResult.value.error) {
    errors.push(expensesResult.value.error.message);
  }
  if (reportResult.status === "fulfilled" && reportResult.value.error) {
    errors.push(reportResult.value.error.message);
  }

  const coveredLocationIds = new Set(
    expenses
      .map((expense) => expense.shopify_location_id)
      .filter((value): value is string => Boolean(value)),
  );
  const expenseRows = accessibleLocations.map((location) => ({
    locationName: location.name,
    status: coveredLocationIds.has(location.shopify_location_id)
      ? ("Covered" as const)
      : ("Missing" as const),
  }));

  const issues = [
    buildIssue({
      report,
      key: "productsWithoutVariants",
      title: "Products without variants",
      explanation:
        "Products without variants cannot map cleanly into sales or inventory reporting.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "variantsMissingInventoryItemId",
      title: "Variants missing inventory item ID",
      explanation:
        "Missing inventory item IDs prevent inventory levels and cost snapshots from linking reliably.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "variantsMissingUnitCost",
      title: "Variants missing unit cost",
      explanation:
        "Missing current cost forces order lines to use fallback or missing-cost handling.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "orderLinesMissingCogs",
      title: "Order lines missing COGS",
      explanation:
        "These rows do not currently have cost of goods sold after the latest recompute.",
      severity: "critical",
    }),
    buildIssue({
      report,
      key: "orderLinesUsingFallbackCost",
      title: "Order lines using estimated cost",
      explanation:
        "These rows use the store's configured estimate because no current Shopify cost exists.",
      severity: "warning",
    }),
    buildIssue({
      report,
      key: "ordersWithoutOrderLines",
      title: "Orders without order lines",
      explanation:
        "Orders without lines usually indicate an incomplete orders sync.",
      severity: "critical",
    }),
    buildIssue({
      report,
      key: "inventoryLevelsWithoutMatchingVariantOrProduct",
      title: "Inventory levels without matching variant/product",
      explanation:
        "Inventory rows that cannot join to variant/product data can distort stock reporting.",
      severity: "critical",
    }),
  ];
  const optionalIssues = [
    buildIssue({
      report,
      key: "orderLinesMissingStaffAttribution",
      title: "Missing staff attribution",
      explanation:
        "Optional/non-blocking. Shopify does not always provide staff attribution.",
      severity: "warning",
      optional: true,
    }),
  ];

  return {
    issues,
    optionalIssues,
    expenseCoverage: {
      covered: expenseRows.filter((row) => row.status === "Covered").length,
      missing: expenseRows.filter((row) => row.status === "Missing").length,
      rows: expenseRows,
    },
    errors,
  };
}
