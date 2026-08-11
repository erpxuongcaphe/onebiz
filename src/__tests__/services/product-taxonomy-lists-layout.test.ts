import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const categoryPage = readFileSync("src/app/(main)/hang-hoa/nhom/page.tsx", "utf8");
const unitPage = readFileSync(
  "src/app/(main)/hang-hoa/don-vi-tinh/page.tsx",
  "utf8",
);

describe("product taxonomy list layouts", () => {
  it("standardizes product categories without removing category workflows", () => {
    expect(categoryPage).toContain("<ListPageLayout sidebar={null}>");
    expect(categoryPage).toContain('density="compact"');
    expect(categoryPage).toContain('searchPlaceholder="Theo tên hoặc mã nhóm..."');
    expect(categoryPage).toContain('title="Bộ lọc nhóm hàng"');
    expect(categoryPage).toContain("createCategory");
    expect(categoryPage).toContain("updateCategory");
    expect(categoryPage).toContain("deleteCategory");
    expect(categoryPage).toContain("moveCategorySortOrder");
    expect(categoryPage).toContain("<ImportExcelDialog");
  });

  it("keeps category channel and usage filters explicit", () => {
    expect(categoryPage).toContain('label="Kênh áp dụng"');
    expect(categoryPage).toContain('label="Tình trạng sử dụng"');
    expect(categoryPage).toContain("category.code ?? \"\"");
  });

  it("standardizes units while preserving rename and merge workflows", () => {
    expect(unitPage).toContain("<ListPageLayout sidebar={null}>");
    expect(unitPage).toContain('density="compact"');
    expect(unitPage).toContain('title="Bộ lọc đơn vị tính"');
    expect(unitPage).toContain('label="Tình trạng chuẩn hóa"');
    expect(unitPage).toContain('label="Tình trạng sử dụng"');
    expect(unitPage).toContain("renameUnit");
    expect(unitPage).toContain("mergeUnits");
  });
});
