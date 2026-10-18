/** Presentation only: never changes a product's availability, price or recipe. */
export interface FnbPosLayout {
  revision: number;
  categoryIds: string[];
  productIds: string[];
  hiddenIds: string[];
}

export const EMPTY_FNB_LAYOUT: FnbPosLayout = {
  revision: 0, categoryIds: [], productIds: [], hiddenIds: [],
};

export function rankMenuRows<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const ranks = new Map(ids.map((id, index) => [id, index]));
  // The incoming shared order remains the fallback, including newly created items.
  return rows.map((row, index) => ({ row, index })).sort((a, b) =>
    (ranks.get(a.row.id) ?? Infinity) - (ranks.get(b.row.id) ?? Infinity) || a.index - b.index,
  ).map(entry => entry.row);
}

export function visibleMenuRows<T extends { id: string }>(rows: readonly T[], layout: FnbPosLayout): T[] {
  const hidden = new Set(layout.hiddenIds);
  return rankMenuRows(rows.filter(row => !hidden.has(row.id)), layout.productIds);
}

export function moveLayoutRow<T extends { id: string }>(rows: readonly T[], from: string, to: string): T[] {
  const start = rows.findIndex(row => row.id === from);
  const end = rows.findIndex(row => row.id === to);
  if (start < 0 || end < 0 || start === end) return [...rows];
  const next = [...rows];
  const [item] = next.splice(start, 1);
  next.splice(end, 0, item);
  return next;
}

export function layoutContent(layout: FnbPosLayout): string {
  return JSON.stringify([layout.categoryIds, layout.productIds, [...layout.hiddenIds].sort()]);
}
