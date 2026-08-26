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

  it("does not present the legacy scale factor as the new recipe workflow", () => {
    expect(creationDialog).toContain("Theo lựa chọn FnB");
    expect(creationDialog).toContain("mở lại BOM để khai định lượng thực tế");
    expect(creationDialog).not.toContain("Scale theo modifier");
  });
});
