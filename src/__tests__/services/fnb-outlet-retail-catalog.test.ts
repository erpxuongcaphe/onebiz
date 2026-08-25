import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  "src/lib/services/supabase/products.ts",
  "utf8",
);
const page = readFileSync("src/app/(main)/hang-hoa/page.tsx", "utf8");

describe("F&B outlet Retail ingredient catalog", () => {
  it("derives the outlet catalog from active Retail SKUs instead of stock rows", () => {
    expect(service).toContain(
      'return query.or("channel.eq.fnb,channel.eq.retail")',
    );
    expect(service).not.toContain("stockedIds");
    expect(service).not.toMatch(
      /getBranchIndustryScope[\s\S]{0,1200}\.from\("branch_stock"\)/,
    );
  });

  it("does not create fake branch stock while making never-received SKUs visible", () => {
    expect(page).toContain('"Thành phần tại quán"');
    expect(page).toContain('"Món F&B"');
    expect(page).toContain("Chưa nhập");
    expect(page).toMatch(
      /scope === "nvl"\s*\? "retail"\s*:\s*"fnb"/,
    );
    expect(service).not.toMatch(/\.from\("branch_stock"\)[\s\S]{0,180}\.insert\(/);
    expect(service).not.toMatch(/\.from\("branch_stock"\)[\s\S]{0,180}\.upsert\(/);
  });

  it("keeps list, bulk selection and KPIs on the same branch-aware catalog", () => {
    expect(page).toContain("filters: buildListFilters()");
    expect(page).toContain("getProductStats(catalogProductType");
    expect(page).toContain("branchId: branchStockView ? activeBranchId : undefined");
    expect(service).toContain('branchId ? ", branch_stock(quantity)" : ""');
    expect(service).toContain("typedRow.branch_stock?.[0]?.quantity ?? 0");
  });

  it("clears incompatible category and brand filters when switching outlet views", () => {
    expect(page).toMatch(
      /setCategoryFilter\("all"\);\s*setBrandFilter\("all"\);/,
    );
  });
});
