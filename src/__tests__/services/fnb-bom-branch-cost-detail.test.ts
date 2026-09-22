import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bomService = readFileSync("src/lib/services/supabase/bom.ts", "utf8");
const bomPage = readFileSync("src/app/(main)/hang-hoa/cong-thuc/page.tsx", "utf8");

describe("F&B BOM branch-cost detail", () => {
  it("resolves F&B BOM cost from the branch ledger RPC", () => {
    expect(bomService).toContain('"calculate_fnb_bom_branch_cost_00390"');
    expect(bomService).toContain("p_bom_id: bomId, p_branch_id: branchId");
    expect(bomService).toContain("branch_unit_cost");
  });

  it("identifies both menu F&B and prepared F&B BOMs", () => {
    expect(bomService).toContain("productChannel: (product?.channel");
    expect(bomService).toContain("isFnbStockItem: Boolean(product?.is_fnb_stock_item)");
    expect(bomPage).toContain('fullBom.productChannel === "fnb" || fullBom.isFnbStockItem');
  });

  it("never falls back to Retail global cost when the F&B branch cost is unavailable", () => {
    expect(bomPage).toContain("calculateFnbBOMBranchCost(bomId, activeBranchId)");
    expect(bomPage).toContain("FNB_BRANCH_COST_REQUIRED");
    expect(bomPage).toContain("không dùng giá vốn toàn cục của Retail");
    expect(bomPage).toMatch(/if \(isFnbBom\)[\s\S]*?else \{\s*costBreakdown = await calculateBOMCost/);
  });
});
