import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { applyFnbCatalogScope, isFnbCatalogContext } from "@/lib/fnb-catalog-scope";
import { isSelectableFnbBomComponent } from "@/lib/fnb-bom-components";

const state = vi.hoisted(() => ({ auth: { activeBranchId: "outlet", currentBranch: { id: "warehouse", branchType: "warehouse" }, branches: [{ id: "outlet", branchType: "store" }, { id: "warehouse", branchType: "warehouse" }] } }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => state.auth }));
import { useFnbCatalogScope } from "@/lib/hooks/use-fnb-catalog-scope";

describe("F&B product choices", () => {
  beforeEach(() => { state.auth.activeBranchId = "outlet"; });
  it("uses the selected outlet instead of the account's original warehouse, and updates on branch switches", () => {
    const { result, rerender } = renderHook(() => useFnbCatalogScope());
    expect(result.current).toBe(true);
    state.auth.activeBranchId = "warehouse"; rerender();
    expect(result.current).toBe(false);
  });
  it("also restricts F&B subdomains when viewing all branches", () => {
    expect(isFnbCatalogContext(undefined, "fnb.onebiz.com.vn")).toBe(true);
    expect(isFnbCatalogContext(undefined, "fnb-preview.vercel.app")).toBe(true);
    expect(isFnbCatalogContext("warehouse", "onebiz.com.vn")).toBe(false);
  });
  it("uses the receipt branch override even when the global branch is a warehouse", () => {
    state.auth.activeBranchId = "warehouse";
    expect(renderHook(() => useFnbCatalogScope("outlet")).result.current).toBe(true);
  });
  it("filters before the result limit so identical NVL names do not displace valid new SKUs", () => {
    const rows = [{ type: "nvl", code: "NVL-TRA", name: "Hồng trà" }, {type:"sku",code:"WS-001",name:"Hồng trà khách sỉ"}, {type:"sku",code:"SKU-TRA-008",name:"FECA - Hồng trà"}, { type: "sku", code: "SKU-TRA", name: "Hồng trà" }];
    const query = { eq: vi.fn((_column: string, type: string) => { rows.splice(0, rows.length, ...rows.filter(row => row.type === type)); return query; }), not: vi.fn((column: string,_operator: string,value: string) => { rows.splice(0,rows.length,...rows.filter(row=>!String(row[column as 'code'|'name']).toLowerCase().startsWith(value.slice(0,-1).toLowerCase()))); return query; }), limit: (count: number) => rows.slice(0, count) };
    expect(applyFnbCatalogScope(query, true).limit(1)).toEqual([{ type: "sku", code: "SKU-TRA", name: "Hồng trà" }]);
    expect(query.eq).toHaveBeenCalledWith("product_type", "sku");
  });
  it("leaves warehouse NVL searches intact and keeps the builder synchronous", () => {
    const query = { eq: vi.fn(() => query), not:vi.fn(() => query), then: vi.fn() };
    expect(applyFnbCatalogScope(query, false)).toBe(query);
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.then).not.toHaveBeenCalled();
  });
  it("keeps retail SKUs and prepared stock items selectable, while excluding raw NVL and sale menu items", () => {
    expect(isSelectableFnbBomComponent({ productType: "sku", channel: "retail", inventoryRole: "retail_stock_item" } as any)).toBe(true);
    expect(isSelectableFnbBomComponent({ productType: "sku", channel: "fnb", inventoryRole: "fnb_stock_item" } as any)).toBe(true);
    expect(isSelectableFnbBomComponent({ productType: "nvl", channel: undefined } as any)).toBe(false);
    expect(isSelectableFnbBomComponent({ productType: "sku", channel: "fnb", inventoryRole: "fnb_menu_item" } as any)).toBe(false);
  });
});
