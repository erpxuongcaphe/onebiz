export interface XntMovementFilter {
  productId: string;
  productCode: string;
  branchId?: string;
  from: string;
  to: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildXntMovementHref(filter: XntMovementFilter): string {
  const params = new URLSearchParams({
    productId: filter.productId,
    productCode: filter.productCode,
    from: filter.from,
    to: filter.to,
  });
  if (filter.branchId) params.set("branchId", filter.branchId);
  return `/hang-hoa/lich-su-kho?${params.toString()}`;
}

export function readXntMovementFilter(search: string): XntMovementFilter | null {
  const params = new URLSearchParams(search);
  const productId = params.get("productId") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!UUID_PATTERN.test(productId) || !DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    return null;
  }
  const branchId = params.get("branchId") ?? "";
  return {
    productId,
    productCode: params.get("productCode") ?? "",
    branchId: UUID_PATTERN.test(branchId) ? branchId : undefined,
    from,
    to,
  };
}
