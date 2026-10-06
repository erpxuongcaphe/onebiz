import { describe, expect, it } from "vitest";
import { aggregateProductSaleLines, type ProductSaleLine } from "@/lib/reports/product-sales-aggregation";

const line = (overrides: Partial<ProductSaleLine> = {}): ProductSaleLine => ({
  id: "line-1", invoiceId: "invoice-1", productId: "product-1", name: "Milk",
  unit: "Box", quantity: 1, total: 90, lineDiscount: 10, invoiceDiscount: 30,
  ...overrides,
});

describe("product revenue discount allocation", () => {
  it("does not subtract line discounts twice", () => {
    expect(aggregateProductSaleLines([line({ invoiceDiscount: 10 })])[0].revenue).toBe(90);
  });
  it("allocates only the remaining header discount across the entire invoice", () => {
    const rows = aggregateProductSaleLines([
      line(), line({ id: "line-2", productId: "product-2", lineDiscount: 0 }),
    ]);
    expect(rows.map((row) => row.revenue)).toEqual([80, 80]);
    expect(rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(160);
  });
  it("conserves money after fractional rounding", () => {
    const rows = aggregateProductSaleLines([1, 2, 3].map((id) => line({
      id: String(id), productId: String(id), total: 1, lineDiscount: 0, invoiceDiscount: 1,
    })));
    expect(rows.reduce((sum, row) => sum + row.revenue, 0)).toBeCloseTo(2, 10);
  });
  it("allocates each invoice separately before product aggregation", () => {
    expect(aggregateProductSaleLines([
      line(), line({ invoiceId: "invoice-2", invoiceDiscount: 10 }),
    ])[0].revenue).toBe(160);
  });
  it("keeps free lines free and caps allocation at the invoice line value", () => {
    const rows = aggregateProductSaleLines([
      line({ total: 0, lineDiscount: 0, invoiceDiscount: 200 }),
      line({ id: "line-2", productId: "product-2", lineDiscount: 0, invoiceDiscount: 200 }),
    ]);
    expect(rows.every((row) => row.revenue === 0)).toBe(true);
  });
  it("does not merge quantities with different units", () => {
    expect(aggregateProductSaleLines([line(), line({ unit: "Case" })])).toHaveLength(2);
  });
});
