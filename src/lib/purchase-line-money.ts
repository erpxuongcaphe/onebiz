import Decimal from "decimal.js-light";

const Money = Decimal.clone({ precision: 40 });

/** Supplier-document amounts: decimal ceil per line, then whole-VND VAT. */
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
  const beforeDiscount = price.times(item.quantity).toDecimalPlaces(0, Money.ROUND_CEIL);
  const subtotal = effective.times(item.quantity).toDecimalPlaces(0, Money.ROUND_CEIL);
  const tax = subtotal.times(item.vatRate).div(100).toDecimalPlaces(0, Money.ROUND_HALF_UP);
  return {
    subtotal: subtotal.toNumber(),
    discount: beforeDiscount.minus(subtotal).toNumber(),
    tax: tax.toNumber(),
  };
}
