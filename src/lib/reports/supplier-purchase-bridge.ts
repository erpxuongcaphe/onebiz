export interface SupplierPurchaseBridge {
  returnAmount: number | null;
  prevReturnAmount: number | null;
  netPurchase: number | null;
  prevNetPurchase: number | null;
}

export function sumSupplierDocumentAmounts(rows: { total: unknown }[]): number | null {
  let total = 0;
  for (const row of rows) {
    const value = row.total;
    if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && value.trim() === "") || !Number.isFinite(Number(value))) return null;
    total += Number(value);
  }
  return Number.isFinite(total) ? total : null;
}

export function supplierPurchaseBridge(
  gross: number | null,
  previousGross: number | null,
  returns: { total: unknown }[],
  previousReturns: { total: unknown }[],
): SupplierPurchaseBridge {
  const returnAmount = sumSupplierDocumentAmounts(returns);
  const prevReturnAmount = sumSupplierDocumentAmounts(previousReturns);
  return {
    returnAmount,
    prevReturnAmount,
    netPurchase: gross === null || returnAmount === null || !Number.isFinite(gross) ? null : gross - returnAmount,
    prevNetPurchase: previousGross === null || prevReturnAmount === null || !Number.isFinite(previousGross) ? null : previousGross - prevReturnAmount,
  };
}
