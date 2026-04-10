/**
 * Supabase service: Purchase Entries (Đặt hàng nhập, Trả hàng nhập, Hóa đơn đầu vào)
 *
 * - PurchaseOrderEntry → table `purchase_orders`
 * - PurchaseReturn     → table `supplier_returns` (migration 00012)
 * - InputInvoice       → table `input_invoices`   (migration 00012)
 */

import type {
  PurchaseOrderEntry,
  PurchaseReturn,
  InputInvoice,
  QueryParams,
  QueryResult,
} from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

// ==================== Purchase Order Entries (Đặt hàng nhập) ====================

export async function getPurchaseOrderEntries(
  params: QueryParams
): Promise<QueryResult<PurchaseOrderEntry>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("purchase_orders")
    .select("*", { count: "exact" });

  // Search theo mã hoặc tên NCC
  if (params.search) {
    query = query.or(
      `code.ilike.%${params.search}%,supplier_name.ilike.%${params.search}%`
    );
  }

  // Filter: status — FE dùng pending|partial|completed|cancelled
  // DB lưu draft|ordered|partial|completed|cancelled
  // Map FE "pending" → DB "draft" + "ordered"
  if (params.filters?.status && params.filters.status !== "all") {
    const feStatus = params.filters.status as string;
    if (feStatus === "pending") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = query.in("status", ["draft", "ordered"] as any);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = query.eq("status", feStatus as any);
    }
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getPurchaseOrderEntries");

  const entries: PurchaseOrderEntry[] = (data ?? []).map(mapPurchaseOrderEntry);
  return { data: entries, total: count ?? 0 };
}

export function getPurchaseEntryStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "pending", label: "Chờ nhập" },
    { value: "partial", label: "Nhập một phần" },
    { value: "completed", label: "Hoàn thành" },
    { value: "cancelled", label: "Đã hủy" },
  ];
}

// ==================== Purchase Returns (Trả hàng nhập) ====================

export async function getPurchaseReturns(
  params: QueryParams
): Promise<QueryResult<PurchaseReturn>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("supplier_returns")
    .select("*", { count: "exact" });

  // Search theo mã phiếu trả hoặc tên NCC
  if (params.search) {
    query = query.or(
      `code.ilike.%${params.search}%,supplier_name.ilike.%${params.search}%`
    );
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getPurchaseReturns");

  const returns: PurchaseReturn[] = (data ?? []).map(mapPurchaseReturn);
  return { data: returns, total: count ?? 0 };
}

export function getPurchaseReturnStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "completed", label: "Hoàn thành" },
    { value: "draft", label: "Phiếu tạm" },
  ];
}

// ==================== Input Invoices (Hóa đơn đầu vào) ====================

export async function getInputInvoices(
  params: QueryParams
): Promise<QueryResult<InputInvoice>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("input_invoices")
    .select("*", { count: "exact" });

  // Search theo mã hoặc tên NCC
  if (params.search) {
    query = query.or(
      `code.ilike.%${params.search}%,supplier_name.ilike.%${params.search}%`
    );
  }

  // Filter: status
  if (params.filters?.status && params.filters.status !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("status", params.filters.status as any);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInputInvoices");

  const invoices: InputInvoice[] = (data ?? []).map(mapInputInvoice);
  return { data: invoices, total: count ?? 0 };
}

export function getInputInvoiceStatuses() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "recorded", label: "Đã ghi sổ" },
    { value: "unrecorded", label: "Chưa ghi sổ" },
  ];
}

/**
 * Xoá hóa đơn đầu vào.
 */
export async function deleteInputInvoice(id: string): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("input_invoices")
    .delete()
    .eq("id", id);

  if (error) handleError(error, "deleteInputInvoice");
}

/**
 * Ghi sổ hóa đơn đầu vào — cập nhật status sang "recorded".
 * Chỉ cho phép ghi sổ hóa đơn đang ở trạng thái "unrecorded".
 */
export async function recordInputInvoice(id: string): Promise<void> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Kiểm tra trạng thái hiện tại
  const { data: existing, error: fetchErr } = await sb
    .from("input_invoices")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchErr) handleError(fetchErr, "recordInputInvoice.fetch");
  if (!existing) throw new Error("Không tìm thấy hóa đơn đầu vào");

  if (existing.status !== "unrecorded") {
    throw new Error(
      `Không thể ghi sổ hóa đơn ở trạng thái "${existing.status}". Chỉ cho phép ghi sổ hóa đơn chưa ghi sổ.`
    );
  }

  const { error } = await sb
    .from("input_invoices")
    .update({ status: "recorded" })
    .eq("id", id);

  if (error) handleError(error, "recordInputInvoice.update");
}

// ==================== Mappers ====================

/** Map DB status (draft|ordered|partial|completed|cancelled) → FE status */
const purchaseOrderStatusMap: Record<string, PurchaseOrderEntry["status"]> = {
  draft: "pending",
  ordered: "pending",
  partial: "partial",
  completed: "completed",
  cancelled: "cancelled",
};

const purchaseOrderStatusNameMap: Record<string, string> = {
  draft: "Chờ nhập",
  ordered: "Chờ nhập",
  partial: "Nhập một phần",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPurchaseOrderEntry(row: any): PurchaseOrderEntry {
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    supplierName: row.supplier_name ?? "---",
    totalAmount: row.total ?? 0,
    status: purchaseOrderStatusMap[row.status] ?? "pending",
    statusName: purchaseOrderStatusNameMap[row.status] ?? row.status,
    expectedDate: row.expected_date ?? "",
    createdBy: row.created_by ?? "---",
  };
}

const purchaseReturnStatusNameMap: Record<string, string> = {
  completed: "Hoàn thành",
  draft: "Phiếu tạm",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPurchaseReturn(row: any): PurchaseReturn {
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    importCode: row.import_code ?? "",
    supplierName: row.supplier_name ?? "---",
    totalAmount: row.total ?? 0,
    status: (row.status === "completed" ? "completed" : "draft") as PurchaseReturn["status"],
    statusName: purchaseReturnStatusNameMap[row.status] ?? row.status,
    createdBy: row.created_by ?? "---",
  };
}

const inputInvoiceStatusNameMap: Record<string, string> = {
  recorded: "Đã ghi sổ",
  unrecorded: "Chưa ghi sổ",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInputInvoice(row: any): InputInvoice {
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    supplierName: row.supplier_name ?? "---",
    totalAmount: row.total ?? 0,
    taxAmount: row.tax_amount ?? 0,
    status: (row.status === "recorded" ? "recorded" : "unrecorded") as InputInvoice["status"],
    statusName: inputInvoiceStatusNameMap[row.status] ?? row.status,
    createdBy: row.created_by ?? "---",
  };
}
