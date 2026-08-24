import { describe, expect, it } from "vitest";
import { validateFnbVariantSetup } from "@/lib/fnb-product-setup-validation";

const variants = [
  { key: "m", name: "M", sellPrice: 35_000, isDefault: true },
  { key: "l", name: "L", sellPrice: 42_000, isDefault: false },
];

const recipeRows = [
  {
    materialId: "coffee",
    unit: "g",
    qty: { m: 18, l: 25 },
  },
];

describe("validateFnbVariantSetup", () => {
  it("cho phép món FnB M/L khi mỗi cỡ có giá và công thức riêng", () => {
    expect(
      validateFnbVariantSetup({
        isFnb: true,
        variants,
        recipeEnabled: true,
        recipeRows,
      }),
    ).toEqual([]);
  });

  it("không ép công thức quy cách cho món một giá hoặc SKU Retail", () => {
    expect(
      validateFnbVariantSetup({
        isFnb: true,
        variants: [],
        recipeEnabled: false,
        recipeRows: [],
      }),
    ).toEqual([]);
    expect(
      validateFnbVariantSetup({
        isFnb: false,
        variants,
        recipeEnabled: false,
        recipeRows: [],
      }),
    ).toEqual([]);
  });

  it("chặn tên trống và tên quy cách trùng không phân biệt hoa thường", () => {
    const issues = validateFnbVariantSetup({
      isFnb: true,
      variants: [
        { ...variants[0], name: " " },
        { ...variants[1], name: "m" },
      ],
      recipeEnabled: true,
      recipeRows,
    });

    expect(issues.map((issue) => issue.code)).toContain("variant_name_required");
    expect(issues.map((issue) => issue.code)).not.toContain("variant_name_duplicate");

    const duplicateIssues = validateFnbVariantSetup({
      isFnb: true,
      variants: [
        { ...variants[0], name: "M" },
        { ...variants[1], name: "m" },
      ],
      recipeEnabled: true,
      recipeRows,
    });
    expect(duplicateIssues.map((issue) => issue.code)).toContain(
      "variant_name_duplicate",
    );
  });

  it("chặn khi không có hoặc có nhiều hơn một quy cách mặc định", () => {
    for (const defaults of [
      [false, false],
      [true, true],
    ]) {
      const issues = validateFnbVariantSetup({
        isFnb: true,
        variants: variants.map((variant, index) => ({
          ...variant,
          isDefault: defaults[index],
        })),
        recipeEnabled: true,
        recipeRows,
      });
      expect(issues.map((issue) => issue.code)).toContain(
        "variant_default_invalid",
      );
    }
  });

  it("chặn giá quy cách bằng 0, âm hoặc không phải số", () => {
    for (const sellPrice of [0, -1, Number.NaN]) {
      const issues = validateFnbVariantSetup({
        isFnb: true,
        variants: [{ ...variants[0], sellPrice }],
        recipeEnabled: true,
        recipeRows: [{ ...recipeRows[0], qty: { m: 18 } }],
      });
      expect(issues.map((issue) => issue.code)).toContain(
        "variant_price_invalid",
      );
    }
  });

  it("chặn món có quy cách nhưng chưa bật công thức từng cỡ", () => {
    const issues = validateFnbVariantSetup({
      isFnb: true,
      variants,
      recipeEnabled: false,
      recipeRows: [],
    });
    expect(issues.map((issue) => issue.code)).toContain("recipe_disabled");
  });

  it("chặn nguyên liệu thiếu đơn vị và định lượng âm", () => {
    const issues = validateFnbVariantSetup({
      isFnb: true,
      variants,
      recipeEnabled: true,
      recipeRows: [
        {
          materialId: "coffee",
          unit: " ",
          qty: { m: 18, l: -1 },
        },
      ],
    });
    expect(issues.map((issue) => issue.code)).toContain("recipe_unit_required");
    expect(issues.map((issue) => issue.code)).toContain(
      "recipe_quantity_invalid",
    );
  });

  it("chặn riêng cỡ chưa có nguyên liệu với định lượng dương", () => {
    const issues = validateFnbVariantSetup({
      isFnb: true,
      variants,
      recipeEnabled: true,
      recipeRows: [{ ...recipeRows[0], qty: { m: 18, l: 0 } }],
    });
    expect(issues).toContainEqual({
      code: "variant_recipe_missing",
      message: "Quy cách L chưa có nguyên liệu với định lượng lớn hơn 0.",
    });
  });
});
