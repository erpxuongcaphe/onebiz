import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pages = [
  "src/app/(main)/hang-hoa/hsd/page.tsx",
  "src/app/(main)/hang-hoa/lo-san-xuat/page.tsx",
  "src/app/(main)/hang-hoa/lich-su-kho/page.tsx",
];

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("warehouse data list standardization", () => {
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

  it("keeps the HSD threshold filter", () => {
    const page = source(pages[0]);
    expect(page).toContain('label="Ngưỡng cảnh báo (ngày)"');
    expect(page).toContain("setThresholdDays");
  });

  it("keeps lot status and source filters", () => {
    const page = source(pages[1]);
    expect(page).toContain('<FilterGroup label="Trạng thái">');
    expect(page).toContain('<FilterGroup label="Nguồn">');
  });

  it("keeps stock history branch, document type and custom date filters", () => {
    const page = source(pages[2]);
    expect(page).toContain('<FilterGroup label="Loại phiếu">');
    expect(page).toContain('<FilterGroup label="Chi nhánh">');
    expect(page).toContain('<FilterGroup label="Thời gian">');
    expect(page).toContain('datePreset === "custom"');
    expect(page).toContain('handleExport("excel")');
    expect(page).toContain('handleExport("csv")');
  });
});
