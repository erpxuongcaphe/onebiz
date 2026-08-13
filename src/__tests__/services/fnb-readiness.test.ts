import { describe, expect, it } from "vitest";
import { danhGiaFnbReadiness } from "@/lib/services/supabase/fnb-readiness";

describe("danhGiaFnbReadiness", () => {
  it("đếm riêng topping thiếu giá, thiếu BOM và topping dùng được", () => {
    const result = danhGiaFnbReadiness({
      products: [
        {
          id: "p1",
          code: "SKU-TPP-001",
          name: "A",
          sell_price: 8_000,
          bom_code: null,
        },
        {
          id: "p2",
          code: "SKU-TPP-002",
          name: "B",
          sell_price: 0,
          bom_code: null,
        },
        {
          id: "p3",
          code: "SKU-TPP-003",
          name: "C",
          sell_price: 9_000,
          bom_code: "BOM-C",
        },
      ],
      boms: [
        { product_id: "p1", code: null, branch_id: null },
        { product_id: null, code: "BOM-C", branch_id: "branch-a" },
      ],
      groups: [],
      options: [],
      branchId: "branch-a",
      toppingSkuEnabled: false,
    });

    expect(result).toMatchObject({
      toppingTotal: 3,
      toppingReady: 2,
      toppingMissingPrice: 1,
      toppingMissingBom: 1,
      toppingSkuEnabled: false,
    });
  });

  it("không tính BOM riêng của chi nhánh khác", () => {
    const result = danhGiaFnbReadiness({
      products: [
        {
          id: "p1",
          code: "SKU-TPP-001",
          name: "A",
          sell_price: 8_000,
          bom_code: null,
        },
      ],
      boms: [{ product_id: "p1", code: null, branch_id: "branch-b" }],
      groups: [],
      options: [],
      branchId: "branch-a",
    });

    expect(result.toppingReady).toBe(0);
    expect(result.toppingMissingBom).toBe(1);
  });

  it("phát hiện nhiều mặc định, hai cách trừ kho và nhóm topping cũ", () => {
    const result = danhGiaFnbReadiness({
      products: [],
      boms: [],
      groups: [
        { id: "sugar", rule: "single" },
        { id: "legacy", rule: "multi" },
      ],
      options: [
        {
          group_id: "sugar",
          is_default: true,
          scale_factor: 0,
          linked_product_id: null,
        },
        {
          group_id: "sugar",
          is_default: true,
          scale_factor: 1,
          linked_product_id: null,
        },
        {
          group_id: "legacy",
          is_default: false,
          scale_factor: 1,
          linked_product_id: "nvl-1",
        },
      ],
    });

    expect(result.singleGroupsWithManyDefaults).toBe(1);
    expect(result.conflictingStockOptions).toBe(1);
    expect(result.legacyToppingGroups).toBe(1);
  });
});
