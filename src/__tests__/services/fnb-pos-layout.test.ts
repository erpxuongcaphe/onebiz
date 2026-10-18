import { describe, expect, it } from "vitest";
import { EMPTY_FNB_LAYOUT, layoutContent, moveLayoutRow, rankMenuRows, visibleMenuRows } from "@/lib/fnb-pos-layout";

describe("branch presentation layout", () => {
  const rows = [{ id: "a", price: 5, bom: "recipe-a" }, { id: "b", price: 0, bom: "recipe-b" }, { id: "new", price: 7, bom: "recipe-new" }];
  it("preserves new catalog items and every price/recipe while ordering and hiding", () => {
    const layout = { ...EMPTY_FNB_LAYOUT, productIds: ["b", "a", "deleted"], hiddenIds: ["a"] };
    expect(visibleMenuRows(rows, layout)).toEqual([rows[1], rows[2]]);
    expect(rows).toHaveLength(3);
    expect(rows[0].bom).toBe("recipe-a");
    expect(visibleMenuRows(rows, EMPTY_FNB_LAYOUT)).toEqual(rows);
  });
  it("does not create items absent from the eligible branch catalog", () => {
    expect(visibleMenuRows(rows, { ...EMPTY_FNB_LAYOUT, productIds: ["another-branch", "b"] }).map(row => row.id)).toEqual(["b", "a", "new"]);
  });
  it("moves by identity without mutating source, including distant drag targets", () => {
    expect(moveLayoutRow(rows, "a", "new").map(row => row.id)).toEqual(["b", "new", "a"]);
    expect(rows.map(row => row.id)).toEqual(["a", "b", "new"]);
    expect(moveLayoutRow(rows, "missing", "a")).toEqual(rows);
  });
  it("keeps shared order as the fallback and distinguishes saved from viewed controls", () => {
    expect(rankMenuRows(rows, [])).toEqual(rows);
    expect(layoutContent(EMPTY_FNB_LAYOUT)).toBe(layoutContent({ ...EMPTY_FNB_LAYOUT, revision: 55 }));
    expect(layoutContent({ ...EMPTY_FNB_LAYOUT, hiddenIds: ["a"] })).not.toBe(layoutContent(EMPTY_FNB_LAYOUT));
  });
});
