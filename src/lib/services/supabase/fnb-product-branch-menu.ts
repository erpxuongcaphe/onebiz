/**
 * FnB menu availability by branch.
 *
 * An SKU with no rows keeps the legacy behavior: it is visible at every
 * FnB branch. Once it has one or more rows, those rows are the explicit
 * branch whitelist. This lets a pilot menu stay isolated without hiding
 * every existing FnB SKU after the migration.
 */

import { getClient, getCurrentTenantId, handleError } from "./base";

export interface FnbProductBranchMenuScope {
  productId: string;
  branchId: string;
}

type ProductWithId = { id: string };

function mapScope(row: Record<string, unknown>): FnbProductBranchMenuScope {
  return {
    productId: String(row.product_id),
    branchId: String(row.branch_id),
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
  // This table is introduced by migration 00353. Keep the cast local until
  // Supabase generated types are refreshed from the production schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { data, error } = await supabase
    .from("fnb_product_branch_menu_scopes")
    .select("product_id, branch_id")
    .eq("tenant_id", tenantId);

  if (error) handleError(error, "listFnbProductBranchMenuScopes");
  return (data ?? []).map((row: Record<string, unknown>) => mapScope(row));
}

export async function getFnbProductBranchMenuScope(
  productId: string,
): Promise<string[]> {
  const tenantId = await getCurrentTenantId();
  const scopes = await listFnbProductBranchMenuScopes(tenantId);
  return scopes
    .filter((scope) => scope.productId === productId)
    .map((scope) => scope.branchId);
}

/**
 * Saves a whole whitelist atomically. An empty list deliberately means
 * "all FnB branches" and removes only this product's explicit scope.
 */
export async function saveFnbProductBranchMenuScope(
  productId: string,
  branchIds: string[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  const { error } = await supabase.rpc(
    "save_fnb_product_branch_menu_scope",
    {
      p_product_id: productId,
      p_branch_ids: [...new Set(branchIds)],
    },
  );

  if (error) handleError(error, "saveFnbProductBranchMenuScope");
}

/**
 * Product rows without a scope remain available everywhere for backward
 * compatibility. Rows with a scope are shown only at their enabled branch.
 */
export function filterFnbProductsForBranch<T extends ProductWithId>(
  products: T[],
  scopes: FnbProductBranchMenuScope[],
  branchId: string | null | undefined,
): T[] {
  const scopedProductIds = new Set(scopes.map((scope) => scope.productId));
  const enabledProductIds = new Set(
    scopes
      .filter((scope) => scope.branchId === branchId)
      .map((scope) => scope.productId),
  );

  return products.filter(
    (product) =>
      !scopedProductIds.has(product.id) || enabledProductIds.has(product.id),
  );
}

/** Stable cache marker. A changed whitelist forces POS to refresh its menu. */
export function getFnbMenuScopeFingerprint(
  scopes: FnbProductBranchMenuScope[],
): string {
  return scopes
    .map((scope) => `${scope.productId}:${scope.branchId}`)
    .sort()
    .join("|");
}
