/**
 * Supabase service: Invoices
 */

import type { Invoice, QueryParams, QueryResult } from "@/lib/types";
import {
  applyCreatedAtRangeFilter,
  normalizeCreatedAtRange,
} from "@/lib/utils/list-date-preset-range";
import { getClient, getPaginationRange, handleError, getCurrentTenantId } from "./base";

export async function getInvoices(params: QueryParams): Promise<QueryResult<Invoice>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("invoices")
    .select(
      "*, profiles!invoices_created_by_fkey(full_name), branches!invoices_branch_id_fkey(name), customers!invoices_customer_id_fkey(code, phone, address, debt)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId)
    // 00173: ẩn đơn nháp đã xóa mềm khỏi list Hóa đơn.
    .is("deleted_at", null);

  // Search — escape % wildcard.
  // Note: search by SĐT KH cần subquery customers.phone — chưa wire vì
  // invoices.customer_phone không tồn tại; search hiện chỉ trên code +
  // customer_name (text snapshot lúc tạo HD).
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    // CEO 04/07: tìm theo cột chọn — "all"/lạ → OR mã+tên KH như cũ.
    if (params.searchField === "code") query = query.ilike("code", `%${esc}%`);
    else if (params.searchField === "customer_name")
      query = query.ilike("customer_name", `%${esc}%`);
    else
      query = query.or(
        `code.ilike.%${esc}%,customer_name.ilike.%${esc}%`,
      );
  }
  // Filter: status (single value or array)
  if (params.filters?.status && params.filters.status !== "all") {
    if (Array.isArray(params.filters.status)) {
      const dbStatuses = (params.filters.status as string[]).flatMap((s) =>
        s === "processing" ? ["draft", "confirmed"] : [s],
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = query.in("status", dbStatuses as any);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = query.eq("status", params.filters.status as any);
    }
  }
  query = applyCreatedAtRangeFilter(query, params.filters);
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

  // BATCH 3R: gắn tổng tiền đã trả per HĐ → badge "Đã trả 1 phần"/"toàn bộ".
  //   1 query gộp cho cả trang (KHÔNG N+1): aggregate sales_returns theo
  //   invoice_id của trang hiện tại. Fail-soft: lỗi chỉ log, badge không hiện.
  const pageIds = invoices.map((i) => i.id);
  if (pageIds.length > 0) {
    const { data: retRows, error: retErr } = await supabase
      .from("sales_returns")
      .select("invoice_id, total")
      .eq("tenant_id", tenantId)
      .eq("status", "completed")
      .in("invoice_id", pageIds);
    if (retErr) {
      console.warn("[getInvoices] aggregate sales_returns:", retErr.message);
    } else {
      const returnedMap = new Map<string, number>();
      for (const r of retRows ?? []) {
        const invId = (r as { invoice_id: string | null }).invoice_id;
        if (!invId) continue;
        const amt = Number((r as { total: number | null }).total ?? 0);
        returnedMap.set(invId, (returnedMap.get(invId) ?? 0) + amt);
      }
      for (const inv of invoices) {
        const returned = returnedMap.get(inv.id);
        if (returned && returned > 0) inv.returnedAmount = returned;
      }
    }
  }

  return { data: invoices, total: count ?? 0 };
}

/**
 * Lấy 1 hóa đơn theo id — CÙNG select (join công nợ KH) + mapInvoice như
 * getInvoices. CEO 14/07: POS in phiếu sau checkout đọc chính HĐ vừa lưu rồi
 * in QUA CÙNG buildInvoicePrintData như trang Hóa đơn → khớp 100% (kể cả khối
 * "Nợ cũ/Còn nợ" đọc công nợ KH thời gian thực). Trả null nếu không thấy.
 */
export async function getInvoiceById(id: string): Promise<Invoice | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("invoices")
    .select(
      "*, profiles!invoices_created_by_fkey(full_name), branches!invoices_branch_id_fkey(name), customers!invoices_customer_id_fkey(code, phone, address, debt)",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) handleError(error, "getInvoiceById");
  return data ? mapInvoice(data) : null;
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
  kitchenOrderId: string | null;
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
    .select("id, invoice_id, order_number, order_type, table_id, restaurant_tables!kitchen_orders_table_id_fkey(table_number)")
    .in("invoice_id", invoiceIds);

  const koMap = new Map<string, { id: string; orderNumber: string; orderType: string; tableName: string | null }>();
  (kos ?? []).forEach((ko) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const k = ko as any;
    if (!k.invoice_id) return;
    const tbl = k.restaurant_tables;
    const tableNumber = Array.isArray(tbl) ? tbl[0]?.table_number : tbl?.table_number;
    koMap.set(k.invoice_id, {
      id: k.id,
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
      kitchenOrderId: ko?.id ?? null,
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
  /** Migration 00070: platform commission for accurate reprint. */
  deliveryPlatform: string | null;
  platformCommissionPercent: number;
  platformCommissionAmount: number;
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
    // invoices có platform_commission (KHÔNG có platform_commission_amount —
    // cột đó thuộc kitchen_orders). Danh sách cột cũ copy nhầm nên select lỗi
    // 42703 → in lại hoá đơn F&B chết hoàn toàn.
    .select("id, code, customer_name, total, paid, tip_amount, discount_amount, payment_method, created_at, platform_commission, platform_commission_percent")
    .eq("tenant_id", tenantId)
    .eq("id", invoiceId)
    .single();

  if (invErr) handleError(invErr, "getFnbInvoiceForReprint.invoice");
  if (!invRaw) throw new Error("Không tìm thấy hoá đơn");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inv = invRaw as any;

  const { data: ko } = await supabase
    .from("kitchen_orders")
    .select("order_number, order_type, table_id, delivery_platform, restaurant_tables!kitchen_orders_table_id_fkey(table_number)")
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  const { data: items, error: itemsErr } = await supabase
    .from("invoice_items")
    .select("product_name, quantity, unit_price, total")
    // invoice_items KHÔNG có created_at → .order("created_at") lỗi 42703.
    // Dòng trả về theo thứ tự ghi, đúng thứ tự trên bill gốc.
    .eq("invoice_id", invoiceId);

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
    deliveryPlatform: k?.delivery_platform ?? null,
    platformCommissionPercent: Number(inv.platform_commission_percent ?? 0),
    platformCommissionAmount: Number(inv.platform_commission ?? 0),
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
  const { error } = await (supabase.rpc as any)(
    "cancel_draft_invoice_atomic",
    {
      p_invoice_id: id,
      p_reason: "Hủy từ giao diện hóa đơn",
    },
  );
  if (error) handleError(error, "cancelInvoice");
}

/**
 * CEO 29/05/2026: Hủy + HOÀN TÁC hóa đơn ĐÃ HOÀN THÀNH (giữ bản ghi).
 *
 * Khác cancelInvoice (chỉ flip status cho draft/confirmed), hàm này gọi RPC
 * atomic `void_completed_invoice_atomic` đảo ngược ĐÚNG side-effect của
 * checkout: hoàn kho (SKU + NVL theo BOM, mirror bất đối xứng products.stock
 * vs branch_stock), hồi lô FIFO, ghi phiếu chi hoàn tiền, đảo điểm loyalty,
 * zero invoices.debt, set status='cancelled'. Tất cả trong 1 transaction —
 * an toàn với dữ liệu đang chạy.
 *
 * Bản ghi invoice + invoice_items + movement gốc được GIỮ NGUYÊN cho audit;
 * RPC chỉ thêm movement bù (reference_type='invoice_void').
 */
export async function voidCompletedInvoice(params: {
  invoiceId: string;
  reason: string;
  /** Phương thức hoàn tiền; bỏ trống để giữ phương thức lúc bán. */
  refundMethod?: "cash" | "transfer" | "card";
}): Promise<{
  reversedCash: number;
  reversedStockMovements: number;
}> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "void_completed_invoice_atomic_v2",
    {
      p_invoice_id: params.invoiceId,
      p_reason: params.reason,
      p_refund_method: params.refundMethod ?? null,
      p_shift_id: null,
    },
  );
  if (error) handleError(error, "voidCompletedInvoice.atomic_v2");

  const result = (data ?? {}) as {
    reversed_cash?: number;
    reversed_stock_movements?: number;
  };

  return {
    reversedCash: Number(result.reversed_cash ?? 0),
    reversedStockMovements: Number(result.reversed_stock_movements ?? 0),
  };
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
  patch: UpdateInvoicePatch,
): Promise<void> {
  const supabase = getClient();
  const serverPatch: Record<string, unknown> = {};
  if (patch.customerId !== undefined) serverPatch.customerId = patch.customerId;
  if (patch.customerName !== undefined) serverPatch.customerName = patch.customerName;
  if (patch.discountAmount !== undefined) serverPatch.discountAmount = patch.discountAmount;
  if (patch.paymentMethod !== undefined) serverPatch.paymentMethod = patch.paymentMethod;
  if (patch.note !== undefined) serverPatch.note = patch.note;

  const { error } = await (supabase.rpc as any)(
    "update_draft_invoice_atomic",
    { p_invoice_id: id, p_patch: serverPatch },
  );
  if (error) handleError(error, "updateInvoice");
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
  /** 00208: ghi chú từng món — in ra phiếu. */
  note?: string;
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
  // 00208: select("*") + join để lấy cả note mà không vỡ trước khi migrate.
  const { data, error } = await supabase
    .from("invoice_items")
    .select("*, products!invoice_items_product_id_fkey(code)")
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
    note: row.note ?? undefined, // 00208
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
  const customer = row.customers as {
    code: string;
    phone: string | null;
    address: string | null;
    debt: number | string | null;
  } | null;

  return {
    id: row.id,
    code: row.code,
    // Mã đơn gốc DH/NH trước khi hoàn tất → HD (00169) — truy vết ở trang Hóa đơn.
    orderCode: row.order_code ?? undefined,
    date: row.created_at,
    customerId: row.customer_id ?? "",
    // Lấy mã KH từ join customers (trước hardcode "" → cột "Mã KH" UI
    // luôn hiện "—" dù KH có code thật).
    customerCode: customer?.code ?? "",
    customerName: row.customer_name,
    // SĐT / địa chỉ / dư nợ hiện tại — phục vụ in phiếu (địa chỉ + khối công nợ).
    customerPhone: customer?.phone ?? undefined,
    customerAddress: customer?.address ?? undefined,
    customerCurrentDebt:
      customer?.debt != null ? Number(customer.debt) : undefined,
    totalAmount: row.total,
    discount: row.discount_amount,
    // Phí giao hàng = cột delivery_fee (00018; FnB RPC cũng ghi cột này,
    // total ĐÃ gồm phí). invoices KHÔNG có cột shipping_fee (verify DB 08/07).
    shippingFee: Number(row.delivery_fee ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    paid: Number(row.paid ?? 0),
    debt: Number(row.debt ?? 0),
    status: (statusMap[row.status] ?? row.status) as Invoice["status"],
    branchId: row.branch_id ?? undefined,
    branchName: branch?.name ?? undefined,
    deliveryType: "no_delivery", // Would need join to shipping_orders
    // CEO 08/07: ghi chú người bán — để in trên hóa đơn (print-templates).
    note: row.note ?? undefined,
    // 00179: tiền khách đưa thực tế tại POS — in lại tái hiện Khách đưa/Thối.
    amountTendered:
      row.amount_tendered != null ? Number(row.amount_tendered) : undefined,
    createdBy: (row.profiles as { full_name: string } | null)?.full_name ?? "---",
  };
}

// ────────────────────────────────────────────────────────────
// K2 — CHỈ SỐ MÀN HOÁ ĐƠN (RPC 00305)
//
// Vì sao có: trước đây 4 thẻ KPI cộng từ `data` — tức CHỈ 15 dòng của trang
// đang xem — nhưng đặt cạnh "Tổng HĐ" lấy từ `total` của cả bộ lọc. Sang
// trang 2 là ba số đổi, số đầu đứng yên.
//
// RPC tự chốt tenant + phạm vi chi nhánh phía máy chủ và TỰ ánh xạ
// processing → draft + confirmed. Client KHÔNG ánh xạ lần hai — truyền thẳng
// trạng thái của giao diện vào.
// ────────────────────────────────────────────────────────────

export interface InvoiceListSummary {
  /** Mọi trạng thái còn sống — BỎ QUA riêng bộ lọc trạng thái. */
  tatCaHoaDon: number;
  hoanThanh: number;
  daHuy: number;
  /** sum(total) của hoá đơn completed. total ĐÃ trừ giảm giá — không trừ lần hai. */
  giaTriHoanThanh: number;
  /** Hiển thị riêng, KHÔNG trừ khỏi giaTriHoanThanh. */
  giamGiaApDung: number;
  /** ÁP bộ lọc trạng thái → phải khớp `total` của danh sách. Dùng để đối chiếu. */
  soDongTheoBoLoc: number;
}

export interface InvoiceListSummaryParams {
  branchId?: string;
  /** Nhận NGUYÊN dateFrom/dateTo của danh sách; hàm tự quy về mốc đầu ngày kế tiếp. */
  dateFrom?: string;
  dateTo?: string;
  /** Trạng thái đúng như giao diện đang chọn, kể cả 'processing'. */
  statuses?: string[];
  search?: string;
  searchField?: string;
  /** 'all' | 'delivery' | 'no_delivery'. K2 luôn 'all' — bộ lọc giao hàng thuộc K3. */
  delivery?: "all" | "delivery" | "no_delivery";
}

export async function getInvoiceListSummary(
  params: InvoiceListSummaryParams,
): Promise<InvoiceListSummary> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = getClient() as any;
  // Cùng một bộ quy tắc ngày với danh sách: >= from, < đầu ngày kế tiếp.
  const { from, toExclusive } = normalizeCreatedAtRange({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });

  const { data, error } = await supabase.rpc("get_invoice_list_summary", {
    p_branch_id: params.branchId ?? null,
    p_date_from: from ?? null,
    p_date_to_exclusive: toExclusive ?? null,
    p_statuses: params.statuses && params.statuses.length > 0 ? params.statuses : null,
    p_search: params.search && params.search !== "" ? params.search : null,
    p_search_field: params.searchField ?? "all",
    p_delivery: params.delivery ?? "all",
  });
  if (error) handleError(error, "getInvoiceListSummary");

  const row = Array.isArray(data) ? data[0] : data;
  return {
    tatCaHoaDon: Number(row?.tat_ca_hoa_don ?? 0),
    hoanThanh: Number(row?.hoan_thanh ?? 0),
    daHuy: Number(row?.da_huy ?? 0),
    giaTriHoanThanh: Number(row?.gia_tri_hoan_thanh ?? 0),
    giamGiaApDung: Number(row?.giam_gia_ap_dung ?? 0),
    soDongTheoBoLoc: Number(row?.so_dong_theo_bo_loc ?? 0),
  };
}

/**
 * Khoá nhớ tạm cho chỉ số: gồm MỌI bộ lọc ảnh hưởng kết quả, KHÔNG gồm số
 * trang — lật trang không được gọi lại RPC.
 */
export function khoaChiSoHoaDon(params: InvoiceListSummaryParams): string {
  return JSON.stringify([
    params.branchId ?? "",
    params.dateFrom ?? "",
    params.dateTo ?? "",
    [...(params.statuses ?? [])].sort(),
    params.search ?? "",
    params.searchField ?? "all",
    params.delivery ?? "all",
  ]);
}

/**
 * Bộ nhớ tạm + chống kết quả cũ đè kết quả mới cho dải chỉ số.
 *
 * Tách khỏi component để test được hành vi thật, không phải bản sao logic.
 *
 * Quy tắc sống còn: `batDau()` LUÔN tăng số lượt, kể cả khi khoá đã có sẵn
 * trong nhớ tạm. Nếu chỉ tăng ở nhánh gọi mạng thì: lượt A đang bay → đổi
 * sang bộ lọc B đã có nhớ tạm → thoát sớm không tăng lượt → A về muộn vẫn
 * được coi là mới nhất và ghi đè số của B.
 */
export function taoBoNhoChiSo() {
  let luotHienTai = 0;
  const nho = new Map<string, InvoiceListSummary>();
  return {
    batDau(khoa: string): { luot: number; sanCo: InvoiceListSummary | undefined } {
      return { luot: ++luotHienTai, sanCo: nho.get(khoa) };
    },
    conMoiNhat(luot: number): boolean {
      return luot === luotHienTai;
    },
    luu(khoa: string, kq: InvoiceListSummary): void {
      nho.set(khoa, kq);
    },
    /** Gọi sau mọi thao tác đổi dữ liệu hoá đơn — số cũ không còn đúng nữa. */
    xoaHet(): void {
      nho.clear();
    },
  };
}
export type BoNhoChiSo = ReturnType<typeof taoBoNhoChiSo>;

/**
 * Quyết định phạm vi chi nhánh cho MỌI truy vấn của màn Hoá đơn.
 *
 * Một cửa duy nhất, để không nơi nào lỡ tay bắn truy vấn toàn tenant. Trước
 * đây có ba chỗ tự ghép điều kiện, và chỗ "đếm hoá đơn ở chi nhánh khác" bị
 * bỏ sót — nó chạy `branchId: undefined` kể cả với người không có quyền.
 */
export function phamViChiNhanhHoaDon(opts: {
  activeBranchId?: string;
  viewAllBranches: boolean;
  duocXemToanChuoi: boolean;
}): {
  /** undefined = toàn tenant. Chỉ xảy ra khi CÓ quyền. */
  branchId: string | undefined;
  /** Có được phép chạy truy vấn đếm ở chi nhánh khác không. */
  duocDemChiNhanhKhac: boolean;
} {
  const toanChuoi = opts.viewAllBranches && opts.duocXemToanChuoi;
  return {
    branchId: toanChuoi ? undefined : opts.activeBranchId,
    duocDemChiNhanhKhac:
      opts.duocXemToanChuoi && !opts.viewAllBranches && !!opts.activeBranchId,
  };
}
