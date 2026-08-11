import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/app/(main)/tai-chinh/cong-no/page.tsx",
  "utf8",
);

describe("debt list workspace layout", () => {
  it("keeps receivables and payables as separate views", () => {
    expect(page).toContain('value="customer"');
    expect(page).toContain('value="supplier"');
    expect(page).toContain("Phải thu");
    expect(page).toContain("Phải trả");
  });

  it("uses the compact list layout and filter panel", () => {
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain('title="Bộ lọc công nợ"');
    expect(page).toContain('label="Tuổi nợ"');
    expect(page).toContain('label="Khoảng tiền"');
  });

  it("keeps all existing write dialogs wired through the original services", () => {
    expect(page).toContain("bulkImportDebtOpening");
    expect(page).toContain("<SettleDebtDialog");
    expect(page).toContain("<DebtDetailDialog");
    expect(page).toContain("<AuditLogDialog");
  });

  it("keeps one branch-scoped source for both debt sides", () => {
    expect(page).toContain("getDebtWorkspace(activeBranchId)");
    expect(page).toContain("Phạm vi số liệu:");
  });
});
