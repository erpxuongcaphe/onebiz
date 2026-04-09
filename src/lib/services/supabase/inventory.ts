/**
 * Supabase service: Inventory operations
 *
 * - inventory_checks: from Supabase (read + apply)
 * - manufacturing, disposal, internal exports: re-export from mock (no DB tables yet)
 *
 * Apply flow (G7 fix):
 *   `applyInventoryCheck(checkId)` reads every row from `inventory_check_items`
 *   whose `difference != 0`, splits them into 'in' (actual > system) and 'out'
 *   (actual < system) lists, then routes each list through
 *   `applyManualStockMovement` so the dual-table sync (products.stock +
 *   branch_stock + stock_movements ledger) stays consistent with the rest of
 *   the warehouse dialogs. Finally flips the check status to `balanced`.
 *
 *   stock_movements convention: `quantity` is always positive; direction comes
 *   from the `type` column. Hence we split deltas instead of writing a single
 *   signed 'adjust' row.
 */

import type { InventoryCheck, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";
import { applyManualStockMovement } from "./stock-adjustments";

// Re-export mock services for entities without DB tables
export {
  getManufacturingOrders,
  getManufacturingStatuses,
  getDisposalExports,
  getDisposalStatuses,
  getInternalExports,
  getInternalExportStatuses,
} from "../mock/inventory";

// --- Inventory Checks (Supabase) ---

export async function getInventoryChecks(params: QueryParams): Promise<QueryResult<InventoryCheck>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("inventory_checks")
    .select("*", { count: "exact" });

  // Search
  if (params.search) {
    query = query.ilike("code", `%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all" && params.filters.status !== "") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInventoryChecks");

  const checks: InventoryCheck[] = (data ?? []).map(mapInventoryCheck);
  return { data: checks, total: count ?? 0 };
}

export function getInventoryCheckStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "balanced", label: "Đã cân bằng" },
    { value: "in_progress", label: "Đang xử lý" },
    { value: "draft", label: "Phiếu tạm" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

/* ------------------------------------------------------------------ */
/*  Apply inventory check (G7 fix) — commits real stock deltas        */
/* ------------------------------------------------------------------ */

/**
 * Apply an inventory check:
 *   1. Validate the check is in a mutable state ('draft' | 'in_progress')
 *   2. Read every `inventory_check_items` row
 *   3. For each item with `difference != 0`, derive a manual movement:
 *        - difference > 0 → type='in',  quantity=|difference|  (found more)
 *        - difference < 0 → type='out', quantity=|difference|  (lost some)
 *   4. Route every movement through `applyManualStockMovement` (writes
 *      stock_movements + products.stock + branch_stock in one pass)
 *   5. Flip `inventory_checks.status = 'balanced'`
 *
 * NOT atomic (fetch-then-update loop). Acceptable for single-cashier
 * workflows; a future RPC will wrap this in a single transaction.
 *
 * Throws if the check is already balanced/cancelled, or if it has no items.
 */
export async function applyInventoryCheck(checkId: string): Promise<void> {
  const supabase = getClient();

  // 1. Read check + status guard
  const { data: check, error: readErr } = await supabase
    .from("inventory_checks")
    .select("id, code, status")
    .eq("id", checkId)
    .single();
  if (readErr) handleError(readErr, "applyInventoryCheck.read");
  if (!check) throw new Error("Không tìm thấy phiếu kiểm kho");

  const status = check.status as string;
  if (status !== "draft" && status !== "in_progress") {
    throw new Error(
      `Chỉ có thể áp dụng phiếu kiểm kho ở trạng thái "Phiếu tạm" hoặc "Đang xử lý" (hiện tại: ${status})`
    );
  }

  // 2. Read check items
  // NOTE: `inventory_check_items` is not in the generated Database types yet
  // (schema 00001 but not surfaced in types.ts). Cast to any to bypass.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: itemsRaw, error: itemsErr } = await (supabase as any)
    .from("inventory_check_items")
    .select("id, product_id, product_name, system_stock, actual_stock, difference")
    .eq("check_id", checkId);
  if (itemsErr) handleError(itemsErr, "applyInventoryCheck.items");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (itemsRaw ?? []) as Array<{
    id: string;
    product_id: string;
    product_name: string;
    system_stock: number;
    actual_stock: number;
    difference: number;
  }>;
  if (items.length === 0) {
    throw new Error("Phiếu kiểm kho chưa có sản phẩm nào để áp dụng");
  }

  // 3. Build movements — skip zero-diff rows (nothing to write)
  const movements = items
    .map((it) => {
      const diff = Number(it.difference ?? 0);
      if (diff === 0) return null;
      return {
        productId: it.product_id,
        productName: it.product_name,
        quantity: Math.abs(diff),
        type: (diff > 0 ? "in" : "out") as "in" | "out",
      };
    })
    .filter((m): m is { productId: string; productName: string; quantity: number; type: "in" | "out" } => m !== null);

  if (movements.length === 0) {
    // Nothing to apply — just flip the status
    const { error: flipErr } = await supabase
      .from("inventory_checks")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ status: "balanced" as any })
      .eq("id", checkId);
    if (flipErr) handleError(flipErr, "applyInventoryCheck.flip");
    return;
  }

  // 4. Apply all deltas in one batch via the shared helper
  await applyManualStockMovement(
    movements.map((m) => ({
      productId: m.productId,
      quantity: m.quantity,
      type: m.type,
      referenceType: "inventory_check",
      referenceId: checkId,
      note: `${check.code} - Kiểm kê - ${m.productName} (${m.type === "in" ? "+" : "-"}${m.quantity})`,
    }))
  );

  // 5. Flip check status to balanced
  const { error: statusErr } = await supabase
    .from("inventory_checks")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "balanced" as any })
    .eq("id", checkId);
  if (statusErr) handleError(statusErr, "applyInventoryCheck.status");
}

// --- Mapper ---

const checkStatusNameMap: Record<string, string> = {
  draft: "Phiếu tạm",
  in_progress: "Đang xử lý",
  balanced: "Đã cân bằng",
  cancelled: "Đã hủy",
};

// Map DB status to frontend status
const checkStatusMap: Record<string, InventoryCheck["status"]> = {
  draft: "processing",
  in_progress: "processing",
  balanced: "balanced",
  cancelled: "unbalanced",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInventoryCheck(row: any): InventoryCheck {
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    status: checkStatusMap[row.status] ?? "processing",
    statusName: checkStatusNameMap[row.status] ?? row.status,
    totalProducts: 0, // Would need aggregation from inventory_check_items
    increaseQty: 0,
    decreaseQty: 0,
    increaseAmount: 0,
    decreaseAmount: 0,
    note: row.note ?? undefined,
    createdBy: row.created_by,
  };
}
