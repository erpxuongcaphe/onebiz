import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/app/(main)/hang-hoa/hang-cap-fnb/page.tsx", "utf8");
const service = readFileSync("src/lib/services/supabase/fnb-branch-cost.ts", "utf8");
const productDialog = readFileSync("src/components/shared/dialogs/create-product-dialog.tsx", "utf8");
const bomEditor = readFileSync("src/components/shared/dialogs/bom-editor-dialog.tsx", "utf8");

describe("F&B branch opening cost UI", () => {
  it("uses the audited branch RPC instead of a writable table call", () => {
    expect(service).toContain('rpc("set_fnb_branch_opening_cost_00390"');
    expect(service).toContain("p_reason: reason.trim()");
    expect(service).not.toContain('.insert(');
    expect(service).not.toContain('.update(');
  });

  it("keeps prepared stock in scope but excludes menu-only SKUs", () => {
    expect(service).toContain('neq("products.inventory_role", "fnb_menu_item")');
    expect(service).not.toContain('eq("products.is_fnb_stock_item", false)');
  });

  it("does not offer an opening-cost write after cost events already exist", () => {
    expect(service).toContain("canConfirmOpeningCost: !productsWithEvents.has(row.product_id) && costedQuantity === 0");
    expect(page).toContain("row.canConfirmOpeningCost && <Button");
    expect(page).toContain("Cần rà soát lệch");
  });

  it("never writes a branch estimate to the shared product cost while saving a recipe", () => {
    expect(productDialog).toContain("costPrice: canViewCost && !usesFnbRecipeCosts ? representativeCostPrice : undefined");
    expect(productDialog).toContain("costPrice: v.costPrice");
    expect(productDialog).not.toContain("? Number(product.sellPrice) || 0");
    expect(productDialog).toContain("Nguyên liệu · Bình quân chi nhánh");
  });

  it("keeps dedicated F&B BOM preview separate from Retail cost and allows pre-batch setup", () => {
    expect(bomEditor).toContain('const isFnbRecipe = output?.channel === "fnb" || output?.isFnbStockItem === true;');
    expect(bomEditor).not.toContain("return material?.sellPrice ?? null;");
    expect(bomEditor).toContain("return getPreparedRecipeEstimateUnitCost(preparedCosts[item.materialId]);");
    expect(bomEditor).toContain("Vẫn lưu được công thức");
  });
});
