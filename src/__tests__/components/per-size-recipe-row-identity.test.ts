import { describe, expect, it } from "vitest";
import {
  newRecipeRow,
  rekeyRecipeRows,
  type RecipeRow,
} from "@/components/shared/dialogs/per-size-recipe-matrix";

describe("per-size recipe row identity", () => {
  it("creates unique keys across many new material rows", () => {
    const keys = Array.from({ length: 100 }, () => newRecipeRow().key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("re-keys restored draft rows while preserving recipe data", () => {
    const duplicateDraftRows: RecipeRow[] = [
      {
        key: "rr1",
        materialId: "sugar",
        unit: "G",
        scaleTarget: "sweetness",
        qty: { m: 6 },
        exactQty: { m: { normal: 6 } },
      },
      {
        key: "rr1",
        materialId: "coffee",
        unit: "G",
        scaleTarget: null,
        qty: { m: 16 },
        exactQty: {},
      },
    ];

    const restored = rekeyRecipeRows(duplicateDraftRows);

    expect(new Set(restored.map((row) => row.key)).size).toBe(2);
    expect(restored.map(({ key: _key, ...row }) => row)).toEqual(
      duplicateDraftRows.map(({ key: _key, ...row }) => row),
    );
  });
});
