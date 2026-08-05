export const POS_QUANTITY_DECIMALS = 2;
export const POS_QUANTITY_STEP = 1 / 10 ** POS_QUANTITY_DECIMALS;

export function formatPosQuantityInput(quantity: number): string {
  if (!Number.isFinite(quantity)) return "";
  return String(Number(quantity.toFixed(POS_QUANTITY_DECIMALS)));
}

/**
 * Parse the cashier-facing quantity field without losing an in-progress
 * decimal value. Both `5.17` and the Vietnamese keyboard form `5,17` work.
 */
export function parsePosQuantityInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;

  const quantity = Number(normalized);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  return Number(quantity.toFixed(POS_QUANTITY_DECIMALS));
}

export function stepPosQuantity(quantity: number, direction: -1 | 1): number {
  const next = direction === -1
    ? Math.max(POS_QUANTITY_STEP, quantity - 1)
    : quantity + 1;
  return Number(next.toFixed(POS_QUANTITY_DECIMALS));
}