import type {
  PosStockSnapshot,
  PosStockSnapshotEntry,
} from "@/lib/services/supabase/pos-stock";

interface StockAwareLine {
  productId: string;
  productName: string;
  quantity: number;
  availableStock: number;
  stockKnown?: boolean;
  hasBom?: boolean;
}

interface TrackedStockRequest {
  productId: string;
  lineId?: string;
}

/**
 * Include the cart line identity so reopening a draft with the same products
 * still triggers an immediate stock refresh. Quantity is intentionally omitted
 * to avoid a database request for every quantity edit.
 */
export function buildTrackedStockRefreshKey(
  requests: TrackedStockRequest[],
): string {
  return requests
    .map((request) => `${request.productId}:${request.lineId ?? "catalog"}`)
    .sort()
    .join("|");
}

export interface PosStockShortage {
  productId: string;
  productName: string;
  required: number;
  available: number;
  hasBom: boolean;
  source?: PosStockSnapshotEntry["source"];
  bottleneckMaterialName?: string;
}

export function mergePosStockSnapshot<T extends StockAwareLine>(
  lines: T[],
  snapshot: PosStockSnapshot,
): T[] {
  let changed = false;
  const next = lines.map((line) => {
    const entry = snapshot.get(line.productId);
    if (!entry) return line;
    if (
      line.availableStock === entry.availableStock &&
      line.stockKnown === true &&
      line.hasBom === entry.hasBom
    ) {
      return line;
    }
    changed = true;
    return {
      ...line,
      availableStock: entry.availableStock,
      stockKnown: true,
      hasBom: entry.hasBom,
    };
  });
  return changed ? next : lines;
}

export function findPosStockShortages(
  lines: StockAwareLine[],
  snapshot?: PosStockSnapshot,
): PosStockShortage[] {
  const grouped = new Map<
    string,
    { productName: string; required: number; line: StockAwareLine }
  >();

  for (const line of lines) {
    const current = grouped.get(line.productId);
    if (current) {
      current.required += line.quantity;
    } else {
      grouped.set(line.productId, {
        productName: line.productName,
        required: line.quantity,
        line,
      });
    }
  }

  const shortages: PosStockShortage[] = [];
  for (const [productId, group] of grouped) {
    const entry = snapshot?.get(productId);
    const stockKnown = entry ? true : group.line.stockKnown === true;
    if (!stockKnown) continue;
    const available = entry?.availableStock ?? group.line.availableStock;
    if (group.required <= available + 0.001) continue;
    shortages.push({
      productId,
      productName: group.productName,
      required: group.required,
      available,
      hasBom: entry?.hasBom ?? Boolean(group.line.hasBom),
      source: entry?.source,
      bottleneckMaterialName: entry?.bottleneckMaterialName,
    });
  }
  return shortages;
}
