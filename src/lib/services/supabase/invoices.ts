/**
 * Supabase service: Invoices
 */

import type { Invoice, QueryParams, QueryResult } from "@/lib/types";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";

export async function getInvoices(params: QueryParams): Promise<QueryResult<Invoice>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("invoices")
    .select(
      "*, profiles!invoices_created_by_fkey(full_name), branches!invoices_branch_id_fkey(name), customers!invoices_customer_id_fkey(code, phone)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

  // Search — escape % wildcard.
  // Note: search by SĐT KH cần subquery customers.phone — chưa wire vì
  // invoices.customer_phone không tồn tại; search hiện chỉ trên code +
  // customer_name (text snapshot lúc tạo HD).
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `code.ilike.%${esc}%,customer_name.ilike.%${esc}%`,
    );
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
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("invoices")
    .select("*, profiles!invoices_created_by_fkey(full_name)")
    .eq("tenant_id", tenantId)
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
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("sales_returns")
    .select("id, code, total, status, created_at, invoices!sales_returns_invoice_id_fkey(code)")
    .eq("tenant_id", tenantId)
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
// ============================================================
// F&B Order History — fetch today's completed FnB invoices
// for reprint / lookup ở POS FnB.
// ============================================================

export interface FnbRecentInvoice {
  id: string;
  code: string;
  customerName: string;
  total: number;
  paid: number;
  tipAmount: number;
  paymentMethod: string;
  createdAt: string;
  kitchenOrderNumber: string | null;
  tableName: string | null;
  orderType: string;
}

export async function getFnbRecentInvoices(params: {
  branchId: string;
  limit?: number;
  search?: string;
}): Promise<FnbRecentInvoice[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("invoices")
    .select("id, code, customer_name, total, paid, tip_amount, payment_method, created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", params.branchId)
    .eq("source", "fnb")
    .eq("status", "completed")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(params.limit ?? 50);

  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(`code.ilike.%${esc}%,customer_name.ilike.%${esc}%`);
  }

  const { data, error } = await query;
  if (error) handleError(error, "getFnbRecentInvoices");

  // Supabase generated types chưa biết về cột `tip_amount` (migration 00035 mới).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = ((data ?? []) as unknown) as any[];

  const invoiceIds = rows.map((r) => r.id);
  if (invoiceIds.length === 0) return [];

  // Lookup kitchen orders separately (kitchen_orders.invoice_id → invoices.id)
  const { data: kos } = await supabase
    .from("kitchen_orders")
    .select("invoice_id, order_number, order_type, table_id, restaurant_tables(table_number)")
    .in("invoice_id", invoiceIds);

  const koMap = new Map<string, { orderNumber: string; orderType: string; tableName: string | null }>();
  (kos ?? []).forEach((ko) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const k = ko as any;
    if (!k.invoice_id) return;
    const tbl = k.restaurant_tables;
    const tableNumber = Array.isArray(tbl) ? tbl[0]?.table_number : tbl?.table_number;
    koMap.set(k.invoice_id, {
      orderNumber: k.order_number,
      orderType: k.order_type,
      tableName: tableNumber ? `Bàn ${tableNumber}` : null,
    });
  });

  return rows.map((row) => {
    const ko = koMap.get(row.id);
    return {
      id: row.id,
      code: row.code,
      customerName: row.customer_name ?? "Khách lẻ",
      total: Number(row.total ?? 0),
      paid: Number(row.paid ?? 0),
      tipAmount: Number(row.tip_amount ?? 0),
      paymentMethod: row.payment_method ?? "cash",
      createdAt: row.created_at,
      kitchenOrderNumber: ko?.orderNumber ?? null,
      tableName: ko?.tableName ?? null,
      orderType: ko?.orderType ?? "takeaway",
    };
  });
}

/** Load full invoice with items for reprint. */
export async function getFnbInvoiceForReprint(invoiceId: string): Promise<{
  invoiceCode: string;
  customerName: string;
  total: number;
  paid: number;
  tipAmount: number;
  discountAmount: number;
  paymentMethod: string;
  createdAt: string;
  orderNumber: string;
  tableName: string | null;
  orderType: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  const { data: invRaw, error: invErr } = await supabase
    .from("invoices")
    .select("id, code, customer_name, total, paid, tip_amount, discount_amount, payment_method, created_at")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .single();

  if (invErr) handleError(invErr, "getFnbInvoiceForReprint.invoice");
  if (!invRaw) throw new Error("Không tìm thấy hoá đơn");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv = invRaw as any;

  const { data: ko } = await supabase
    .from("kitchen_orders")
    .select("order_number, order_type, table_id, restaurant_tables(table_number)")
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  const { data: items, error: itemsErr } = await supabase
    .from("invoice_items")
    .select("product_name, quantity, unit_price, total")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });

  if (itemsErr) handleError(itemsErr, "getFnbInvoiceForReprint.items");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const k = ko as any;
  const tbl = k?.restaurant_tables;
  const tableNumber = Array.isArray(tbl) ? tbl[0]?.table_number : tbl?.table_number;

  return {
    invoiceCode: inv.code,
    customerName: inv.customer_name ?? "Khách lẻ",
    total: Number(inv.total ?? 0),
    paid: Number(inv.paid ?? 0),
    tipAmount: Number(inv.tip_amount ?? 0),
    discountAmount: Number(inv.discount_amount ?? 0),
    paymentMethod: inv.payment_method ?? "cash",
    createdAt: inv.created_at,
    orderNumber: k?.order_number ?? inv.code,
    tableName: tableNumber ? `Bàn ${tableNumber}` : null,
    orderType: k?.order_type ?? "takeaway",
    items: (items ?? []).map((it) => ({
      name: it.product_name,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      total: Number(it.total),
    })),
  };
}

export async function cancelInvoice(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Check current status first
  const { data: existing, error: fetchErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("tenant_id", tenantId)
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
    .eq("tenant_id", tenantId)
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
  const tenantId = await getCurrentTenantId();

  // Check current status first
  const { data: existing, error: fetchErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("tenant_id", tenantId)
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
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "updateInvoice.update");
}

/**
 * Lấy line items của một hóa đơn cho detail panel.
 *
 * Trước đây panel detail render hardcoded "Sản phẩm mẫu" — vì service
 * chưa có hàm fetch items theo invoice_id. Production sẽ thấy 1 dòng
 * fake cho MỌI HD → sai số liệu.
 */
export interface InvoiceItemRow {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  unit?: string;
}

export async function getInvoiceItems(
  invoiceId: string,
): Promise<InvoiceItemRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Verify invoice thuộc tenant trước (defense-in-depth — invoice_items
  // không có tenant_id direct, dùng FK qua invoice).
  const { data: inv } = await supabase
    .from("invoices")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (!inv) return [];

  // Schema invoice_items không có cột product_code — phải join `products(code)`.
  // Schema cũng dùng `discount` (không phải `discount_amount`) cho line item.
  // Field `unit` có sẵn trên invoice_items (snapshot lúc tạo HD).
  const { data, error } = await supabase
    .from("invoice_items")
    .select(
      "id, product_id, product_name, unit, quantity, unit_price, discount, total, products!invoice_items_product_id_fkey(code)",
    )
    .eq("invoice_id", invoiceId);

  if (error) {
    console.warn("[getInvoiceItems]", error.message);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    productCode: row.products?.code ?? "",
    productName: row.product_name ?? "",
    quantity: Number(row.quantity ?? 0),
    unitPrice: Number(row.unit_price ?? 0),
    discount: Number(row.discount ?? 0),
    total: Number(row.total ?? 0),
    unit: row.unit ?? undefined,
  }));
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

  const branch = row.branches as { name: string } | null;
  const customer = row.customers as { code: string; phone: string } | null;

  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    customerId: row.customer_id ?? "",
    // Lấy mã KH từ join customers (trước hardcode "" → cột "Mã KH" UI
    // luôn hiện "—" dù KH có code thật).
    customerCode: customer?.code ?? "",
    customerName: row.customer_name,
    totalAmount: row.total,
    discount: row.discount_amount,
    taxAmount: Number(row.tax_amount ?? 0),
    paid: Number(row.paid ?? 0),
    debt: Number(row.debt ?? 0),
    status: (statusMap[row.status] ?? row.status) as Invoice["status"],
    branchId: row.branch_id ?? undefined,
    branchName: branch?.name ?? undefined,
    deliveryType: "no_delivery", // Would need join to shipping_orders
    createdBy: (row.profiles as { full_name: string } | null)?.full_name ?? "---",
  };
}
