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
    expect(result.toppingIssues).toEqual([
      expect.objectContaining({ code: "SKU-TPP-002", missingPrice: true, missingBom: true }),
    ]);
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

  it("không tính một BOM rỗng là công thức sẵn sàng", () => {
    const result = danhGiaFnbReadiness({
      products: [],
      menuProducts: [
        {
          id: "drink-1",
          code: "CF-001",
          name: "Cà phê đen",
          sell_price: 30_000,
          bom_code: "BOM-CF-001",
          has_bom: true,
        },
      ],
      boms: [
        {
          id: "bom-empty",
          product_id: "drink-1",
          code: "BOM-CF-001",
          branch_id: null,
          has_items: false,
        },
      ],
      groups: [],
      options: [],
      branchId: "branch-a",
    });

    expect(result.simpleProductsMissingBom).toBe(1);
    expect(result.menuIssues).toEqual([
      expect.objectContaining({ code: "CF-001", missingBom: true }),
    ]);
  });

  it("phát hiện nhiều mặc định, hai cách trừ kho và nhóm topping cũ", () => {
    const result = danhGiaFnbReadiness({
      products: [],
      boms: [],
      groups: [
        { id: "sugar", name: "Mức đường", rule: "single" },
        { id: "legacy", name: "Topping", rule: "multi" },
      ],
      options: [
        {
          group_id: "sugar",
          label: "Không đường",
          is_default: true,
          scale_factor: 0,
          linked_product_id: null,
        },
        {
          group_id: "sugar",
          label: "100%",
          is_default: true,
          scale_factor: 1,
          linked_product_id: null,
        },
        {
          group_id: "legacy",
          label: "Cốm xào",
          is_default: false,
          scale_factor: 1,
          linked_product_id: "nvl-1",
        },
      ],
    });

    expect(result.singleGroupsWithManyDefaults).toBe(1);
    expect(result.conflictingStockOptions).toBe(1);
    expect(result.legacyToppingGroups).toBe(1);
    expect(result.configurationIssues).toEqual([
      { type: "many_defaults", groupName: "Mức đường" },
      { type: "legacy_topping", groupName: "Topping" },
      {
        type: "stock_conflict",
        groupName: "Topping",
        optionLabel: "Cốm xào",
      },
    ]);
  });

  it("phân biệt món một giá thiếu BOM, quy cách và trạm bếp trước khi cho vận hành", () => {
    const result = danhGiaFnbReadiness({
      products: [],
      menuProducts: [
        {
          id: "drink-1",
          code: "CF-001",
          name: "Cà phê đen",
          sell_price: 0,
          bom_code: null,
          has_bom: true,
        },
        { id: "drink-2", code: "TS-001", name: "Trà sữa", sell_price: 0, bom_code: null },
      ],
      variants: [
        {
          id: "size-m",
          product_id: "drink-2",
          name: "M",
          sell_price: 35_000,
          bom_code: "BOM-TS-M",
          is_default: true,
        },
        {
          id: "size-l",
          product_id: "drink-2",
          name: "L",
          sell_price: 0,
          bom_code: null,
          is_default: false,
        },
      ],
      boms: [{ product_id: null, code: "BOM-TS-M", branch_id: "branch-a" }],
      groups: [],
      options: [],
      branchId: "branch-a",
      activeKitchenStations: 0,
      activeTables: 0,
    });

    expect(result).toMatchObject({
      menuTotal: 2,
      simpleProductsMissingPrice: 1,
      simpleProductsMissingBom: 1,
      variantsTotal: 2,
      variantsMissingPrice: 1,
      variantsMissingBom: 1,
      variantProductsWithInvalidDefaults: 0,
      activeKitchenStations: 0,
    });
    expect(result.menuIssues).toEqual([
      expect.objectContaining({ code: "CF-001", missingPrice: true, missingBom: true }),
      expect.objectContaining({ code: "TS-001", variantName: "L", missingPrice: true, missingBom: true }),
    ]);
  });

  it("không biến topping SKU đang tắt thành điều kiện chặn vận hành", () => {
    const result = danhGiaFnbReadiness({
      products: [
        { id: "t1", code: "SKU-TPP-001", name: "Trân châu", sell_price: 0, bom_code: null },
      ],
      menuProducts: [
        { id: "drink", code: "CF-001", name: "Cà phê", sell_price: 30_000, bom_code: null },
      ],
      variants: [],
      boms: [],
      groups: [],
      options: [],
      toppingSkuEnabled: false,
      activeKitchenStations: 1,
    });

    expect(result.toppingMissingPrice).toBe(1);
    expect(result.toppingSkuEnabled).toBe(false);
    expect(result.menuIssues).toEqual([]);
  });
});
