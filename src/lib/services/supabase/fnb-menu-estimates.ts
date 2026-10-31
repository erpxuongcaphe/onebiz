import type { Product } from "@/lib/types";
import { getClient, getCurrentTenantId } from "./base";
import { getVariantsByProductIds } from "./variants";
import { getFnbBranchComponentCosts, getPreparedRecipeUnitCost, type FnbBranchComponentCost } from "./fnb-branch-cost";

export interface FnbMenuEstimate {
  value: number | null;
  variantName?: string;
  reason?: string;
  issues?: MenuCostIssue[];
}

export interface MenuCostIssue {
  componentId: string | null;
  code: string;
  name: string;
  unit: string;
  reason: "missing_component" | "invalid_quantity" | "missing_cost" | "invalid_cost" | "negative_stock" | "quantity_mismatch";
  physicalQuantity: number | null;
  costedQuantity: number | null;
}

export interface RecipeHeader {
  id: string;
  product_id: string | null;
  code: string | null;
  branch_id: string | null;
  version: number | null;
}

/** Mirrors get_active_bom_for_branch: an explicit code must never fall back to another recipe. */
export function selectMenuRecipe(headers: RecipeHeader[], productId: string, code: string | null, branchId?: string) {
  return headers.filter((header) =>
    (code !== null ? header.code === code : header.product_id === productId) &&
    (header.branch_id === null || (branchId && header.branch_id === branchId)),
  ).sort((a, b) => Number(b.branch_id === branchId && !!branchId) - Number(a.branch_id === branchId && !!branchId) ||
    (b.version ?? -1) - (a.version ?? -1) || a.id.localeCompare(b.id))[0];
}

export interface RecipeCostLine {
  quantity: number;
  products: { id: string; code?: string; name?: string; unit?: string; sell_price: number | null; is_fnb_stock_item: boolean } | null;
}

/** Diagnostics only; never substitute an estimated price into cost-posting guards. */
export function getMenuCostIssues(lines: RecipeCostLine[], costs: Map<string, FnbBranchComponentCost>): MenuCostIssue[] {
  const issues: MenuCostIssue[] = [];
  for (const line of lines) {
    const material = line.products;
    const quantity = Number(line.quantity);
    const cost = material ? costs.get(material.id) : undefined;
    let reason: MenuCostIssue["reason"] | undefined;
    if (!material) reason = "missing_component";
    else if (!Number.isFinite(quantity) || quantity < 0) reason = "invalid_quantity";
    else if (quantity === 0) continue;
    else if (!cost) reason = "missing_cost";
    else if (![cost.unitCost, cost.physicalQuantity, cost.costedQuantity].every(Number.isFinite) || cost.unitCost < 0) reason = "invalid_cost";
    else if (cost.physicalQuantity < 0) reason = "negative_stock";
    else if (Math.abs(cost.physicalQuantity - cost.costedQuantity) > 0.0001) reason = "quantity_mismatch";
    else if (getPreparedRecipeUnitCost(cost) === null) reason = "missing_cost";
    if (reason) issues.push({
      componentId: material?.id ?? null,
      code: material?.code ?? "",
      name: material?.name ?? "Thành phần chưa xác định",
      unit: material?.unit ?? "",
      reason,
      physicalQuantity: cost && Number.isFinite(cost.physicalQuantity) ? cost.physicalQuantity : null,
      costedQuantity: cost && Number.isFinite(cost.costedQuantity) ? cost.costedQuantity : null,
    });
  }
  return issues;
}

/** Saved quantities are already normalized by the BOM unit-conversion trigger. */
export function sumMenuRecipeEstimate(lines: RecipeCostLine[], costs: Map<string, FnbBranchComponentCost>): number | null {
  if (!lines.length) return null;
  let total = 0;
  for (const line of lines) {
    const material = line.products;
    const quantity = Number(line.quantity);
    if (!material || !Number.isFinite(quantity) || quantity < 0) return null;
    if (quantity === 0) continue;
    const balance = costs.get(material.id);
    const unitCost = getPreparedRecipeUnitCost(balance);
    if (unitCost == null || !Number.isFinite(Number(unitCost)) || Number(unitCost) < 0) return null;
    total += quantity * Number(unitCost);
  }
  return Number.isFinite(total) ? total : null;
}

export function isFnbMenuRecipe(product: Product) {
  return product.channel === "fnb" && !product.isFnbStockItem && product.hasBom;
}

export function sortByMenuEstimate(products: Product[], estimates: Map<string, FnbMenuEstimate>, descending: boolean) {
  const value = (product: Product) => isFnbMenuRecipe(product) ? estimates.get(product.id)?.value ?? null : product.costPrice;
  return [...products].sort((a, b) => {
    const left = value(a), right = value(b);
    if (left == null || right == null) return left == null && right == null ? a.code.localeCompare(b.code) : left == null ? 1 : -1;
    return (left - right) * (descending ? -1 : 1) || a.code.localeCompare(b.code);
  });
}

/** Read-only current estimate, never an invoice cost or an inventory valuation. */
export async function getFnbMenuEstimates(products: Product[], branchId?: string): Promise<Map<string, FnbMenuEstimate>> {
  const result = new Map<string, FnbMenuEstimate>();
  const menu = products.filter(isFnbMenuRecipe);
  if (!menu.length) return result;
  const tenantId = await getCurrentTenantId();
  // Scoped views and existing RLS retain the same cost/tenant permissions as the editor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = getClient() as any;
  for (let start = 0; start < menu.length; start += 100) {
    const batch = menu.slice(start, start + 100);
    const ids = batch.map((product) => product.id);
    const variants = await getVariantsByProductIds(ids);
    const chosen = batch.map((product) => {
      const sizes = variants.get(product.id) ?? [];
      const size = sizes.find((variant) => variant.isDefault) ?? sizes[0];
      return { product, size, code: size?.bomCode || (product.bomCode ?? null) };
    });
    const codes = [...new Set(chosen.flatMap(({ code }) => code === null ? [] : [code]))];
    const select = "id,product_id,code,branch_id,version";
    const loadHeaders = async (field: "product_id" | "code", values: string[]) => {
      const rows: RecipeHeader[] = [];
      if (!values.length) return rows;
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from("bom_scoped").select(select)
          .eq("tenant_id", tenantId).eq("is_active", true).in(field, values)
          .order("id").range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < 500) return rows;
      }
    };
    const [direct, linked] = await Promise.all([loadHeaders("product_id", ids), loadHeaders("code", codes)]);
    const headers = [...direct, ...linked];
    const selected = chosen.map((item) => ({ ...item, header: selectMenuRecipe(headers, item.product.id, item.code, branchId) }));
    const bomIds = [...new Set(selected.flatMap(({ header }) => header ? [header.id] : []))];
    const lines: Array<RecipeCostLine & { bom_id: string }> = [];
    if (bomIds.length) {
      for (let offset = 0; ; offset += 500) {
        const { data, error: itemError } = await client.from("bom_items")
          .select("id,bom_id,quantity,products:products_scoped!bom_items_material_id_fkey(id,code,name,unit,sell_price,is_fnb_stock_item)")
          .in("bom_id", bomIds).order("id").range(offset, offset + 499);
        if (itemError) throw itemError;
        lines.push(...(data ?? []));
        if ((data ?? []).length < 500) break;
      }
    }
    const preparedIds = [...new Set(lines.flatMap((line) => line.products ? [line.products.id] : []))];
    const costs = new Map<string, FnbBranchComponentCost>();
    if (branchId) {
      for (let offset = 0; offset < preparedIds.length; offset += 500) {
        const chunk = await getFnbBranchComponentCosts(branchId, preparedIds.slice(offset, offset + 500));
        chunk.forEach((cost, id) => costs.set(id, cost));
      }
    }
    for (const { product, size, header } of selected) {
      const recipeLines = header ? lines.filter((line) => line.bom_id === header.id) : [];
      const value = header ? sumMenuRecipeEstimate(recipeLines, costs) : null;
      result.set(product.id, {
        value,
        variantName: size?.name,
        reason: value === null ? !header ? "Chưa có BOM phù hợp" : !branchId ? "Chọn chi nhánh để tính giá vốn" : "Chưa đủ giá thành phần" : undefined,
        issues: branchId && header && value === null ? getMenuCostIssues(recipeLines, costs) : [],
      });
    }
  }
  return result;
}
