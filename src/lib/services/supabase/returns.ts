/**
 * Supabase service: Sales Returns (Trả hàng)
 */

import type { ReturnOrder, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";

export async function getReturns(params: QueryParams): Promise<QueryResult<ReturnOrder>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("sales_returns")
    .select(
      "*, invoices!sales_returns_invoice_id_fkey(code), profiles!sales_returns_created_by_fkey(full_name), branches!sales_returns_branch_id_fkey(name)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

  // Search
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(`code.ilike.%${esc}%`);
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
  const branch = row.branches as { name: string } | null;
  return {
    id: row.id,
    code: row.code,
    invoiceCode: (row.invoices as { code: string } | null)?.code ?? "---",
    invoiceId: row.invoice_id ?? undefined,
    date: row.created_at,
    customerName: row.customer_name,
    totalAmount: row.total,
    status: row.status === "completed" ? "completed" : "draft",
    statusName: statusNameMap[row.status] ?? row.status,
    createdBy: profile?.full_name ?? row.created_by,
    branchId: row.branch_id ?? undefined,
    branchName: branch?.name ?? undefined,
  };
}

/**
 * Lấy line items của phiếu trả hàng cho detail panel.
 * Trước đây panel render hardcoded "SP001 — Sản phẩm mẫu".
 */
export interface ReturnItemRow {
  id: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export async function getReturnItems(returnId: string): Promise<ReturnItemRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Defense-in-depth: verify return thuộc tenant
  const { data: ret } = await supabase
    .from("sales_returns")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", returnId)
    .maybeSingle();
  if (!ret) return [];

  const { data, error } = await supabase
    .from("return_items")
    .select(
      "id, product_id, product_name, unit, quantity, unit_price, total, products!return_items_product_id_fkey(code)",
    )
    .eq("return_id", returnId);

  if (error) {
    console.warn("[getReturnItems]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    productCode: row.products?.code ?? "",
    productName: row.product_name ?? "",
    unit: row.unit ?? "",
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    total: Number(row.total ?? 0),
  }));
}
