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
    expect(dialog).toContain("saveBOMModifierOptionQuantities(bomId, exactQuantityRows)");
    expect(dialog).toContain("returns it to the legacy model");
  });

  it("does not present the legacy scale factor as the new recipe workflow", () => {
    expect(creationDialog).toContain("Theo lựa chọn FnB");
    expect(creationDialog).toContain("mở lại BOM để khai định lượng thực tế");
    expect(creationDialog).not.toContain("Scale theo modifier");
  });
});
