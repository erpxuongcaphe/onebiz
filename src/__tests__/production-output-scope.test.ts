import { describe, expect, it } from "vitest";
import { filterProductionOutputBoms } from "@/lib/production-output-scope";
import type { BOM } from "@/lib/types";

const recipes = [
  { id: "prepared", isActive: true, isFnbStockItem: true },
  { id: "menu", isActive: true, productChannel: "fnb" },
  { id: "retail", isActive: true, productChannel: "retail" },
  { id: "raw-output", isActive: true, productChannel: null },
  { id: "other-branch", isActive: true, isFnbStockItem: true, branchId: "other" },
  { id: "local", isActive: true, isFnbStockItem: true, branchId: "xtb" },
  { id: "inactive", isActive: false, isFnbStockItem: true },
] as BOM[];

describe("production output branch scope", () => {
  it("F&B only offers prepared stock and the selected branch's recipes", () => {
    expect(filterProductionOutputBoms(recipes, "xtb", "outlet").map((b) => b.id))
      .toEqual(["prepared", "local"]);
  });
  it("retains Retail/warehouse manufacturing outputs without restricting them to raw inputs", () => {
    expect(filterProductionOutputBoms(recipes, "xtb", "production").map((b) => b.id))
      .toEqual(["prepared", "menu", "retail", "raw-output", "local"]);
  });
  it("does not expose any outputs before branch scope is known", () => {
    expect(filterProductionOutputBoms(recipes, "", "outlet")).toEqual([]);
    expect(filterProductionOutputBoms(recipes, "xtb")).toEqual([]);
  });
});
