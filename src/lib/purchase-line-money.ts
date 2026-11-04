import Decimal from "decimal.js-light";

const Money = Decimal.clone({ precision: 40 });

export function roundPurchaseVnd(amount: number): number {
  return new Money(amount).toDecimalPlaces(0, Money.ROUND_HALF_UP).toNumber();
}

/** Supplier-document amounts: Excel ROUND(..., 0) per line, then whole-VND VAT. */
export function purchaseLineMoney(item: {
  price: number;
  quantity: number;
  discount?: number;
  discountType?: string;
  vatRate: number;
}) {
  const price = new Money(item.price);
  const discount = new Money(item.discount || 0);
  let effective = price;
  if (discount.gt(0)) {
    effective = item.discountType === "amount"
      ? price.minus(discount)
      : price.times(new Money(1).minus(discount.div(100)));
  }
  if (effective.lt(0)) effective = new Money(0);
  const beforeDiscount = price.times(item.quantity).toDecimalPlaces(0, Money.ROUND_HALF_UP);
  const subtotal = effective.times(item.quantity).toDecimalPlaces(0, Money.ROUND_HALF_UP);
  const tax = subtotal.times(item.vatRate).div(100).toDecimalPlaces(0, Money.ROUND_HALF_UP);
  return {
    subtotal: subtotal.toNumber(),
    discount: beforeDiscount.minus(subtotal).toNumber(),
    tax: tax.toNumber(),
  };
}

/** Allocate the recorded line value; never rebuild old money from a rounded unit price. */
export function purchaseReceivedValue(lineTotal: number, quantity: number, receivedQuantity: number): number {
  if (quantity <= 0 || receivedQuantity <= 0) return 0;
  if (receivedQuantity >= quantity) return lineTotal;
  const value = new Money(lineTotal);
  // Retain the precision of historical documents; new whole-VND lines allocate whole VND.
  const decimals = value.isInteger() ? 0 : 2;
  return value.times(receivedQuantity).div(quantity).toDecimalPlaces(decimals, Money.ROUND_HALF_UP).toNumber();
}
