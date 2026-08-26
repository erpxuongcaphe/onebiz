import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pos = readFileSync("src/app/pos/fnb/page.tsx", "utf8");
const cache = readFileSync("src/lib/offline/cache-manager.ts", "utf8");
const dialog = readFileSync("src/components/shared/dialogs/create-product-dialog.tsx", "utf8");

describe("FnB branch menu UI contract", () => {
  it("filters the fresh POS catalog with the server-backed branch whitelist", () => {
    expect(pos).toContain("listFnbProductBranchMenuScopes(tenantId)");
    expect(pos).toContain("getFnbMenuScopeFingerprint(menuScopes)");
    expect(pos).toContain("filterFnbProductsForBranch(");
  });

  it("keeps IndexedDB cache branch-scoped and invalidates it when scope changes", () => {
    expect(cache).toContain("branchId?: string");
    expect(cache).toContain("scope_fingerprint");
    expect(cache).toContain("record.branchId !== cachedBranchId");
    expect(cache).toContain("cachedFingerprint !== scopeFingerprint");
  });

  it("gives product editors a separate, explicit branch-menu save action", () => {
    expect(dialog).toContain("Menu FnB theo chi nhánh");
    expect(dialog).toContain("saveFnbProductBranchMenuScope");
    expect(dialog).toContain("Lưu phạm vi menu");
    expect(dialog).toContain("không làm thay đổi tồn kho, giá hoặc BOM");
  });
});
