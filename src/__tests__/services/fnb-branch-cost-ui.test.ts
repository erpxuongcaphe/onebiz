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

  it("uses Retail supply price for recipe estimates and batch cost only for prepared-stock consumption", () => {
    expect(productDialog).toMatch(
      /material\.isFnbStockItem\s*\?\s*\{[\s\S]*sellPrice: fnbPreparedCostByProductId\[material\.id\]\?\.unitCost \?\? 0/,
    );
    expect(productDialog).toMatch(
      /product\?\.isFnbStockItem\s*\?\s*fnbPreparedCostByProductId\[product\.id\]\?\.unitCost \?\? 0\s*:\s*product \? getBomComponentUnitPrice\(product, "fnb"\) : item\.costPrice/,
    );
    expect(productDialog).toContain("const fnbBomCostPending =");
    expect(productDialog).toContain("Chưa có giá vốn BTP");
    expect(productDialog).toContain("SKU Retail dùng giá cấp nội bộ hiện hành");
    expect(productDialog).toContain("Bán thành phẩm · Bình quân tại quán");
    expect(productDialog).toContain("SKU Retail · Giá cấp nội bộ");
    expect(productDialog).toContain('const usesFnbRecipeCosts = channel === "fnb" || isFnbStockItem;');
    expect(productDialog).toContain('getBomComponentUnitPrice(p, usesFnbRecipeCosts ? "fnb" : channel)');
    expect(productDialog).toMatch(
      /usedMaterialIds\.has\(material\.id\) &&\s*!material\.isFnbStockItem &&/,
    );
    expect(productDialog).toMatch(
      /hasMissingPreparedComponentCost\s*\? \(isEdit \? Number\(initialData\?\.costPrice \?\? 0\) : 0\)/,
    );
  });

  it("keeps dedicated F&B BOM preview separate from Retail cost and allows pre-batch setup", () => {
    expect(bomEditor).toContain('const isFnbRecipe = output?.channel === "fnb" || output?.isFnbStockItem === true;');
    expect(bomEditor).toContain("return material?.sellPrice ?? null;");
    expect(bomEditor).toContain("return preparedCosts[item.materialId] ?? null;");
    expect(bomEditor).toContain("Vẫn lưu được công thức");
  });
});
