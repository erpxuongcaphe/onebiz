export interface FnbVariantSetupDraft {
  key: string;
  name: string;
  sellPrice: number;
  isDefault: boolean;
}

export interface FnbRecipeSetupRow {
  materialId: string;
  unit: string;
  qty: Record<string, number>;
}

export type FnbSetupIssueCode =
  | "variant_name_required"
  | "variant_name_duplicate"
  | "variant_default_invalid"
  | "variant_price_invalid"
  | "recipe_disabled"
  | "recipe_unit_required"
  | "recipe_quantity_invalid"
  | "variant_recipe_missing";

export interface FnbSetupIssue {
  code: FnbSetupIssueCode;
  message: string;
}

interface ValidateFnbVariantSetupInput {
  isFnb: boolean;
  variants: FnbVariantSetupDraft[];
  recipeEnabled: boolean;
  recipeRows: FnbRecipeSetupRow[];
}

export function validateFnbVariantSetup(
  input: ValidateFnbVariantSetupInput,
): FnbSetupIssue[] {
  const { isFnb, variants, recipeEnabled, recipeRows } = input;
  if (!isFnb || variants.length === 0) return [];

  const issues: FnbSetupIssue[] = [];
  const normalizedNames = variants.map((variant) =>
    variant.name.trim().toLocaleLowerCase("vi"),
  );

  if (normalizedNames.some((name) => !name)) {
    issues.push({
      code: "variant_name_required",
      message: "Mỗi quy cách phải có tên, ví dụ M, L hoặc XL.",
    });
  }

  const uniqueNames = new Set(normalizedNames.filter(Boolean));
  if (uniqueNames.size !== normalizedNames.filter(Boolean).length) {
    issues.push({
      code: "variant_name_duplicate",
      message: "Tên quy cách không được trùng nhau.",
    });
  }

  if (variants.filter((variant) => variant.isDefault).length !== 1) {
    issues.push({
      code: "variant_default_invalid",
      message: "Chọn đúng một quy cách mặc định.",
    });
  }

  const invalidPrice = variants.find(
    (variant) => !Number.isFinite(variant.sellPrice) || variant.sellPrice <= 0,
  );
  if (invalidPrice) {
    issues.push({
      code: "variant_price_invalid",
      message: `Giá bán quy cách ${invalidPrice.name.trim() || "chưa đặt tên"} phải lớn hơn 0.`,
    });
  }

  if (!recipeEnabled) {
    issues.push({
      code: "recipe_disabled",
      message: "Món có quy cách phải bật công thức riêng cho từng cỡ.",
    });
    return issues;
  }

  const selectedRows = recipeRows.filter((row) => row.materialId);
  const missingUnit = selectedRows.find((row) => !row.unit.trim());
  if (missingUnit) {
    issues.push({
      code: "recipe_unit_required",
      message: "Mỗi nguyên liệu đã chọn phải có đơn vị tính.",
    });
  }

  const invalidQuantity = selectedRows.some((row) =>
    variants.some((variant) => {
      const quantity = row.qty[variant.key] ?? 0;
      return !Number.isFinite(quantity) || quantity < 0;
    }),
  );
  if (invalidQuantity) {
    issues.push({
      code: "recipe_quantity_invalid",
      message: "Định lượng nguyên liệu phải là số hợp lệ và không được âm.",
    });
  }

  const missingRecipe = variants.find(
    (variant) =>
      !selectedRows.some((row) => {
        const quantity = row.qty[variant.key] ?? 0;
        return Number.isFinite(quantity) && quantity > 0;
      }),
  );
  if (missingRecipe) {
    issues.push({
      code: "variant_recipe_missing",
      message: `Quy cách ${missingRecipe.name.trim() || "chưa đặt tên"} chưa có nguyên liệu với định lượng lớn hơn 0.`,
    });
  }

  return issues;
}
