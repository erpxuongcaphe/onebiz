import { describe, expect, it } from "vitest";
import { reconcileProductSales } from "@/lib/reports/product-sales-reconciliation";
import type { TopProductRevenue } from "@/lib/services/supabase/analytics";

const sale = (overrides: Partial<TopProductRevenue> = {}): TopProductRevenue => ({
  productId: "product-1",
  name: "Trà sữa (Size M)",
  code: "SKU-TS-001",
  qty: 4,
  revenue: 120_000,
  ...overrides,
});

describe("product sales and return reconciliation", () => {
  it("matches returns by product and variant label, not SKU alone", () => {
    const rows = reconcileProductSales(
      [
        sale(),
        sale({ name: "Trà sữa (Size L)", qty: 2, revenue: 70_000 }),
      ],
      [{ productId: "product-1", productName: "Trà sữa (Size M)", returnValue: 30_000 }],
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.name.endsWith("Size M)"))).toMatchObject({
      qty: 4,
      revenue: 120_000,
      returnedValue: 30_000,
      netRevenue: 90_000,
    });
    expect(rows.find((row) => row.name.endsWith("Size L)"))).toMatchObject({
      returnedValue: 0,
      netRevenue: 70_000,
    });
  });

  it("keeps returns of prior-period sales visible without inventing current-period sales", () => {
    const rows = reconcileProductSales([], [
      { productId: "product-2", productName: "Bánh", returnValue: 50_000 },
    ]);

    expect(rows).toEqual([expect.objectContaining({
      productId: "product-2",
      name: "Bánh",
      qty: 0,
      revenue: 0,
      returnedValue: 50_000,
      netRevenue: -50_000,
    })]);
  });

  it("does not merge identical names that belong to different product IDs", () => {
    const rows = reconcileProductSales(
      [sale(), sale({ productId: "product-2", qty: 1, revenue: 25_000 })],
      [],
    );

    expect(rows).toHaveLength(2);
  });

  it("aggregates gross lines and return amounts for the same product variant", () => {
    const rows = reconcileProductSales(
      [sale(), sale({ qty: 2, revenue: 60_000 })],
      [
        { productId: "product-1", productName: " Trà   sữa (Size M) ", returnValue: 10_000 },
        { productId: "product-1", productName: "Trà sữa (Size M)", returnValue: 5_000 },
      ],
    );

    expect(rows[0]).toMatchObject({ qty: 6, revenue: 180_000, returnedValue: 15_000, netRevenue: 165_000 });
  });
});
