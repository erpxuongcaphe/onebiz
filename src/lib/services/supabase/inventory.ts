/**
 * Supabase service: Inventory operations
 *
 * - inventory_checks: from Supabase
 * - manufacturing, disposal, internal exports: re-export from mock (no DB tables yet)
 */

import type { InventoryCheck, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

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
