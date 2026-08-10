import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardedPages = [
  "src/app/(main)/hang-hoa/page.tsx",
  "src/app/(main)/hang-hoa/nhap-hang/page.tsx",
  "src/app/(main)/hang-hoa/hoa-don-dau-vao/page.tsx",
  "src/app/(main)/hang-hoa/tra-hang-nhap/page.tsx",
  "src/app/(main)/hang-hoa/kiem-kho/page.tsx",
  "src/app/(main)/hang-hoa/xuat-huy/page.tsx",
  "src/app/(main)/hang-hoa/xuat-dung-noi-bo/page.tsx",
  "src/app/(main)/hang-hoa/san-xuat/page.tsx",
];

describe("phạm vi Tất cả chi nhánh của các danh sách kho", () => {
  for (const file of guardedPages) {
    it(`${file} chỉ bỏ lọc chi nhánh khi có quyền hiệu lực`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('"reports.view_all_branches"');
      expect(source).toContain('"system.manage_branches"');
      expect(source).toContain("duocXemToanChuoi");
      expect(source).toContain("if (!activeBranchId && !duocXemToanChuoi)");
      expect(source).not.toMatch(/(?<!duocXemToanChuoi && )viewAllBranches \? undefined/);
    });
  }
});
