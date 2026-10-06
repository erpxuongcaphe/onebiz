import Decimal from "decimal.js-light";
import type { TopProductRevenue } from "@/lib/services/supabase/analytics";

const minimum = (a: Decimal, b: Decimal) => a.lessThan(b) ? a : b;
const nonnegative = (value: Decimal) => value.lessThan(0) ? new Decimal(0) : value;

export interface ProductSaleLine {
  id: string;
  invoiceId: string;
  productId: string;
  name: string;
  code?: string;
  unit: string;
  category?: string;
  quantity: number;
  total: number;
  lineDiscount: number;
  invoiceDiscount: number;
}

export function aggregateProductSaleLines(lines: ProductSaleLine[]): TopProductRevenue[] {
  const invoices = new Map<string, ProductSaleLine[]>();
  for (const line of lines) {
    const invoice = invoices.get(line.invoiceId) ?? [];
    invoice.push(line);
    invoices.set(line.invoiceId, invoice);
  }
  const products = new Map<string, TopProductRevenue>();
  for (const invoice of invoices.values()) {
    const lineTotal = invoice.reduce((sum, line) => sum.plus(line.total), new Decimal(0));
    const lineDiscount = invoice.reduce((sum, line) => sum.plus(line.lineDiscount), new Decimal(0));
    // Stored header discount includes line discounts; line totals already exclude them.
    const orderDiscount = minimum(
      nonnegative(new Decimal(invoice[0].invoiceDiscount).minus(lineDiscount)),
      nonnegative(lineTotal),
    );
    let remainingDiscount = orderDiscount;
    const positiveLines = invoice.filter((line) => line.total > 0);
    for (const line of invoice) {
      let allocated = new Decimal(0);
      if (line.total > 0 && lineTotal.greaterThan(0)) {
        allocated = line === positiveLines[positiveLines.length - 1]
          ? remainingDiscount
          : minimum(remainingDiscount, orderDiscount.times(line.total).dividedBy(lineTotal).toDecimalPlaces(2));
        remainingDiscount = remainingDiscount.minus(allocated);
      }
      const key = JSON.stringify([line.productId, line.name.trim().replace(/\s+/g, " ").toLocaleLowerCase("vi"), line.unit]);
      const current = products.get(key) ?? {
        productId: line.productId, name: line.name, code: line.code, unit: line.unit,
        category: line.category, qty: 0, revenue: 0, discountAmount: 0,
      };
      current.qty += line.quantity;
      current.revenue = new Decimal(current.revenue).plus(line.total).minus(allocated).toNumber();
      current.discountAmount = new Decimal(current.discountAmount ?? 0).plus(line.lineDiscount).plus(allocated).toNumber();
      products.set(key, current);
    }
  }
  return [...products.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, "vi"));
}
