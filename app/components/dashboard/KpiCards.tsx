import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";

import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "../../lib/dashboard/dashboard-metrics";
import {
  buildReportKpiComparison,
  buildSharedReportKpiItems,
  REPORT_METRIC_DEFINITIONS,
  type ReportKpiId,
} from "../../lib/dashboard/kpi-presentation";
import type {
  DashboardLoaderData,
  FinancialMetricsVersion,
} from "../../lib/dashboard/dashboard-types";
import {
  attachReportKpiDetails,
  ReportKpiGrid,
  ReportKpiNotice,
} from "./ReportKpiGrid";

export function KpiCards({
  kpis,
  comparison,
  selectedDays,
  financialMetricsVersion,
  canAdmin,
}: {
  kpis: DashboardLoaderData["kpis"];
  comparison: DashboardLoaderData["comparison"];
  selectedDays: number;
  financialMetricsVersion: FinancialMetricsVersion;
  canAdmin: boolean;
}) {
  const isFinancialMetricsV2 = financialMetricsVersion === "v2";
  const location = useLocation();
  const productCostsSearch = new URLSearchParams(location.search);
  productCostsSearch.set("tab", "products");
  const expensesSearch = new URLSearchParams(location.search);
  expensesSearch.set("tab", "expenses");
  const productCostsPath = `/app/costs?${productCostsSearch.toString()}`;
  const expensesPath = `/app/costs?${expensesSearch.toString()}`;
  const grossSales = kpis.grossSales ?? kpis.revenue;
  const discounts = kpis.discounts ?? 0;
  const discountPercent =
    grossSales > 0
      ? formatPercent((discounts / grossSales) * 100)
      : formatPercent(0);
  const comparisonLabel =
    selectedDays === 1
      ? "vs previous day"
      : `vs previous ${selectedDays}-day period`;
  const comparisons = {
    sales: buildReportKpiComparison({
      current: kpis.revenue,
      previous: comparison.revenue,
      label: comparisonLabel,
    }),
    refunds: buildReportKpiComparison({
      current: kpis.refunds ?? 0,
      previous: comparison.refunds,
      label: comparisonLabel,
      lowerIsBetter: true,
    }),
    returns: buildReportKpiComparison({
      current: kpis.returns ?? 0,
      previous: comparison.returns,
      label: comparisonLabel,
      lowerIsBetter: true,
    }),
    orders: buildReportKpiComparison({
      current: kpis.ordersCount,
      previous: comparison.ordersCount,
      label: comparisonLabel,
    }),
    unitsSold: buildReportKpiComparison({
      current: kpis.unitsSold,
      previous: comparison.unitsSold,
      label: comparisonLabel,
    }),
  } as const;

  const grossProfitDetail = kpis.cogsIncomplete ? (
    <ReportKpiNotice tone="warning">
      <div>
        {formatNumber(kpis.missingCogsLineCount)} sales{" "}
        {kpis.missingCogsLineCount === 1 ? "line is" : "lines are"} missing
        product costs.
      </div>
      {canAdmin ? (
        <Link className="shopops-kpi-notice__action" to={productCostsPath}>
          Review product costs
        </Link>
      ) : null}
    </ReportKpiNotice>
  ) : kpis.includesEstimatedCogs ? (
    <ReportKpiNotice tone="info">
      <div>Includes estimated product costs</div>
      {canAdmin ? (
        <Link className="shopops-kpi-notice__action" to={productCostsPath}>
          Review product costs
        </Link>
      ) : null}
    </ReportKpiNotice>
  ) : isFinancialMetricsV2 ? (
    "Net Sales minus COGS"
  ) : (
    "Revenue minus COGS"
  );

  const netProfitDetail = kpis.cogsIncomplete ? (
    "Requires complete product costs"
  ) : !kpis.hasOperatingExpenses && canAdmin ? (
    <ReportKpiNotice tone="neutral">
      <div>No operating expenses configured.</div>
      <Link className="shopops-kpi-notice__action" to={expensesPath}>
        Add expenses
      </Link>
    </ReportKpiNotice>
  ) : (
    "Gross profit minus expenses"
  );

  const details: Partial<Record<ReportKpiId, ReactNode>> = {
    sales: isFinancialMetricsV2 ? (
      <>
        <div>After discounts &amp; returns</div>
        <div>
          Discounts applied: {formatCurrency(discounts)} ({discountPercent} of
          Gross)
        </div>
      </>
    ) : (
      "Synced retail sales"
    ),
    refunds: (
      <>
        <div>
          {formatNumber(kpis.refundTransactionsCount ?? 0)} refund transactions
          {" · "}
          {formatNumber(kpis.refundedOrdersCount ?? 0)} orders
        </div>
        {kpis.refundAllocationWarning ? (
          <div>{kpis.refundAllocationWarning}</div>
        ) : null}
      </>
    ),
    returns: `${formatNumber(kpis.returnedQuantity ?? 0)} units · ${formatNumber(
      kpis.returnedOrdersCount ?? 0,
    )} orders`,
    orders: "Unique orders in the selected range",
    unitsSold: "Quantity sold from order lines",
    cogs: (
      <>
        <div>
          Actual: {formatCurrency(kpis.actualCogs)} · Estimated:{" "}
          {formatCurrency(kpis.estimatedCogs)}
        </div>
        {kpis.missingCogsLineCount > 0 ? (
          <div>
            {formatNumber(kpis.missingCogsLineCount)} sales lines missing costs
          </div>
        ) : null}
      </>
    ),
    grossProfit: grossProfitDetail,
    grossMargin: kpis.cogsIncomplete
      ? "Requires complete product costs"
      : isFinancialMetricsV2
        ? "Gross profit / Net Sales"
        : "Gross profit / revenue",
    expenses: "Fixed expenses from DB",
    netProfit: netProfitDetail,
  };
  const items = attachReportKpiDetails(
    buildSharedReportKpiItems({
      values: kpis,
      financialMetricsVersion,
    }),
    details,
    comparisons,
  );

  return (
    <>
      <ReportKpiGrid items={items} />
      {isFinancialMetricsV2 ? (
        <details className="shopops-metric-definitions">
          <summary>Metric definitions</summary>
          <div>
            {REPORT_METRIC_DEFINITIONS.grossSales}{" "}
            {REPORT_METRIC_DEFINITIONS.discounts}{" "}
            {REPORT_METRIC_DEFINITIONS.netSales}{" "}
            {REPORT_METRIC_DEFINITIONS.cogs}{" "}
            {REPORT_METRIC_DEFINITIONS.grossProfit}{" "}
            {REPORT_METRIC_DEFINITIONS.grossMargin}{" "}
            {REPORT_METRIC_DEFINITIONS.refunds}{" "}
            {REPORT_METRIC_DEFINITIONS.returns}
          </div>
        </details>
      ) : null}
    </>
  );
}
