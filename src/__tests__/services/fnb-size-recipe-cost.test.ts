import { describe, expect, it } from "vitest";
import { calculateRecipeCostBySize } from "@/components/shared/dialogs/per-size-recipe-matrix";
import type { Product, UOMConversion } from "@/lib/types";

const product = (id: string, unit: string, costPrice: number): Product =>
  ({
    id,
    code: id,
    name: id,
    productType: "nvl",
    hasBom: false,
    sellPrice: 0,
    costPrice,
    stock: 0,
    ordered: 0,
    categoryId: "category",
    categoryName: "NVL",
    unit,
    stockUnit: unit,
    vatRate: 0,
    createdAt: "2026-08-29T00:00:00Z",
  }) as Product;

const conversion = (
  productId: string,
  fromUnit: string,
  toUnit: string,
  factor: number,
): UOMConversion => ({
  id: `${productId}-${fromUnit}-${toUnit}`,
  tenantId: "tenant",
  productId,
  fromUnit,
  toUnit,
  factor,
  isActive: true,
  createdAt: "2026-08-29T00:00:00Z",
});

describe("FnB size recipe costing", () => {
  it("converts preparation grams to each material stock unit before costing", () => {
    const result = calculateRecipeCostBySize(
      [
        { key: "m", name: "M" },
        { key: "l", name: "L" },
      ],
      [
        {
          key: "coffee-row",
          materialId: "coffee",
          unit: "G",
          scaleTarget: null,
          qty: { m: 16, l: 23 },
          exactQty: {},
        },
        {
          key: "sugar-row",
          materialId: "sugar",
          unit: "G",
          scaleTarget: null,
          qty: { m: 5.7, l: 8.5 },
          exactQty: {},
        },
      ],
      [product("coffee", "Túi", 190_000), product("sugar", "Kg", 20_000)],
      {},
      {
        coffee: [conversion("coffee", "Túi", "G", 1_000)],
        sugar: [conversion("sugar", "Kg", "G", 1_000)],
      },
    );

    expect(result.m).toBeCloseTo(3_154, 6);
    expect(result.l).toBeCloseTo(4_540, 6);
  });
});
