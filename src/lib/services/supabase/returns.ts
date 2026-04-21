/**
 * Supabase service: Sales Returns (Trả hàng)
 */

import type { ReturnOrder, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

export async function getReturns(params: QueryParams): Promise<QueryResult<ReturnOrder>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("sales_returns")
    .select(
      "*, invoices!sales_returns_invoice_id_fkey(code), profiles!sales_returns_created_by_fkey(full_name)",
      { count: "exact" },
    );

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%`);
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getReturns");

  const returns: ReturnOrder[] = (data ?? []).map(mapReturn);
  return { data: returns, total: count ?? 0 };
}

export function getReturnStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapReturn(row: any): ReturnOrder {
  const statusNameMap: Record<string, string> = {
    draft: "Phiếu tạm",
    confirmed: "Đã xác nhận",
    completed: "Hoàn thành",
    cancelled: "Đã hủy",
  };

  const profile = row.profiles as { full_name: string } | null;
  return {
    id: row.id,
    code: row.code,
    invoiceCode: (row.invoices as { code: string } | null)?.code ?? "---",
    date: row.created_at,
    customerName: row.customer_name,
    totalAmount: row.total,
    status: row.status === "completed" ? "completed" : "draft",
    statusName: statusNameMap[row.status] ?? row.status,
    createdBy: profile?.full_name ?? row.created_by,
  };
}
