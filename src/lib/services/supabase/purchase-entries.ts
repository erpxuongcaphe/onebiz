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
import type { PurchaseOrderImportRow } from "@/lib/excel/schemas";
import { applyCreatedAtRangeFilter } from "@/lib/utils/list-date-preset-range";
import { getClient, getCurrentTenantId, getPaginationRange, handleError } from "./base";
import { recordAuditLog } from "./audit";
import { updatePurchaseOrderStatus } from "./purchase-orders";

type SupplierReturnPaymentMethod = "cash" | "transfer" | "card";


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCreatedAtRange(query: any, filters: QueryParams["filters"] | undefined) {
  return applyCreatedAtRangeFilter(query, filters);
}

// ==================== Purchase Order Entries (Đặt hàng nhập) ====================

export async function getPurchaseOrderEntries(
  params: QueryParams
): Promise<QueryResult<PurchaseOrderEntry>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("purchase_orders")
    .select("*, profiles!purchase_orders_created_by_fkey(full_name)", { count: "exact" })
    .eq("tenant_id", tenantId);

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

  query = applyCreatedAtRange(query, params.filters);

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

/**
 * Huỷ đơn đặt hàng nhập.
 *
 * Chỉ cho phép huỷ khi đơn đang ở trạng thái draft / ordered / partial
 * (không cho huỷ đơn đã completed hoặc đã cancelled trước đó).
 *
 * Lưu `reason` vào note để có audit trail — sau này Sprint KHO-2
 * sẽ wire vào audit_log riêng thay vì ghi đè note.
 */
export async function cancelPurchaseOrderEntry(
  id: string,
  reason?: string,
): Promise<void> {
  await updatePurchaseOrderStatus(
    id,
    "cancelled",
    reason ?? "Hủy đơn đặt hàng nhập",
  );
}

/**
 * Export đơn đặt hàng nhập — trả về rows phẳng theo schema Excel Import.
 *
 * Mỗi line item = 1 row. Các line cùng PO được gộp qua cột "code" khi import lại.
 * Cho phép edit trong Excel rồi upload lại mà không mất field nào
 * (Plan 19/04 yêu cầu #2 — round-trip export/import).
 *
 * Không phân trang — export toàn bộ dữ liệu match filter. Gọi async nên UI
 * nên có toast báo "Đang chuẩn bị…" khi list lớn.
 */
export async function getPurchaseOrdersForExport(params: {
  search?: string;
  status?: string;
}): Promise<PurchaseOrderImportRow[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let headerQuery: any = supabase
    .from("purchase_orders")
    .select(
      "id, code, note, status, supplier:suppliers(code), branch:branches(code)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (params.search) {
    headerQuery = headerQuery.or(
      `code.ilike.%${params.search}%,supplier_name.ilike.%${params.search}%`
    );
  }

  if (params.status && params.status !== "all") {
    if (params.status === "pending") {
      headerQuery = headerQuery.in("status", ["draft", "ordered"]);
    } else {
      headerQuery = headerQuery.eq("status", params.status);
    }
  }

  const { data: headers, error: hErr } = await headerQuery;
  if (hErr) handleError(hErr, "getPurchaseOrdersForExport.headers");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerList = (headers ?? []) as any[];
  if (headerList.length === 0) return [];

  const poIds = headerList.map((h) => h.id as string);

  const { data: items, error: iErr } = await supabase
    .from("purchase_order_items")
    .select(
      "purchase_order_id, quantity, unit_price, discount, vat_rate, product:products(code)"
    )
    .in("purchase_order_id", poIds);
  if (iErr) handleError(iErr, "getPurchaseOrdersForExport.items");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerMap = new Map<string, any>();
  for (const h of headerList) headerMap.set(h.id, h);

  const rows: PurchaseOrderImportRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const it of (items ?? []) as any[]) {
    const h = headerMap.get(it.purchase_order_id);
    if (!h) continue;
    rows.push({
      code: h.code as string,
      supplierCode: (h.supplier?.code ?? "") as string,
      branchCode: (h.branch?.code ?? "") as string,
      note: (h.note ?? "") as string,
      productCode: (it.product?.code ?? "") as string,
      quantity: Number(it.quantity ?? 0),
      unitPrice: Number(it.unit_price ?? 0),
      discount: Number(it.discount ?? 0),
      vatRate: Number(it.vat_rate ?? 0),
    });
  }

  // Sort theo mã đơn để các dòng cùng PO nằm liền kề
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return rows;
}

// ==================== Purchase Returns (Trả hàng nhập) ====================

export async function getPurchaseReturns(
  params: QueryParams
): Promise<QueryResult<PurchaseReturn>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("supplier_returns")
    .select(
      "*, profiles!supplier_returns_created_by_fkey(full_name), branches!supplier_returns_branch_id_fkey(id,name)",
      { count: "exact" },
    )
    .eq("tenant_id", tenantId);

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

  // Filter: branch — tránh leak giữa các chi nhánh
  if (params.filters?.branchId && params.filters.branchId !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("branch_id", params.filters.branchId as any);
  }

  query = applyCreatedAtRange(query, params.filters);

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

/** Dòng hàng chuẩn để in chứng từ (khớp `toPrintLines`). */
export interface PrintItemRow {
  productCode?: string;
  productName: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

/**
 * Nạp dòng hàng của phiếu TRẢ HÀNG NHẬP (supplier_return_items) — để in chứng từ
 * hiện mặt hàng (In Pha 3 Item 1). Trả shape camelCase cho `toPrintLines`.
 */
export async function getPurchaseReturnItems(returnId: string): Promise<PrintItemRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("supplier_return_items")
    .select("product_name, unit, quantity, unit_price, total")
    .eq("return_id", returnId)
    .order("id", { ascending: true });
  if (error) handleError(error, "getPurchaseReturnItems");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const qty = Number(r.quantity ?? 0);
    const price = Number(r.unit_price ?? 0);
    return {
      productName: r.product_name ?? "",
      unit: r.unit ?? undefined,
      quantity: qty,
      unitPrice: price,
      total: Number(r.total ?? qty * price),
    };
  });
}

// ==================== Input Invoices (Hóa đơn đầu vào) ====================

export async function getInputInvoices(
  params: QueryParams
): Promise<QueryResult<InputInvoice>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("input_invoices")
    .select(
      "*, profiles!input_invoices_created_by_fkey(full_name), branches!input_invoices_branch_id_fkey(id,name)",
      { count: "exact" }
    )
    .eq("tenant_id", tenantId);

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

  // Filter: branch — quan trọng cho tenant có nhiều chi nhánh
  // để tránh leak hoá đơn giữa các chi nhánh.
  if (params.filters?.branchId && params.filters.branchId !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("branch_id", params.filters.branchId as any);
  }

  query = applyCreatedAtRange(query, params.filters);

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
 * Nạp dòng hàng của HÓA ĐƠN ĐẦU VÀO để in (In Pha 3 Item 1).
 * HĐ đầu vào auto-tạo từ phiếu nhập → lấy items từ purchase_order gốc.
 */
export async function getInputInvoiceItems(invoiceId: string): Promise<PrintItemRow[]> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: inv, error: invErr } = await sb
    .from("input_invoices")
    .select("purchase_order_id")
    .eq("id", invoiceId)
    .single();
  if (invErr) handleError(invErr, "getInputInvoiceItems:invoice");
  const poId = inv?.purchase_order_id;
  if (!poId) return [];

  const { data, error } = await sb
    .from("purchase_order_items")
    .select("product_name, quantity, unit_price, unit, products(code)")
    .eq("purchase_order_id", poId)
    .order("id", { ascending: true });
  if (error) handleError(error, "getInputInvoiceItems:items");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const qty = Number(r.quantity ?? 0);
    const price = Number(r.unit_price ?? 0);
    return {
      productCode: r.products?.code ?? "",
      productName: r.product_name ?? "",
      unit: r.unit ?? undefined,
      quantity: qty,
      unitPrice: price,
      total: qty * price,
    };
  });
}

/**
 * Xoá hóa đơn đầu vào (LEGACY — Stage 5b CEO 06/05/2026).
 *
 * Quy ước mới: KHÔNG xóa cứng nữa. Caller nên dùng `cancelInputInvoice()`
 * để giữ history. Hàm này chỉ giữ làm fallback khi caller cần xóa thật
 * (vd cleanup test data) — đã thêm audit log snapshot trước khi delete
 * để nếu cần truy lại vẫn có dấu vết.
 *
 * @deprecated Dùng `cancelInputInvoice` thay thế.
 */
export async function deleteInputInvoice(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot trước khi xóa cứng — đảm bảo có dấu vết audit log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  let oldRow: Record<string, unknown> | null = null;
  try {
    const res = await sb
      .from("input_invoices")
      .select("code, supplier_id, supplier_name, total_amount, status")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
  } catch {
    /* snapshot optional */
  }

  const { error } = await sb
    .from("input_invoices")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "deleteInputInvoice");

  await recordAuditLog({
    entityType: "input_invoice",
    entityId: id,
    action: "delete",
    oldData: oldRow,
    newData: null,
  });
}

/**
 * Hủy hóa đơn đầu vào — Stage 5b refactor (CEO 06/05/2026).
 *
 * Schema input_invoices.status CHECK chỉ accept ('recorded', 'unrecorded')
 * → không thể set 'cancelled' nếu không migrate trước. Tạm thời cancel ở đây
 * = revert status về 'unrecorded' + ghi audit log với action='cancel' +
 * lý do reason. UI list page filter status='unrecorded' sẽ thấy phiếu này
 * nhưng badge "Đã hủy" hiển thị từ audit_log.action='cancel' (thay vì status).
 *
 * Khi nào cần thật sự thêm status='cancelled' → cần migration update CHECK
 * constraint (defer KHO-2 vì impact rộng).
 *
 * @param id — input invoice id
 * @param reason — lý do hủy
 */
export async function cancelInputInvoice(
  id: string,
  reason: string,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Snapshot
  const { data: existing, error: fetchErr } = await sb
    .from("input_invoices")
    .select("code, status, supplier_id, supplier_name, total_amount")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .single();
  if (fetchErr) handleError(fetchErr, "cancelInputInvoice.fetch");
  if (!existing) throw new Error("Không tìm thấy hóa đơn đầu vào");

  // Nếu đang là recorded → revert về unrecorded để mark "đã hủy ghi sổ"
  if (existing.status === "recorded") {
    const { error: updErr } = await sb
      .from("input_invoices")
      .update({ status: "unrecorded", note: `[ĐÃ HỦY] ${reason}` })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (updErr) handleError(updErr, "cancelInputInvoice.update");
  } else {
    // Đang unrecorded → chỉ append note marker
    const { error: updErr } = await sb
      .from("input_invoices")
      .update({ note: `[ĐÃ HỦY] ${reason}` })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (updErr) handleError(updErr, "cancelInputInvoice.update");
  }

  await recordAuditLog({
    entityType: "input_invoice",
    entityId: id,
    action: "cancel",
    oldData: existing,
    newData: { status: existing.status, note: `[ĐÃ HỦY] ${reason}` },
  });
}

/**
 * Ghi sổ hóa đơn đầu vào — cập nhật status sang "recorded".
 * Chỉ cho phép ghi sổ hóa đơn đang ở trạng thái "unrecorded".
 */
export async function recordInputInvoice(id: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Kiểm tra trạng thái hiện tại
  const { data: existing, error: fetchErr } = await sb
    .from("input_invoices")
    .select("status")
    .eq("tenant_id", tenantId)
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
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) handleError(error, "recordInputInvoice.update");
}

// ==================== Complete Supplier Return (Trả hàng nhập hoàn chỉnh) ====================

interface SupplierReturnItem {
  purchaseOrderItemId: string;
  quantity: number;
}

interface CompleteSupplierReturnInput {
  purchaseOrderId: string;
  items: SupplierReturnItem[];
  reason?: string;
  note?: string;
  paymentMethod?: SupplierReturnPaymentMethod;
}

/**
 * Complete a supplier return in one database transaction.
 * The server derives branch, supplier, products, prices, totals, actor and codes.
 */
export async function completeSupplierReturn(
  input: CompleteSupplierReturnInput,
): Promise<{ returnId: string; returnCode: string }> {
  if (!input.purchaseOrderId) {
    throw new Error("Kh\u00f4ng t\u00ecm th\u1ea5y phi\u1ebfu nh\u1eadp g\u1ed1c");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Vui l\u00f2ng ch\u1ecdn \u00edt nh\u1ea5t m\u1ed9t s\u1ea3n ph\u1ea9m \u0111\u1ec3 tr\u1ea3");
  }

  const seenItemIds = new Set<string>();
  const items = input.items.map((item) => {
    if (!item.purchaseOrderItemId || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error("D\u00f2ng h\u00e0ng tr\u1ea3 kh\u00f4ng h\u1ee3p l\u1ec7");
    }
    if (seenItemIds.has(item.purchaseOrderItemId)) {
      throw new Error("D\u00f2ng h\u00e0ng tr\u1ea3 b\u1ecb tr\u00f9ng");
    }
    seenItemIds.add(item.purchaseOrderItemId);
    return {
      purchaseOrderItemId: item.purchaseOrderItemId,
      quantity: item.quantity,
    };
  });

  const supabase = getClient();
  // The generated types lag behind this new migration until the schema is pulled.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("create_supplier_return_atomic", {
    p_purchase_order_id: input.purchaseOrderId,
    p_items: items,
    p_reason: input.reason ?? null,
    p_note: input.note ?? null,
    p_payment_method: input.paymentMethod ?? "cash",
  });

  if (error) handleError(error, "completeSupplierReturn.atomic");

  const result = data as { return_id?: string; code?: string } | null;
  if (!result?.return_id || !result.code) {
    throw new Error("Kh\u00f4ng nh\u1eadn \u0111\u01b0\u1ee3c k\u1ebft qu\u1ea3 phi\u1ebfu tr\u1ea3 h\u00e0ng");
  }

  return { returnId: result.return_id, returnCode: result.code };
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
  const profile = row.profiles as { full_name: string } | null;
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
    createdByName: profile?.full_name ?? undefined,
  };
}

const purchaseReturnStatusNameMap: Record<string, string> = {
  completed: "Hoàn thành",
  draft: "Phiếu tạm",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPurchaseReturn(row: any): PurchaseReturn {
  const branch = row.branches as { id: string; name: string } | null;
  const profile = row.profiles as { full_name: string } | null;
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
    createdByName: profile?.full_name ?? undefined,
    branchId: row.branch_id ?? branch?.id ?? undefined,
    branchName: branch?.name ?? undefined,
  };
}

const inputInvoiceStatusNameMap: Record<string, string> = {
  recorded: "Đã ghi sổ",
  unrecorded: "Chưa ghi sổ",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInputInvoice(row: any): InputInvoice {
  const profile = row.profiles as { full_name: string } | null;
  const branch = row.branches as { id: string; name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    supplierName: row.supplier_name ?? "---",
    totalAmount: row.total_amount ?? row.total ?? 0,
    taxAmount: row.tax_amount ?? 0,
    status: (row.status === "recorded" ? "recorded" : "unrecorded") as InputInvoice["status"],
    statusName: inputInvoiceStatusNameMap[row.status] ?? row.status,
    createdBy: row.created_by ?? "---",
    createdByName: profile?.full_name ?? undefined,
    branchId: row.branch_id ?? branch?.id ?? undefined,
    branchName: branch?.name ?? undefined,
  };
}
