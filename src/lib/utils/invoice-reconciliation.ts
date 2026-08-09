export interface InvoiceReconciliationInput {
  subtotal: number;
  lineDiscount: number;
  totalDiscount: number;
  itemTaxAmount: number;
  reportedTaxAmount: number;
  deliveryFee: number;
  invoiceTotal: number;
}

export interface InvoiceReconciliation {
  orderDiscount: number;
  taxAmount: number;
  expectedTotal: number;
  difference: number;
  hasDifference: boolean;
}

function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Rebuild the visible invoice formula without changing persisted data.
 * `totalDiscount` already includes both line and order discounts.
 */
export function reconcileInvoiceTotal(
  input: InvoiceReconciliationInput,
): InvoiceReconciliation {
  const subtotal = Math.max(0, money(input.subtotal));
  const lineDiscount = Math.max(0, money(input.lineDiscount));
  const totalDiscount = Math.max(0, money(input.totalDiscount));
  const orderDiscount = Math.max(0, money(totalDiscount - lineDiscount));
  const itemTaxAmount = Math.max(0, money(input.itemTaxAmount));
  const reportedTaxAmount = Math.max(0, money(input.reportedTaxAmount));
  const deliveryFee = Math.max(0, money(input.deliveryFee));
  const invoiceTotal = Math.max(0, money(input.invoiceTotal));
  const baseBeforeOrderTax = Math.max(
    0,
    money(
      subtotal - lineDiscount - orderDiscount + itemTaxAmount + deliveryFee,
    ),
  );
  const reportedOrderTax = money(reportedTaxAmount - itemTaxAmount);
  const orderTaxIsValid =
    Math.abs(reportedOrderTax) <= 0.01 ||
    [5, 8, 10].some(
      (rate) =>
        Math.abs(
          reportedOrderTax - Math.ceil((baseBeforeOrderTax * rate) / 100),
        ) <= 0.01,
    );
  const taxAmount = orderTaxIsValid ? reportedTaxAmount : itemTaxAmount;
  const expectedTotal = Math.max(
    0,
    money(subtotal - lineDiscount - orderDiscount + taxAmount + deliveryFee),
  );
  const difference = money(invoiceTotal - expectedTotal);

  return {
    orderDiscount,
    taxAmount,
    expectedTotal,
    difference,
    hasDifference: Math.abs(difference) > 0.01,
  };
}
