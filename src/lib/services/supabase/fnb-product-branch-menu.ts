/**
 * FnB menu availability by branch.
 *
 * An SKU with no rule keeps the legacy behavior: it is visible at every FnB
 * branch. A rule can either make the listed branches an explicit whitelist
 * or hide the SKU only at the listed branches. The latter is useful while a
 * newly opened outlet is still preparing its menu, without disturbing a
 * live outlet that already sells the same SKU.
 */

import { getClient, getCurrentTenantId, handleError } from "./base";

export interface FnbProductBranchMenuScope {
  productId: string;
  branchId: string;
  mode: FnbProductBranchMenuMode;
}

export type FnbProductBranchMenuMode = "only" | "except";
export type FnbProductBranchMenuPolicyMode = "all" | FnbProductBranchMenuMode;

export interface FnbProductBranchMenuPolicy {
  mode: FnbProductBranchMenuPolicyMode;
  branchIds: string[];
}

type ProductWithId = { id: string };

function mapScope(
  row: Record<string, unknown>,
  mode: FnbProductBranchMenuMode,
): FnbProductBranchMenuScope {
  return {
    productId: String(row.product_id),
    branchId: String(row.branch_id),
    mode,
  };
}

/**
 * Returns all explicit branch whitelists in the current tenant. Read access
 * is RLS-scoped; callers provide the tenant they already resolved to avoid an
 * extra profile round trip while POS is booting.
 */
export async function listFnbProductBranchMenuScopes(
  tenantId: string,
): Promise<FnbProductBranchMenuScope[]> {
  // These tables are introduced by migrations 00353 and 00354. Keep the cast
  // local until Supabase generated types are refreshed from production.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const [scopeResponse, policyResponse] = await Promise.all([
    supabase
      .from("fnb_product_branch_menu_scopes")
      .select("product_id, branch_id")
      .eq("tenant_id", tenantId),
    supabase
      .from("fnb_product_branch_menu_policies")
      .select("product_id, mode")
      .eq("tenant_id", tenantId),
  ]);

  if (scopeResponse.error) {
    handleError(scopeResponse.error, "listFnbProductBranchMenuScopes");
  }
  if (policyResponse.error) {
    handleError(policyResponse.error, "listFnbProductBranchMenuPolicies");
  }

  const modeByProduct = new Map<string, FnbProductBranchMenuMode>(
    (policyResponse.data ?? []).map((row: Record<string, unknown>) => [
      String(row.product_id),
      row.mode === "except" ? "except" : "only",
    ]),
  );

  return (scopeResponse.data ?? []).map((row: Record<string, unknown>) =>
    // A row written by 00353 before 00354 is interpreted as its original
    // whitelist until the 00354 policy backfill has run.
    mapScope(row, modeByProduct.get(String(row.product_id)) ?? "only"),
  );
}

export async function getFnbProductBranchMenuPolicy(
  productId: string,
): Promise<FnbProductBranchMenuPolicy> {
  const tenantId = await getCurrentTenantId();
  const scopes = await listFnbProductBranchMenuScopes(tenantId);
  const productScopes = scopes.filter((scope) => scope.productId === productId);
  if (productScopes.length === 0) {
    return { mode: "all", branchIds: [] };
  }
  return {
    mode: productScopes[0].mode,
    branchIds: productScopes.map((scope) => scope.branchId),
  };
}

/**
 * Saves a whole branch-menu policy atomically. "all" deliberately removes
 * only this product's explicit policy and restores the legacy global menu.
 */
export async function saveFnbProductBranchMenuPolicy(
  productId: string,
  mode: FnbProductBranchMenuPolicyMode,
  branchIds: string[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { error } = await supabase.rpc(
    "save_fnb_product_branch_menu_policy",
    {
      p_product_id: productId,
      p_mode: mode,
      p_branch_ids: [...new Set(branchIds)],
    },
  );

  if (error) handleError(error, "saveFnbProductBranchMenuPolicy");
}

/**
 * Product rows without a policy remain available everywhere for backward
 * compatibility. "only" rows are an explicit whitelist; "except" rows are
 * a local draft exclusion while remaining branches keep the SKU visible.
 */
export function filterFnbProductsForBranch<T extends ProductWithId>(
  products: T[],
  scopes: FnbProductBranchMenuScope[],
  branchId: string | null | undefined,
): T[] {
  const policyByProduct = new Map<string, FnbProductBranchMenuMode>();
  const branchIdsByProduct = new Map<string, Set<string>>();

  for (const scope of scopes) {
    policyByProduct.set(scope.productId, scope.mode);
    const branchIds = branchIdsByProduct.get(scope.productId) ?? new Set<string>();
    branchIds.add(scope.branchId);
    branchIdsByProduct.set(scope.productId, branchIds);
  }

  return products.filter((product) => {
    const mode = policyByProduct.get(product.id);
    if (!mode) return true;
    // A branch-specific rule is not safe to interpret until POS has resolved
    // its active branch. Fail closed instead of briefly showing another
    // outlet's pilot or draft menu while the branch selector is loading.
    if (!branchId) return false;

    const listedBranches = branchIdsByProduct.get(product.id) ?? new Set<string>();
    const isListedAtCurrentBranch = listedBranches.has(branchId);
    return mode === "only" ? isListedAtCurrentBranch : !isListedAtCurrentBranch;
  });
}

/** Stable cache marker. A changed whitelist forces POS to refresh its menu. */
export function getFnbMenuScopeFingerprint(
  scopes: FnbProductBranchMenuScope[],
): string {
  return scopes
    .map((scope) => `${scope.mode}:${scope.productId}:${scope.branchId}`)
    .sort()
    .join("|");
}
