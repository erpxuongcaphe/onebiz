/**
 * Supabase service: Purchase Orders (Nhập hàng)
 */

import type { PurchaseOrder, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

export async function getPurchaseOrders(params: QueryParams): Promise<QueryResult<PurchaseOrder>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("purchase_orders")
    .select("*", { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,supplier_name.ilike.%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Filter: supplier
  if (params.filters?.supplier && params.filters.supplier !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("supplier_name", params.filters.supplier as any);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getPurchaseOrders");

  const orders: PurchaseOrder[] = (data ?? []).map(mapPurchaseOrder);
  return { data: orders, total: count ?? 0 };
}

export function getPurchaseOrderStatuses() {
  return [
    { label: "Phiếu tạm", value: "draft", count: 0 },
    { label: "Đã nhập hàng", value: "completed", count: 0 },
    { label: "Đã hủy", value: "cancelled", count: 0 },
  ];
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPurchaseOrder(row: any): PurchaseOrder {
  const statusMap: Record<string, PurchaseOrder["status"]> = {
    draft: "draft",
    ordered: "draft",
    partial: "draft",
    completed: "imported",
    cancelled: "cancelled",
  };

  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    supplierId: row.supplier_id,
    supplierCode: "", // Would need join to suppliers
    supplierName: row.supplier_name,
    amountOwed: row.debt,
    status: statusMap[row.status] ?? "draft",
    createdBy: row.created_by,
  };
}
