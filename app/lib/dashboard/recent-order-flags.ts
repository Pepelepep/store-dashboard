import type { DashboardSalesOrderLineRow } from "./dashboard-types";

function numberValue(value: number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function getRecentOrderChips(row: DashboardSalesOrderLineRow) {
  const chips: string[] = [];
  const refundedAmount = numberValue(row.refunded_amount);
  const quantity = Math.max(Number(row.quantity ?? 0), 0);
  const returnedQuantity = numberValue(row.returned_quantity);
  const returnedAmount = numberValue(row.returns);
  const discounts = numberValue(row.discounts);

  if (discounts > 0) chips.push("Discounted");

  if (returnedQuantity > 0) {
    chips.push(
      quantity > 0
        ? returnedQuantity >= quantity
          ? "Returned"
          : "Partial return"
        : "Return",
    );
  } else if (returnedAmount > 0) {
    chips.push("Return");
  }

  if (refundedAmount > 0) {
    const amountBeforeReturns = Math.max(
      numberValue(row.gross_sales ?? row.revenue) - discounts,
      0,
    );

    chips.push(
      amountBeforeReturns <= 0
        ? "Refund"
        : refundedAmount + 0.005 >= amountBeforeReturns
          ? "Refunded"
          : "Partial refund",
    );
  }

  return chips;
}
