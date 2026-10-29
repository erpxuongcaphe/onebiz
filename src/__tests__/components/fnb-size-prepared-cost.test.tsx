import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PerSizeRecipeMatrix, type RecipeRow } from "@/components/shared/dialogs/per-size-recipe-matrix";
import type { Product, UOMConversion } from "@/lib/types";

const material = (id: string, unit: string, price: number, prepared = false) => ({
  id, code: id, name: id, unit, stockUnit: unit, sellPrice: price, isFnbStockItem: prepared,
  channel: "retail", productType: "sku",
}) as Product;
const rows: RecipeRow[] = [
  { key: "milk", materialId: "milk", unit: "G", scaleTarget: null, qty: { m: 28, l: 42 }, exactQty: {} },
  { key: "coffee", materialId: "coffee", unit: "G", scaleTarget: null, qty: { m: 30, l: 45 }, exactQty: {} },
];
const props = {
  sizes: [{ key: "m", name: "Size M" }, { key: "l", name: "Size L" }],
  rows, onChange: () => {}, groups: [], optionsByGroup: {},
  conversionsByMaterial: { milk: [{ fromUnit: "Lon", toUnit: "G", factor: 1000, isActive: true } as UOMConversion], coffee: [] },
  materials: [material("milk", "Lon", 45000), material("coffee", "G", 20, true)],
};

describe("prepared batch prices in the size matrix", () => {
  it("includes BTP and recalculates when either preparation quantity or batch cost changes", () => {
    const { rerender } = render(<PerSizeRecipeMatrix {...props} />);
    expect(screen.getByText("1,860 đ")).toBeInTheDocument();
    expect(screen.getByText("2,790 đ")).toBeInTheDocument();
    rerender(<PerSizeRecipeMatrix {...props} rows={[rows[0], { ...rows[1], qty: { m: 40, l: 45 } }]} />);
    expect(screen.getByText("2,060 đ")).toBeInTheDocument();
    rerender(<PerSizeRecipeMatrix {...props} materials={[props.materials[0], material("coffee", "G", 30, true)]} />);
    expect(screen.getByText("2,160 đ")).toBeInTheDocument();
  });

  it("does not present a partial milk-only total while batch costs are unavailable", () => {
    const { rerender } = render(<PerSizeRecipeMatrix {...props} costPending />);
    expect(screen.getAllByText("Đang tính...")).toHaveLength(2);
    rerender(<PerSizeRecipeMatrix {...props} costUnavailable />);
    expect(screen.getAllByText("Chưa đủ giá BTP")).toHaveLength(2);
    expect(screen.queryByText("1,260 đ")).not.toBeInTheDocument();
    rerender(<PerSizeRecipeMatrix {...props} costError />);
    expect(screen.getAllByText("Không tải được giá vốn")).toHaveLength(2);
    expect(screen.queryByText("Chưa đủ giá BTP")).not.toBeInTheDocument();
  });

  it("the product editor supplies the same branch-adjusted prices to header and matrix", () => {
    const source = readFileSync("src/components/shared/dialogs/create-product-dialog.tsx", "utf8");
    expect(source).toContain("materials={fnbCostMaterials}");
    expect(source).toContain("costUnavailable={hasUnpricedPreparedComponent}");
  });
});
