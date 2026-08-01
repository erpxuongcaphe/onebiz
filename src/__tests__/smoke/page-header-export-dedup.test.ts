import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = [
  "src/app/(main)/hang-hoa/nhap-hang/page.tsx",
  "src/app/(main)/hang-hoa/kiem-kho/page.tsx",
  "src/app/(main)/hang-hoa/xuat-dung-noi-bo/page.tsx",
  "src/app/(main)/hang-hoa/xuat-huy/page.tsx",
];

describe("PageHeader export actions", () => {
  it.each(pages)(
    "%s uses the export menu without a duplicate inert button",
    (path) => {
      const source = readFileSync(path, "utf8");

      expect(source).toContain("onExport={{");
      expect(source).not.toMatch(
        /\{\s*label:\s*["']Xuất file["'],\s*icon:\s*<Icon name=["']download["'][\s\S]*?\}/,
      );
    },
  );
});
