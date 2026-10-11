/** Quantities are in the dispatched document's normalized stock unit. */
export function remainingToReceive(dispatched: number, received: number, entered: number): number {
  return Math.round((dispatched - received - entered) * 10000) / 10000;
}
export function validReceiptQuantity(value: string, remaining: number): boolean {
  if (!value.trim()) return true;
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 && quantity <= remaining && Math.abs(quantity - Math.round(quantity * 10000) / 10000) < 1e-9;
}
