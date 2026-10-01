import { describe, expect, it } from "vitest";
import type { ProductVariant } from "@/lib/types";
import { isUnconfiguredDefaultVariant } from "@/app/pos/retail-variant-selection";

const placeholder: ProductVariant = {
  id: "variant-1",
  tenantId: "tenant-1",
  productId: "product-1",
  name: "Default",
  unitCount: 1,
  sellPrice: 0,
  costPrice: 0,
  isDefault: true,
  isActive: true,
  sortOrder: 0,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

describe("Retail POS variant selection", () => {
  it("uses the parent price for a lone empty Default row", () => {
    expect(isUnconfiguredDefaultVariant({ sellPrice: 250000 }, [placeholder])).toBe(true);
    expect(isUnconfiguredDefaultVariant({ sellPrice: 250000 }, [
      { ...placeholder, costPrice: 205000 },
    ])).toBe(true);
  });

  it("preserves intentional zero-price products and configured variants", () => {
    expect(isUnconfiguredDefaultVariant({ sellPrice: 0 }, [placeholder])).toBe(false);
    expect(isUnconfiguredDefaultVariant({ sellPrice: 250000 }, [
      { ...placeholder, sellPrice: 240000 },
    ])).toBe(false);
    expect(isUnconfiguredDefaultVariant({ sellPrice: 250000 }, [
      { ...placeholder, name: "Chai 3kg" },
    ])).toBe(false);
    expect(isUnconfiguredDefaultVariant({ sellPrice: 250000 }, [
      { ...placeholder, bomCode: "BOM-3KG" },
    ])).toBe(false);
    expect(isUnconfiguredDefaultVariant({ sellPrice: 250000 }, [
      placeholder,
      { ...placeholder, id: "variant-2", name: "Thung" },
    ])).toBe(false);
  });
});
