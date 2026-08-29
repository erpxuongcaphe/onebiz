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
  /** Group that chooses an exact measured amount, for example Mức đường. */
  scaleTarget?: string | null;
  /** Variant key → option id → measured preparation quantity. */
  exactQty?: Record<string, Record<string, number>>;
}

export interface FnbModifierOptionSetup {
  id: string;
  isDefault: boolean;
}

export type FnbSetupIssueCode =
  | "variant_name_required"
  | "variant_name_duplicate"
  | "variant_default_invalid"
  | "variant_price_invalid"
  | "recipe_disabled"
  | "recipe_unit_required"
  | "recipe_quantity_invalid"
  | "recipe_modifier_options_missing"
  | "recipe_modifier_default_invalid"
  | "recipe_modifier_quantity_invalid"
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
  modifierOptionsByGroup?: Record<string, FnbModifierOptionSetup[]>;
}

export function validateFnbVariantSetup(
  input: ValidateFnbVariantSetupInput,
): FnbSetupIssue[] {
  const {
    isFnb,
    variants,
    recipeEnabled,
    recipeRows,
    modifierOptionsByGroup = {},
  } = input;
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

  const getDefaultOption = (row: FnbRecipeSetupRow) => {
    if (!row.scaleTarget) return null;
    const options = modifierOptionsByGroup[row.scaleTarget] ?? [];
    const defaults = options.filter((option) => option.isDefault);
    return defaults.length === 1 ? defaults[0] : null;
  };

  const modifierRows = selectedRows.filter((row) => row.scaleTarget);
  const missingModifierOptions = modifierRows.find(
    (row) => (modifierOptionsByGroup[row.scaleTarget ?? ""] ?? []).length === 0,
  );
  if (missingModifierOptions) {
    issues.push({
      code: "recipe_modifier_options_missing",
      message: "Nhóm tùy chọn gắn với công thức chưa có lựa chọn đang bật. Mở tab Tùy chọn FnB để kiểm tra lại.",
    });
  }

  const invalidModifierDefault = modifierRows.find((row) => !getDefaultOption(row));
  if (invalidModifierDefault) {
    issues.push({
      code: "recipe_modifier_default_invalid",
      message: "Nhóm tùy chọn dùng trong công thức đang có 0 hoặc nhiều hơn 1 mặc định. Vào Danh mục → Tùy chọn món FnB và chỉ giữ đúng một lựa chọn mặc định.",
    });
  }

  const invalidQuantity = selectedRows.some((row) =>
    variants.some((variant) => {
      const quantity = row.scaleTarget
        ? row.exactQty?.[variant.key]?.[getDefaultOption(row)?.id ?? ""] ?? 0
        : row.qty[variant.key] ?? 0;
      return !Number.isFinite(quantity) || quantity < 0;
    }),
  );
  if (invalidQuantity) {
    issues.push({
      code: "recipe_quantity_invalid",
      message: "Định lượng nguyên liệu phải là số hợp lệ và không được âm.",
    });
  }

  const invalidExactQuantity = modifierRows.some((row) => {
    const options = modifierOptionsByGroup[row.scaleTarget ?? ""] ?? [];
    return variants.some((variant) =>
      options.some((option) => {
        const quantity = row.exactQty?.[variant.key]?.[option.id];
        return quantity === undefined || !Number.isFinite(quantity) || quantity < 0;
      }),
    );
  });
  if (invalidExactQuantity) {
    issues.push({
      code: "recipe_modifier_quantity_invalid",
      message: "Nhập định lượng riêng cho mọi cỡ và mọi mức lựa chọn; nhập 0 khi mức đó không dùng nguyên liệu.",
    });
  }

  const missingRecipe = variants.find(
    (variant) =>
      !selectedRows.some((row) => {
        const quantity = row.scaleTarget
          ? row.exactQty?.[variant.key]?.[getDefaultOption(row)?.id ?? ""] ?? 0
          : row.qty[variant.key] ?? 0;
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
