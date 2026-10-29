import { getClient, getCurrentTenantId, handleError } from "./base";

export interface FnbBranchOpeningCostRow {
  productId: string;
  code: string;
  name: string;
  unit: string;
  physicalQuantity: number;
  costedQuantity: number;
  unitCost: number;
  openingCostConfirmed: boolean;
  canConfirmOpeningCost: boolean;
}

export interface FnbBranchComponentCost {
  productId: string;
  unitCost: number;
  costedQuantity: number;
  physicalQuantity: number;
}

export function getPreparedRecipeUnitCost(cost: Pick<FnbBranchComponentCost, "unitCost" | "costedQuantity" | "physicalQuantity"> | undefined): number | null {
  if (!cost || !Number.isFinite(cost.unitCost) || cost.unitCost < 0 ||
    !Number.isFinite(cost.costedQuantity) || !Number.isFinite(cost.physicalQuantity) ||
    Math.abs(cost.costedQuantity - cost.physicalQuantity) > 0.0001 ||
    (cost.unitCost === 0 && cost.costedQuantity <= 0)) return null;
  return cost.unitCost;
}

/** Preview only: retain a known batch unit price while stock awaits reconciliation.
 * This must never replace getPreparedRecipeUnitCost in posting/readiness guards.
 */
export function getPreparedRecipeEstimateUnitCost(cost: Pick<FnbBranchComponentCost, "unitCost" | "costedQuantity" | "physicalQuantity"> | undefined): number | null {
  if (!cost || !Number.isFinite(cost.unitCost) || cost.unitCost < 0) return null;
  if (cost.unitCost === 0 && getPreparedRecipeUnitCost(cost) === null) return null;
  return cost.unitCost;
}

/** Quantity-only production check; never returns prices or cost amounts. */
export async function getFnbProductionStockHealth(branchId: string, productIds: string[]) {
  // Migration RPC precedes generated schema types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).rpc("get_fnb_production_stock_health_00476", {
    p_branch_id: branchId, p_product_ids: Array.from(new Set(productIds)),
  });
  if (error) handleError(error, "getFnbProductionStockHealth");
  return new Map<string, { physicalQuantity: number; costedQuantity: number }>(
    (data ?? []).map((row: { product_id: string; physical_quantity: number; costed_quantity: number }) =>
      [row.product_id, { physicalQuantity: Number(row.physical_quantity), costedQuantity: Number(row.costed_quantity) }]),
  );
}

/**
 * Every F&B recipe component uses the selected branch's cost ledger.
 * Retail selling prices are never a substitute for a branch receipt cost.
 */
export async function getFnbBranchComponentCosts(
  branchId: string,
  productIds: string[],
  signal?: AbortSignal,
) {
  if (!branchId || productIds.length === 0) {
    return new Map<string, FnbBranchComponentCost>();
  }
  const uniqueIds = Array.from(new Set(productIds));
  if (uniqueIds.length > 500) {
    const result = new Map<string, FnbBranchComponentCost>();
    for (let offset = 0; offset < uniqueIds.length; offset += 500) {
      if (signal?.aborted) return new Map<string, FnbBranchComponentCost>();
      const chunk = await getFnbBranchComponentCosts(branchId, uniqueIds.slice(offset, offset + 500), signal);
      chunk.forEach((cost, id) => result.set(id, cost));
    }
    return result;
  }
  const tenantId = await getCurrentTenantId();
  const ids = Array.from(new Set(productIds)).slice(0, 500);
  // Generated Supabase types intentionally lag this newly deployed migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let costQuery = (getClient() as any)
    .from("fnb_branch_product_cost_balances")
    .select("product_id, unit_cost, costed_quantity")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .in("product_id", ids);
  let stockQuery = (getClient() as any)
    .from("branch_stock")
    .select("product_id, quantity")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .is("variant_id", null)
    .in("product_id", ids);
  if (signal) {
    costQuery = costQuery.abortSignal(signal);
    stockQuery = stockQuery.abortSignal(signal);
  }
  const [{ data, error }, { data: stockRows, error: stockError }] = await Promise.all([
    costQuery,
    stockQuery,
  ]);
  if (signal?.aborted) return new Map<string, FnbBranchComponentCost>();
  if (error) handleError(error, "getFnbBranchComponentCosts");
  if (stockError) handleError(stockError, "getFnbBranchComponentCosts.stock");
  const physicalByProductId = new Map<string, number>(
    (stockRows ?? []).map((row: { product_id: string; quantity: number }) => [
      row.product_id,
      Number(row.quantity ?? 0),
    ]),
  );
  return new Map<string, FnbBranchComponentCost>(
    (data ?? []).map((row: { product_id: string; unit_cost: number; costed_quantity: number }) => [
      row.product_id,
      {
        productId: row.product_id,
        unitCost: Number(row.unit_cost ?? 0),
        costedQuantity: Number(row.costed_quantity ?? 0),
        physicalQuantity: physicalByProductId.get(row.product_id) ?? 0,
      },
    ]),
  );
}

/**
 * Only returns stock that needs an explicit opening-cost decision. We keep the
 * physical and cost-ledger quantities side by side so the operator cannot
 * accidentally assign a cost to an incomplete quantity.
 */
export async function listFnbBranchOpeningCostRows(branchId: string, signal?: AbortSignal) {
  if (!branchId) return [] as FnbBranchOpeningCostRow[];
  const tenantId = await getCurrentTenantId();
  // Generated Supabase types intentionally lag this newly deployed migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = getClient() as any;

  let stockQuery = client.from("branch_stock")
    .select("product_id, quantity, products:products_scoped!inner(code, name, unit, inventory_role)")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .is("variant_id", null)
    .gt("quantity", 0)
    .neq("products.inventory_role", "fnb_menu_item")
    .order("product_id")
    .limit(2000);
  if (signal) stockQuery = stockQuery.abortSignal(signal);

  let balanceQuery = client.from("fnb_branch_product_cost_balances")
    .select("product_id, costed_quantity, unit_cost, opening_cost_confirmed")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .limit(2000);
  if (signal) balanceQuery = balanceQuery.abortSignal(signal);

  let eventQuery = client.from("fnb_branch_product_cost_events")
    .select("product_id")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .limit(10000);
  if (signal) eventQuery = eventQuery.abortSignal(signal);

  const [{ data: stockRows, error: stockError }, { data: balanceRows, error: balanceError }, { data: eventRows, error: eventError }] = await Promise.all([
    stockQuery,
    balanceQuery,
    eventQuery,
  ]);
  if (signal?.aborted) return [];
  if (stockError) handleError(stockError, "listFnbBranchOpeningCostRows.stock");
  if (balanceError) handleError(balanceError, "listFnbBranchOpeningCostRows.balance");
  if (eventError) handleError(eventError, "listFnbBranchOpeningCostRows.events");

  const balances = new Map<string, { costed_quantity: number; unit_cost: number; opening_cost_confirmed: boolean }>(
    (balanceRows ?? []).map((row: { product_id: string; costed_quantity: number; unit_cost: number; opening_cost_confirmed: boolean }) => [row.product_id, row]),
  );
  const productsWithEvents = new Set<string>((eventRows ?? []).map((row: { product_id: string }) => row.product_id));
  return (stockRows ?? []).flatMap((row: {
    product_id: string;
    quantity: number;
    products: { code: string; name: string; unit: string } | null;
  }) => {
    const product = row.products;
    if (!product) return [];
    const balance = balances.get(row.product_id);
    const physicalQuantity = Number(row.quantity ?? 0);
    const costedQuantity = Number(balance?.costed_quantity ?? 0);
    if (Math.abs(physicalQuantity - costedQuantity) <= 0.0001) return [];
    return [{
      productId: row.product_id,
      code: product.code,
      name: product.name,
      unit: product.unit,
      physicalQuantity,
      costedQuantity,
      unitCost: Number(balance?.unit_cost ?? 0),
      openingCostConfirmed: Boolean(balance?.opening_cost_confirmed),
      canConfirmOpeningCost: !productsWithEvents.has(row.product_id) && costedQuantity === 0,
    }];
  });
}

export async function setFnbBranchOpeningCost(
  branchId: string,
  productId: string,
  unitCost: number,
  reason: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getClient() as any).rpc("set_fnb_branch_opening_cost_00390", {
    p_branch_id: branchId,
    p_product_id: productId,
    p_unit_cost: unitCost,
    p_reason: reason.trim(),
  });
  if (error) handleError(error, "setFnbBranchOpeningCost");
  return data as { quantity: number; unit_cost: number; event_id: string };
}
