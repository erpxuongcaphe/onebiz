import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("report export completion guards", () => {
  for (const report of ["hang-hoa", "nha-cung-cap", "xuat-nhap-ton"]) {
    it(`${report} waits for both Excel exports and releases the busy state`, () => {
      const source = readFileSync(resolve(`src/app/(main)/phan-tich/${report}/page.tsx`), "utf8");
      for (const handler of ["handleExportView", "handleExportFull"]) {
        const start = source.indexOf(`const ${handler} = useCallback(`);
        const next = source.indexOf("\n  const ", start + 1);
        const body = source.slice(start, next);
        expect(body).toContain("useCallback(async () =>");
        expect(body).toContain("if (exporting) return;");
        expect(body).toContain("setExporting(true);");
        expect(body).toContain("await exportReportToExcel(");
        expect(body).toContain("finally {");
        expect(body).toContain("setExporting(false);");
        expect(body.indexOf("await exportReportToExcel(")).toBeLessThan(body.indexOf('toast({ title: "Đã xuất'));
      }
      expect(source).toMatch(/exportDisabled=\{[^}]*exporting/);
    });
  }

  it("financial analysis never exports failed or stale data", () => {
    const source = readFileSync(resolve("src/app/(main)/phan-tich/tai-chinh/page.tsx"), "utf8");
    expect(source.match(/if \(exporting \|\| loading \|\| loadError \|\| !kpis\) return;/g)).toHaveLength(2);
    expect(source.match(/await exportReportToExcel\(/g)).toHaveLength(2);
    expect(source.match(/setExporting\(false\)/g)).toHaveLength(2);
    expect(source).toContain("setKpis(null);");
    expect(source).toContain('role="alert"');
    expect(source).toContain("void fetchData()");
    expect(source).toContain('defaultViewMode: "table"');
    expect(source).toContain("rows={visibleTrend}");
    expect(source).toContain("rows: visibleTrend.map");
    expect(source).toContain("sortState={trendSort}");
    expect(source).toContain('key: "cogs"');
  });
});
