/** Filter choices before pagination; never infer product identity from its name/code. */
export function applyFnbCatalogScope<T extends { eq: (column: string, value: string) => T }>(query: T, isFnb: boolean): T {
  return isFnb ? query.eq("product_type", "sku") : query;
}

export function isFnbCatalogContext(branchType?: string, hostname = ""): boolean {
  return branchType === "store" || hostname.startsWith("fnb.") || hostname.startsWith("fnb-");
}
