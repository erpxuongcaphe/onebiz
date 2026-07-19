import { getBomAvailabilityBatch } from "./bom";
import { mapWithConcurrency } from "@/lib/utils/async-concurrency";
import { getClient, getCurrentTenantId, handleError } from "./base";

export interface PosStockRequest {
  productId: string;
  hasBom?: boolean;
}

export interface PosStockSnapshotEntry {
  productId: string;
  availableStock: number;
  stockKnown: true;
  hasBom: boolean;
  source: "branch" | "bom";
  bottleneckMaterialName?: string;
}

export type PosStockSnapshot = Map<string, PosStockSnapshotEntry>;

const QUERY_CHUNK_SIZE = 200;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/**
 * Read the current POS availability directly from branch stock and BOM inputs.
 * This is intentionally read-only and bypasses browser/PWA caches.
 */
export async function getPosStockSnapshot(
  requests: PosStockRequest[],
  branchId: string,
): Promise<PosStockSnapshot> {
  const snapshot: PosStockSnapshot = new Map();
  if (!branchId || requests.length === 0) return snapshot;

  const uniqueRequests = Array.from(
    new Map(requests.map((request) => [request.productId, request])).values(),
  );
  const productIds = uniqueRequests.map((request) => request.productId);
  const tenantId = await getCurrentTenantId();
  const supabase = getClient();

  const hasBomByProduct = new Map<string, boolean>();
  for (const request of uniqueRequests) {
    if (typeof request.hasBom === "boolean") {
      hasBomByProduct.set(request.productId, request.hasBom);
    }
  }

  const unknownProductIds = productIds.filter(
    (productId) => !hasBomByProduct.has(productId),
  );
  if (unknownProductIds.length > 0) {
    const productResults = await Promise.all(
      chunks(unknownProductIds, QUERY_CHUNK_SIZE).map(async (ids) => {
        const { data, error } = await supabase
          .from("products")
          .select("id, has_bom")
          .eq("tenant_id", tenantId)
          .in("id", ids);
        if (error) handleError(error, "getPosStockSnapshot:products");
        return data ?? [];
      }),
    );
    for (const row of productResults.flat()) {
      hasBomByProduct.set(row.id, Boolean(row.has_bom));
    }
  }

  const stockResults = await mapWithConcurrency(
    chunks(productIds, QUERY_CHUNK_SIZE),
    4,
    async (ids) => {
      const { data, error } = await supabase
        .from("branch_stock")
        .select("product_id, quantity")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .is("variant_id", null)
        .in("product_id", ids);
      if (error) handleError(error, "getPosStockSnapshot:branch_stock");
      return data ?? [];
    },
  );
  const stockRows = stockResults.flat();

  const branchStockByProduct = new Map<string, number>();
  const requestedIds = new Set(productIds);
  for (const row of stockRows) {
    if (!requestedIds.has(row.product_id)) continue;
    branchStockByProduct.set(row.product_id, Number(row.quantity ?? 0));
  }
  const bomProductIds = productIds.filter(
    (productId) => hasBomByProduct.get(productId) === true,
  );
  const bomAvailability = await getBomAvailabilityBatch(
    bomProductIds,
    branchId,
  );

  for (const productId of productIds) {
    const hasBom = hasBomByProduct.get(productId) ?? false;
    const bomEntry = bomAvailability.get(productId);
    snapshot.set(productId, {
      productId,
      availableStock: bomEntry
        ? Number(bomEntry.available ?? 0)
        : branchStockByProduct.get(productId) ?? 0,
      stockKnown: true,
      hasBom,
      source: bomEntry ? "bom" : "branch",
      bottleneckMaterialName: bomEntry?.bottleneckMaterialName,
    });
  }

  return snapshot;
}
