import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(
  resolve(process.cwd(), "src/components/shared/dialogs/create-product-dialog.tsx"),
  "utf8",
);
const bomService = readFileSync(
  resolve(process.cwd(), "src/lib/services/supabase/bom.ts"),
  "utf8",
);

describe("product dialog draft and inline BOM flow", () => {
  it("keeps FnB choices in one product draft until the final Save", () => {
    expect(dialog).toContain("const initializedDialogKeyRef = useRef<string | null>(null)");
    expect(dialog).toContain("const loadedModifierDraftKeyRef = useRef<string | null>(null)");
    expect(dialog).toContain("const loadedMenuScopeKeyRef = useRef<string | null>(null)");
    expect(dialog).toContain("if (loadedModifierDraftKeyRef.current !== dialogProductKey)");
    expect(dialog).toContain("if (loadedMenuScopeKeyRef.current === initialData.id) return");
    expect(dialog).toContain("if (loadedVariantsKeyRef.current === initialData.id) return");
    expect(dialog).toContain("const [fnbMenuScopeDirty, setFnbMenuScopeDirty] = useState(false)");
    expect(dialog).toContain("const shouldSaveFnbMenuScope =");
    expect(dialog).toContain("await saveFnbMenuScopeDraft(initialData.id)");
    expect(dialog).toContain("Phạm vi menu sẽ được lưu cùng nút Lưu bên dưới.");
    expect(dialog).not.toContain("Lưu phạm vi menu");
  });

  it("makes exact quantities compulsory as soon as an FnB choice group is linked", () => {
    expect(dialog).toContain("if (v) setBomExactRecipeEnabled(true)");
    expect(dialog).toContain("Bắt buộc dùng định lượng riêng");
    expect(dialog).toContain("savedQuantities.length > 0 || loadedItems.some((item) => item.modifierScaleTarget)");
    expect(dialog).not.toContain("if (!bomExactRecipeEnabled) return []");
  });

  it("explains global recipes versus one-branch overrides without cloning recipes", () => {
    expect(dialog).toContain("Phạm vi công thức");
    expect(dialog).toContain("Dùng chung cho mọi chi nhánh bán món này");
    expect(dialog).toContain("Ghi đè riêng:");
    expect(dialog).toContain("chọn nhiều quán tại tab Tùy chọn FnB");
  });

  it("generates and persists a BOM code for new or legacy inline recipes", () => {
    expect(dialog).toContain("function getAutomaticBomCode(");
    expect(dialog).toContain("Hệ thống tự sinh khi lưu công thức mới");
    expect(dialog).toContain("code: getAutomaticBomCode(code, bomBranchId, branches)");
    expect(dialog).toContain("bomExistingCode ??");
    expect(bomService).toContain("if (updates.code !== undefined) updateObj.code = updates.code");
    expect(dialog).toContain("initialData?.bomCode ? null : undefined");
  });

  it("writes exact FnB quantities in the same create flow as the BOM", () => {
    expect(dialog).toContain("const createdBom = await createBOM({");
    expect(dialog).toContain("await saveBOMModifierOptionQuantities(");
    expect(dialog).toContain("createdBom.id,");
  });
});
