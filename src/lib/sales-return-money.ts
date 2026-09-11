import Decimal from "decimal.js-light";

const Money = Decimal.clone({ precision: 40 });

export interface SalesReturnMoneyLine {
  /** Total paid value stored on the original invoice line. */
  lineTotal: number;
  soldQuantity: number;
  returnQuantity: number;
}

/** Match PostgreSQL round(numeric, 2) without JavaScript floating-point drift. */
export function roundSalesReturnMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return new Money(value).toDecimalPlaces(2, Money.ROUND_HALF_UP).toNumber();
}

/** Server-owned return line definition: round(return qty * line total / sold qty, 2). */
export function salesReturnLineTotal(line: SalesReturnMoneyLine): number {
  if (
    !Number.isFinite(line.lineTotal) ||
    !Number.isFinite(line.soldQuantity) ||
    !Number.isFinite(line.returnQuantity) ||
    line.soldQuantity <= 0 ||
    line.returnQuantity <= 0
  ) {
    return 0;
  }

  return new Money(line.lineTotal)
    .div(line.soldQuantity)
    .times(line.returnQuantity)
    .toDecimalPlaces(2, Money.ROUND_HALF_UP)
    .toNumber();
}

export function salesReturnTotal(lines: SalesReturnMoneyLine[]): number {
  return lines
    .reduce(
      (total, line) => total.plus(salesReturnLineTotal(line)),
      new Money(0),
    )
    .toDecimalPlaces(2, Money.ROUND_HALF_UP)
    .toNumber();
}
