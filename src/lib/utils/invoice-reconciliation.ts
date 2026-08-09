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

export interface InvoiceItemTaxInput {
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
}

function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Older invoices can have a VAT rate but no persisted VAT amount. Prefer the
 * stored amount and only rebuild it from the line net value for those rows.
 */
export function getInvoiceItemTaxAmount(input: InvoiceItemTaxInput): number {
  const storedAmount = Math.max(0, money(input.vatAmount));
  if (storedAmount > 0) return storedAmount;

  const rate = Math.max(0, money(input.vatRate));
  if (rate <= 0) return 0;

  const lineValue = Math.max(
    0,
    money(input.unitPrice) * Math.max(0, money(input.quantity)) -
      Math.max(0, money(input.discount)),
  );
  return money(Math.ceil((lineValue * rate) / 100));
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
