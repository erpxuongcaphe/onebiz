import { describe, expect, it } from "vitest";
import { calculateRecipePreview, type PreviewRecipeNode } from "@/lib/reports/recipe-cost-preview";

const leaf = (unitPrice: number | null): PreviewRecipeNode => ({ unitPrice });
const recipe = (component: string, quantity: number, outputQuantity = 1, outputToStockFactor = 1, wastePercent = 0): PreviewRecipeNode => ({
  unitPrice: 999999,
  recipe: { outputQuantity, outputToStockFactor, lines: [{ component, quantity, wastePercent }] },
});
describe("current multi-level recipe previews, not posted costs", () => {
  it("recomputes prepared ingredients from current input prices without requiring any production batch", () => {
    const graph = new Map([["sugar", leaf(20)], ["syrup", recipe("sugar", 100, 200)], ["drink", recipe("syrup", 30)]]);
    expect(calculateRecipePreview("drink", graph)).toEqual({ value: 300, issues: [] });
    graph.set("sugar", leaf(24));
    expect(calculateRecipePreview("drink", graph)).toEqual({ value: 360, issues: [] });
    expect(graph.get("syrup")?.unitPrice).toBe(999999);
  });
  it("includes waste and explicit output-unit conversion exactly once", () => {
    const graph = new Map([["raw", leaf(0.1)], ["prepared", recipe("raw", 1000, 2, 1000, 10)]]);
    expect(calculateRecipePreview("prepared", graph).value).toBeCloseTo(0.055);
  });
  it("rejects cycles even when a prepared node has a saved price", () => {
    expect(calculateRecipePreview("a", new Map([["a", recipe("b", 1)], ["b", recipe("a", 1)]])))
      .toMatchObject({ value: null, issues: [{ reason: "recipe_cycle" }] });
  });
  it("returns no partial total when a component is missing", () => {
    const root = recipe("known", 1);
    root.recipe!.lines.push({ component: "unknown", quantity: 1, wastePercent: 0 });
    expect(calculateRecipePreview("root", new Map([["root", root], ["known", leaf(20)]])))
      .toMatchObject({ value: null, issues: [{ component: "unknown", reason: "missing_component" }] });
  });
  it("preserves verified zero prices and skips unused zero-quantity components", () => {
    expect(calculateRecipePreview("root", new Map([["root", recipe("free", 2)], ["free", leaf(0)]] )).value).toBe(0);
    expect(calculateRecipePreview("root", new Map([["root", recipe("absent", 0)]] )).value).toBe(0);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid output quantity %s", value => {
    expect(calculateRecipePreview("root", new Map([["root", recipe("raw", 1, value)], ["raw", leaf(20)]])).value).toBeNull();
  });
  it.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects missing or invalid leaf price %s", value => {
    expect(calculateRecipePreview("raw", new Map([["raw", leaf(value)]])).value).toBeNull();
  });
  it("bounds depth and validates output conversions", () => {
    const graph = new Map([["a", recipe("b", 1)], ["b", recipe("c", 1)], ["c", leaf(2)]]);
    expect(calculateRecipePreview("a", graph, 1)).toMatchObject({ value: null, issues: [{ reason: "recipe_depth" }] });
    graph.set("a", recipe("c", 1, 1, 0));
    expect(calculateRecipePreview("a", graph).value).toBeNull();
  });
});
