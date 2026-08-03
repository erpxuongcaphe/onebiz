import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/app/(main)/tai-chinh/cong-no/page.tsx",
  "utf8",
);

const service = readFileSync(
  "src/lib/services/supabase/debt.ts",
  "utf8",
);

const dataTable = readFileSync(
  "src/components/shared/data-table/data-table.tsx",
  "utf8",
);

describe("debt aging report UI", () => {
  it("separates receivables and payables into independent sections", () => {
    expect(page).toContain("Phải thu khách hàng");
    expect(page).toContain("Phải trả nhà cung cấp");
    expect(page).toContain("Xuất phải thu");
    expect(page).toContain("Xuất phải trả");
    expect(page).toContain('<span className="sm:hidden">Phải thu</span>');
    expect(page).toContain('<span className="sm:hidden">Phải trả</span>');
    expect(page).toContain('<span className="sm:hidden">Tuổi nợ</span>');
    expect(page).toContain('"tuoi-no-phai-thu"');
    expect(page).toContain('"tuoi-no-phai-tra"');
  });

  it("does not leave the aging tab stuck after a load failure", () => {
    // 03/08 — trang gộp về 1 nguồn getDebtWorkspace: lỗi dùng loadError chung
    expect(page).toContain("setLoadError(");
    expect(page).toContain("Không tải được phân tích tuổi nợ");
    expect(page).toContain("Chưa có dữ liệu tuổi nợ");
    expect(page).not.toContain("agingLoading || !aging");
    expect(page).toContain("REPORT_LOAD_TIMEOUT_MS = 15_000");
    expect(page).toContain("withReportTimeout(");
  });

  it("does not duplicate the DataTable action column", () => {
    expect(page).toContain('id: "debt_actions"');
    expect(page).not.toContain('id: "actions"');
    expect(dataTable).toContain('id: "row_actions"');
    expect(dataTable).not.toContain('id: "actions"');
  });

  it("keeps a separate result limit for customers and suppliers", () => {
    expect(service).not.toContain(".slice(0, limit)");
  });
});
