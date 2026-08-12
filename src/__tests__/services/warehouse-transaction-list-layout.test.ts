import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pages = [
  "src/app/(main)/hang-hoa/xuat-huy/page.tsx",
  "src/app/(main)/hang-hoa/xuat-dung-noi-bo/page.tsx",
  "src/app/(main)/hang-hoa/tra-hang-nhap/page.tsx",
  "src/app/(main)/hang-hoa/kiem-kho/page.tsx",
];

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("warehouse transaction list standardization", () => {
  it.each(pages)("uses the compact list shell on %s", (path) => {
    const page = source(path);
    expect(page).toContain("<ListPageLayout sidebar={null}>");
    expect(page).toContain('density="compact"');
    expect(page).toContain("<FilterPanel");
    expect(page).toContain("<FilterChips");
    expect(page).toContain("toolbarMetrics=");
    expect(page).toContain("toolbarActions=");
    expect(page).not.toContain("<FilterSidebar>");
    expect(page).not.toContain("<SummaryCard");
  });

  it.each(pages)("keeps custom dates and status filters on %s", (path) => {
    const page = source(path);
    expect(page).toContain("<DatePresetFilter");
    expect(page).toMatch(/<FilterGroup label="(?:Thời gian|Ngày tạo)"/);
    expect(page).toContain('<FilterGroup label="Trạng thái"');
    expect(page).toContain('datePreset === "custom"');
  });

  it("labels whole-filter metrics honestly", () => {
    const combined = pages.map(source).join("\n");
    expect(combined).toContain("Toàn bộ kết quả lọc");
    expect(combined).not.toContain("Phiếu tạm trang này");
    expect(combined).not.toContain("Hoàn thành trang này");
    expect(combined).not.toContain("Chênh lệch trang này");
    expect(combined).not.toContain("Chỉ tính các dòng đang hiển thị");

    const disposal = source("src/app/(main)/hang-hoa/xuat-huy/page.tsx");
    expect(disposal).toContain("Giá trị tổn thất");
    expect(disposal).toContain("Toàn bộ kết quả lọc");
    expect(disposal).not.toContain("Giá trị trang này");
  });
});
