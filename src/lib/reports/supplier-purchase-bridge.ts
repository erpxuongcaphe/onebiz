export interface SupplierPurchaseBridge {
  returnAmount: number | null;
  prevReturnAmount: number | null;
  netPurchase: number | null;
  prevNetPurchase: number | null;
}

function totalReturns(rows: { total: unknown }[]): number | null {
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
  gross: number,
  previousGross: number,
  returns: { total: unknown }[],
  previousReturns: { total: unknown }[],
): SupplierPurchaseBridge {
  const returnAmount = totalReturns(returns);
  const prevReturnAmount = totalReturns(previousReturns);
  return {
    returnAmount,
    prevReturnAmount,
    netPurchase: returnAmount === null || !Number.isFinite(gross) ? null : gross - returnAmount,
    prevNetPurchase: prevReturnAmount === null || !Number.isFinite(previousGross) ? null : previousGross - prevReturnAmount,
  };
}
