import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(main)/phan-tich/cuoi-ngay/page.tsx", "utf8");

describe("end-of-day quantity contract", () => {
  it("does not expose a mixed-unit daily quantity as a management total", () => {
    expect(page).not.toMatch(/key:\s*"soldQty"/);
    expect(page).toContain('label="Doanh số hóa đơn"');
  });

  it("links unit-specific SKU detail with the active branch and date range", () => {
    expect(page).toContain("/phan-tich/sku-chi-tiet?");
    expect(page).toContain('preset: "custom", from: range.from, to: range.to');
    expect(page).toContain('branch: activeBranchId');
  });
});
