import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(main)/hang-hoa/page.tsx", "utf8");
describe("product page filter wiring", () => {
  it("uses validated dates and the linked supplier name in its shared filter builder", () => {
    expect(page).toContain("resolveListDateRange(createdDatePreset");
    expect(page).toContain("if (!createdDateRange) return null;");
    expect(page).toContain("supplierName: supplierFilter.trim()");
    expect(page).toContain('aria-label="Tên nhà cung cấp"');
    expect(page).not.toContain("suggestions={[]}");
  });
  it("blocks invalid dates before loading, exporting or selecting all matches", () => {
    const load = page.slice(page.indexOf("const fetchData ="), page.indexOf("const fetchStats ="));
    const exportFlow = page.slice(page.indexOf("const handleExport ="), page.indexOf("const handleExport =") + 1800);
    const select = page.slice(page.indexOf("onSelectAllMatching="), page.indexOf("onSelectAllMatching=") + 1000);
    expect(load.indexOf("if (!listFilters)")).toBeLessThan(load.indexOf("await getProducts(query)"));
    expect(exportFlow.indexOf("if (!listFilters)")).toBeLessThan(exportFlow.indexOf("getProductsForExport("));
    expect(select).toContain("if (!listFilters) return [];");
    expect(select).toContain("search: debouncedSearch");
    expect(select).toContain("searchField,");
    expect(page).toContain('key: "supplier"');
    expect(page).toContain('role="alert"');
  });
});
