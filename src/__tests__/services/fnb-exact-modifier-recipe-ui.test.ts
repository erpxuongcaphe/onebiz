import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(
  resolve(process.cwd(), "src/components/shared/dialogs/bom-editor-dialog.tsx"),
  "utf8",
);
const creationDialog = readFileSync(
  resolve(process.cwd(), "src/components/shared/dialogs/create-product-dialog.tsx"),
  "utf8",
);
const perSizeMatrix = readFileSync(
  resolve(process.cwd(), "src/components/shared/dialogs/per-size-recipe-matrix.tsx"),
  "utf8",
);
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/00350_fnb_exact_modifier_bom_quantities.sql"),
  "utf8",
);

describe("FnB exact modifier recipe UI", () => {
  it("validates every active choice before it writes the base BOM", () => {
    expect(dialog).toContain("function buildExactQuantityRows()");
    expect(migration).toContain("FNB_EXACT_RECIPE_GROUP_INCOMPLETE");
    expect(dialog).toContain("Nhập 0 cho lựa chọn không tiêu hao");
    expect(dialog.indexOf("buildExactQuantityRows()", dialog.indexOf("async function handleSave")))
      .toBeLessThan(dialog.indexOf("await updateBOM"));
  });

  it("keeps clearing mappings explicit and uses the atomic save RPC", () => {
    expect(dialog).toContain("saveBOMModifierOptionQuantities(savedBomId, exactQuantityRows)");
    expect(dialog).toContain("returns it to the legacy model");
  });

  it("lets a BOM line choose only a modifier group that the POS can show for this SKU", () => {
    expect(dialog).toContain("getEffectiveModifierGroupsForProduct");
    expect(dialog).toContain("selectableModifierGroups");
    expect(dialog).toContain("Định lượng theo lựa chọn");
    expect(dialog).toContain("modifierScaleTarget: it.modifierScaleTarget ?? null");
    expect(dialog).toContain("chưa áp dụng cho SKU này");
  });

  it("can save the base recipe and exact choices in the same creation flow", () => {
    expect(dialog).toContain("const exactQuantityRows = buildExactQuantityRows()");
    expect(dialog).toContain("if (exactQuantityRows !== null)");
    expect(dialog).toContain("saveBOMModifierOptionQuantities(savedBomId, exactQuantityRows)");
    expect(dialog).toContain("{exactTargets.length > 0 && (");
  });

  it("keeps the exact recipe editor in preparation units while the server normalizes stock units", () => {
    expect(dialog).toContain("getRecipeQuantityInInputUnit");
    expect(dialog).toContain("getRecipeQuantityInStockUnit");
    expect(dialog).toContain("inputQuantity: Number(row.value)");
    expect(dialog).toContain("inputUnit: item.unit");
    expect(dialog).toContain("Nhập theo đơn vị pha chế của BOM");
    expect(dialog).toContain("Trừ ${formatRecipeQuantity(stockQuantity)} ${item.stockUnit}");
  });

  it("keeps the compact product form on the same exact-recipe workflow", () => {
    expect(creationDialog).toContain("Theo lựa chọn FnB");
    expect(creationDialog).toContain("Định lượng riêng theo lựa chọn FnB");
    expect(creationDialog).toContain("function buildInlineExactQuantityRows()");
    expect(creationDialog).toContain("saveBOMModifierOptionQuantities(");
    expect(creationDialog).toContain("Update the existing BOM in place");
    expect(creationDialog).toContain("Pha chế {formatRecipeQuantity(it.quantity)} {it.unit}");
    expect(creationDialog).toContain("getRecipeQuantityInInputUnit");
    expect(creationDialog).toContain("getRecipeQuantityInStockUnit");
    expect(creationDialog).not.toContain("mở lại BOM để khai định lượng thực tế");
    expect(creationDialog).not.toContain("Scale theo modifier");
  });

  it("lets an operator save exact modifier quantities for every size in one pass", () => {
    expect(perSizeMatrix).toContain("exactQty: Record<string, Record<string, number>>");
    expect(perSizeMatrix).toContain("Định lượng riêng:");
    expect(perSizeMatrix).toContain("setExactQty(");
    expect(perSizeMatrix).not.toContain("lưu rồi mở lại BOM để khai định lượng riêng");
    expect(creationDialog).toContain("function buildPerSizeExactQuantityRows(variantKey: string)");
    expect(creationDialog).toContain("buildPerSizeExactQuantityRows(v.key)");
    expect(creationDialog).toContain("await saveFnbSizeSetupAtomic(productId, payload)");
    expect(creationDialog).toContain("exactRows: buildPerSizeExactQuantityRows(v.key)");
    expect(creationDialog).not.toContain("async function syncPerSizeRecipes(");
  });

  it("keeps long material names and incomplete exact quantities clear in the size editor", () => {
    expect(perSizeMatrix).toContain('aria-label={`Đổi nguyên liệu ${selected.code} · ${selected.name}`}');
    expect(perSizeMatrix).toContain("whitespace-normal break-words");
    expect(perSizeMatrix).toContain("Còn {missingExactCount} ô chưa nhập");
    expect(perSizeMatrix).toContain("Nhập 0 nếu mức đó không dùng nguyên liệu");
    expect(creationDialog).toContain("Thiết lập chi nhánh");
  });
});
