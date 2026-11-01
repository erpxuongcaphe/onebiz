export function catalogExportQuantity(
  product: { stock?: number | null; branchStock?: number | null },
  branchId: string | undefined,
): number {
  return branchId ? product.branchStock ?? 0 : product.stock ?? 0;
}
