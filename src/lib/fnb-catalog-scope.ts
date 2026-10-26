/** Filter before pagination, including wholesale identifiers explicitly confirmed by the owner. */
export function applyFnbCatalogScope<T extends { eq: (column: string, value: string) => T; not: (column: string, operator: string, value: string) => T }>(query: T, isFnb: boolean): T {
  return isFnb ? query.eq("product_type", "sku").not("code", "ilike", "WS%").not("name", "ilike", "WS%").not("name", "ilike", "FECA%") : query;
}

/** Owner-defined wholesale identifiers; Retail remains unchanged. */
export function isWholesaleOnlyProduct(product: { code: string; name: string }): boolean {
  return /^WS/i.test(product.code) || /^(WS|FECA)/i.test(product.name);
}

export function isFnbCatalogContext(branchType?: string, hostname = ""): boolean {
  return branchType === "store" || hostname.startsWith("fnb.") || hostname.startsWith("fnb-");
}
