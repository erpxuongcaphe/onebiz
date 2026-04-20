/**
 * Supabase service: Invoices
 */

import type { Invoice, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError } from "./base";

export async function getInvoices(params: QueryParams): Promise<QueryResult<Invoice>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("invoices")
    .select("*, profiles!invoices_created_by_fkey(full_name)", { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,customer_name.ilike.%${params.search}%`);
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
  if (error) handleError(error, "getInvoices");

  const invoices: Invoice[] = (data ?? []).map(mapInvoice);
  return { data: invoices, total: count ?? 0 };
}

export function getInvoiceStatuses() {
  // Static statuses - could be enhanced with counts from DB
  return [
    { label: "Hoàn thành", value: "completed", count: 0 },
    { label: "Đang xử lý", value: "confirmed", count: 0 },
    { label: "Phiếu tạm", value: "draft", count: 0 },
    { label: "Đã hủy", value: "cancelled", count: 0 },
  ];
}

/**
 * Lấy lịch sử bán hàng của 1 khách hàng cụ thể (dùng trong tab chi tiết KH).
 * Sắp xếp giảm dần theo ngày tạo, giới hạn mặc định 50 dòng.
 */
export async function getInvoicesForCustomer(
  customerId: string,
  limit: number = 50
): Promise<Invoice[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, profiles!invoices_created_by_fkey(full_name)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getInvoicesForCustomer");
  return (data ?? []).map(mapInvoice);
}

/**
 * Lấy lịch sử trả hàng của 1 khách hàng cụ thể.
 */
export interface CustomerReturn {
  id: string;
  code: string;
  invoiceCode: string;
  date: string;
  totalAmount: number;
  status: string;
}

export async function getReturnsForCustomer(
  customerId: string,
  limit: number = 50
): Promise<CustomerReturn[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("sales_returns")
    .select("id, code, total, status, created_at, invoices!sales_returns_invoice_id_fkey(code)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getReturnsForCustomer");

  return (data ?? []).map((row) => {
    const inv = row.invoices as unknown as { code: string } | null;
    return {
      id: row.id,
      code: row.code,
      invoiceCode: inv?.code ?? "—",
      date: row.created_at,
      totalAmount: Number(row.total ?? 0),
      status: row.status,
    };
  });
}

/**
 * Hủy hóa đơn — chỉ cho phép hủy hóa đơn ở trạng thái draft hoặc confirmed.
 * Hóa đơn đã hoàn thành (completed) hoặc đã hủy (cancelled) sẽ bị từ chối.
 */
export async function cancelInvoice(id: string): Promise<void> {
  const supabase = getClient();

  // Check current status first
  const { data: existing, error: fetchErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchErr) handleError(fetchErr, "cancelInvoice.fetch");
  if (!existing) throw new Error("Không tìm thấy hóa đơn");

  const allowCancel = ["draft", "confirmed"];
  if (!allowCancel.includes(existing.status)) {
    throw new Error(
      `Không thể hủy hóa đơn ở trạng thái "${existing.status}". Chỉ cho phép hủy hóa đơn phiếu tạm hoặc đã xác nhận.`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from("invoices")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ status: "cancelled" as any })
    .eq("id", id);

  if (error) handleError(error, "cancelInvoice.update");
}

/**
 * Sửa hóa đơn — chỉ cho phép sửa khi status = draft hoặc confirmed.
 * Hóa đơn đã completed/cancelled không thể sửa.
 *
 * Chỉ cho sửa các field "mềm" (customer info, discount, note, payment_method).
 * Không cho sửa status / paid / debt / total / created_by qua hàm này — những
 * field đó phải đi qua flow riêng (thu nợ, hủy, v.v.).
 */
export interface UpdateInvoicePatch {
  customerId?: string | null;
  customerName?: string;
  discountAmount?: number;
  paymentMethod?: "cash" | "transfer" | "card" | "mixed";
  note?: string;
}

export async function updateInvoice(
  id: string,
  patch: UpdateInvoicePatch
): Promise<void> {
  const supabase = getClient();

  // Check current status first
  const { data: existing, error: fetchErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", id)
    .single();

  if (fetchErr) handleError(fetchErr, "updateInvoice.fetch");
  if (!existing) throw new Error("Không tìm thấy hóa đơn");

  const allowEdit = ["draft", "confirmed"];
  if (!allowEdit.includes(existing.status)) {
    throw new Error(
      `Không thể sửa hóa đơn ở trạng thái "${existing.status}". Chỉ cho phép sửa hóa đơn phiếu tạm hoặc đã xác nhận.`
    );
  }

  // Build DB patch (camelCase → snake_case)
  const dbPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.customerId !== undefined) dbPatch.customer_id = patch.customerId;
  if (patch.customerName !== undefined) dbPatch.customer_name = patch.customerName;
  if (patch.discountAmount !== undefined) dbPatch.discount_amount = patch.discountAmount;
  if (patch.paymentMethod !== undefined) dbPatch.payment_method = patch.paymentMethod;
  if (patch.note !== undefined) dbPatch.note = patch.note;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from("invoices")
    .update(dbPatch as any)
    .eq("id", id);

  if (error) handleError(error, "updateInvoice.update");
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInvoice(row: any): Invoice {
  const statusMap: Record<string, string> = {
    draft: "processing",
    confirmed: "processing",
    completed: "completed",
    cancelled: "cancelled",
  };

  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    customerId: row.customer_id ?? "",
    customerCode: "", // Would need join to customers table
    customerName: row.customer_name,
    totalAmount: row.total,
    discount: row.discount_amount,
    taxAmount: Number(row.tax_amount ?? 0),
    paid: Number(row.paid ?? 0),
    debt: Number(row.debt ?? 0),
    status: (statusMap[row.status] ?? row.status) as Invoice["status"],
    deliveryType: "no_delivery", // Would need join to shipping_orders
    createdBy: (row.profiles as { full_name: string } | null)?.full_name ?? "---",
  };
}
