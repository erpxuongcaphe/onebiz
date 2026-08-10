/**
 * Supabase service: Sales Returns (Trả hàng)
 */

import type { ReturnOrder, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";

const VALID_RETURN_STATUSES = new Set([
  "draft",
  "confirmed",
  "completed",
  "cancelled",
]);

export async function getReturns(params: QueryParams): Promise<QueryResult<ReturnOrder>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  const invoiceRelation =
    params.search && params.searchField === "invoice_code"
      ? "invoice:invoices!sales_returns_invoice_id_fkey!inner(code, tenant_id)"
      : "invoice:invoices!sales_returns_invoice_id_fkey(code)";
  const customerRelation =
    params.search &&
    (params.searchField === "customer_code" ||
      params.searchField === "customer_phone")
      ? "customer:customers!sales_returns_customer_id_fkey!inner(code, phone, tenant_id)"
      : "customer:customers!sales_returns_customer_id_fkey(code, phone)";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("sales_returns")
    .select(
      `*, ${invoiceRelation}, ${customerRelation}, creator:profiles!sales_returns_created_by_fkey(full_name), branch:branches!sales_returns_branch_id_fkey(name)`,
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

  // Tìm theo đúng cột người dùng chọn. Quan hệ hóa đơn/khách hàng dùng
  // !inner để bộ lọc ở bảng liên quan thực sự thu hẹp sales_returns.
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    switch (params.searchField) {
      case "invoice_code":
        query = query
          .eq("invoice.tenant_id", tenantId)
          .ilike("invoice.code", `%${esc}%`);
        break;
      case "customer_name":
        query = query.ilike("customer_name", `%${esc}%`);
        break;
      case "customer_code":
        query = query
          .eq("customer.tenant_id", tenantId)
          .ilike("customer.code", `%${esc}%`);
        break;
      case "customer_phone":
        query = query
          .eq("customer.tenant_id", tenantId)
          .ilike("customer.phone", `%${esc}%`);
        break;
      case "reason":
        query = query.ilike("reason", `%${esc}%`);
        break;
      case "note":
        query = query.ilike("note", `%${esc}%`);
        break;
      case "code":
      default:
        query = query.ilike("code", `%${esc}%`);
        break;
    }
  }

  // Filter: status — hỗ trợ cả mảng (nhiều trạng thái) lẫn 1 giá trị.
  // BUG cũ: .eq với mảng → so sánh status = cả mảng → khớp 0 dòng → ẩn sạch.
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = Array.isArray(params.filters.status)
      ? params.filters.status
      : [params.filters.status];
    const statuses = raw.filter((status) => VALID_RETURN_STATUSES.has(status));
    if (statuses.length > 0) query = query.in("status", statuses);
  }

  query = applyCreatedAtRangeFilter(query, params.filters);

  const createdBy = params.filters?.createdBy;
  if (typeof createdBy === "string" && createdBy) {
    query = query.eq("created_by", createdBy);
  }

  const amountMin = Number(params.filters?.amountMin);
  const amountMax = Number(params.filters?.amountMax);
  if (Number.isFinite(amountMin) && amountMin >= 0) {
    query = query.gte("total", amountMin);
  }
  if (Number.isFinite(amountMax) && amountMax >= 0) {
    query = query.lte("total", amountMax);
  }

  const refundState = params.filters?.refundState;
  if (refundState === "none") query = query.lte("refunded", 0);
  if (refundState === "recorded") query = query.gt("refunded", 0);

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
    { value: "draft", label: "Phiếu tạm" },
    { value: "confirmed", label: "Đã xác nhận" },
    { value: "completed", label: "Hoàn thành" },
    { value: "cancelled", label: "Đã hủy" },
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

  const profile = row.creator as { full_name: string } | null;
  const branch = row.branch as { name: string } | null;
  const customer = row.customer as { code?: string; phone?: string } | null;
  return {
    id: row.id,
    code: row.code,
    invoiceCode: (row.invoice as { code: string } | null)?.code ?? "---",
    invoiceId: row.invoice_id ?? undefined,
    date: row.created_at,
    customerCode: customer?.code ?? undefined,
    customerName: row.customer_name,
    customerPhone: customer?.phone ?? undefined,
    totalAmount: Number(row.total ?? 0),
    refundedAmount: Number(row.refunded ?? 0),
    status: VALID_RETURN_STATUSES.has(row.status) ? row.status : "draft",
    statusName: statusNameMap[row.status] ?? row.status,
    createdById: row.created_by ?? undefined,
    createdBy: profile?.full_name ?? row.created_by,
    branchId: row.branch_id ?? undefined,
    branchName: branch?.name ?? undefined,
    reason: row.reason ?? undefined,
    // 06/08: select("*") đã kéo note từ trước nhưng mapper bỏ rơi → panel
    // chi tiết không có gì để hiện.
    note: row.note ?? undefined,
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
