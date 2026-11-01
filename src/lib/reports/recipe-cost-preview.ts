import Decimal from "decimal.js-light";
import { getRecipeQuantityInStockUnit } from "@/lib/format-uom";
import type { UOMConversion } from "@/lib/types";

/** Match the persisted stock-unit quantity, not an unrounded conversion. */
export function calculateRecipeDraftLineCost(quantity: number, stockUnit: string, inputUnit: string, conversions: UOMConversion[], unitCost: number | null, wastePercent = 0): number | null {
  const normalized = getRecipeQuantityInStockUnit(quantity, stockUnit, inputUnit, conversions);
  if (normalized === null || unitCost === null || !Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(wastePercent) || wastePercent < 0) return null;
  return new Decimal(normalized).times(unitCost).times(new Decimal(1).plus(new Decimal(wastePercent).div(100))).toNumber();
}

export interface PreviewRecipeNode {
  unitPrice: number | null;
  recipe?: {
    outputQuantity: number;
    outputToStockFactor: number;
    lines: { component: string; quantity: number; wastePercent: number }[];
  };
}

export type RecipePreviewFailure = "missing_price" | "missing_component" | "invalid_recipe" | "recipe_cycle" | "recipe_depth";
export type RecipePreviewResult = { value: number; issues: [] } | { value: null; issues: { component: string; reason: RecipePreviewFailure }[] };

/** Input prices and normalized quantities must belong to one branch/read scope. No inventory writes. */
export function calculateRecipePreview(root: string, nodes: ReadonlyMap<string, PreviewRecipeNode>, maxDepth = 12): RecipePreviewResult {
  const active = new Set<string>();
  const memo = new Map<string, Decimal>();
  const failures: { component: string; reason: RecipePreviewFailure }[] = [];
  const fail = (component: string, reason: RecipePreviewFailure): null => {
    if (!failures.some(issue => issue.component === component && issue.reason === reason)) failures.push({ component, reason });
    return null;
  };
  const valid = (value: number) => Number.isFinite(value) && value >= 0;
  const visit = (key: string, depth: number): Decimal | null => {
    if (active.has(key)) return fail(key, "recipe_cycle");
    if (depth > maxDepth) return fail(key, "recipe_depth");
    const cached = memo.get(key);
    if (cached) return cached;
    const node = nodes.get(key);
    if (!node) return fail(key, "missing_component");
    if (!node.recipe) {
      if (node.unitPrice === null || !valid(node.unitPrice)) return fail(key, "missing_price");
      const price = new Decimal(node.unitPrice);
      memo.set(key, price);
      return price;
    }
    const recipe = node.recipe;
    if (!valid(recipe.outputQuantity) || recipe.outputQuantity === 0 ||
      !valid(recipe.outputToStockFactor) || recipe.outputToStockFactor === 0 || !recipe.lines.length) return fail(key, "invalid_recipe");
    active.add(key);
    let total = new Decimal(0);
    let complete = true;
    for (const line of recipe.lines) {
      if (!valid(line.quantity) || !valid(line.wastePercent)) {
        fail(key, "invalid_recipe"); complete = false; continue;
      }
      if (line.quantity === 0) continue;
      const price = visit(line.component, depth + 1);
      if (price === null) { complete = false; continue; }
      total = total.plus(price.times(line.quantity).times(new Decimal(1).plus(new Decimal(line.wastePercent).div(100))));
    }
    active.delete(key);
    if (!complete) return null;
    const price = total.div(new Decimal(recipe.outputQuantity).times(recipe.outputToStockFactor));
    if (!Number.isFinite(price.toNumber())) return fail(key, "invalid_recipe");
    memo.set(key, price);
    return price;
  };
  const value = visit(root, 0);
  return value === null ? { value: null, issues: failures } : { value: value.toNumber(), issues: [] };
}
