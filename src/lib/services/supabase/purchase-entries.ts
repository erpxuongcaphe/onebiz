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
import type { Database } from "@/lib/supabase/types";
import type { PurchaseOrderImportRow } from "@/lib/excel/schemas";
import { getClient, getCurrentContext, getPaginationRange, handleError } from "./base";
import { applyManualStockMovement, nextEntityCode } from "./stock-adjustments";

type CashTransactionInsert = Database["public"]["Tables"]["cash_transactions"]["Insert"];

// ==================== Purchase Order Entries (Đặt hàng nhập) ====================

export async function getPurchaseOrderEntries(
  params: QueryParams
): Promise<QueryResult<PurchaseOrderEntry>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("purchase_orders")
    .select("*, profiles!purchase_orders_created_by_fkey(full_name)", { count: "exact" });

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

/**
 * Huỷ đơn đặt hàng nhập.
 *
 * Chỉ cho phép huỷ khi đơn đang ở trạng thái draft / ordered / partial
 * (không cho huỷ đơn đã completed hoặc đã cancelled trước đó).
 *
 * Lưu `reason` vào note để có audit trail — sau này Sprint KHO-2
 * sẽ wire vào audit_log riêng thay vì ghi đè note.
 */
export async function cancelPurchaseOrderEntry(id: string, reason?: string): Promise<void> {
  const supabase = getClient();
  const { data: row, error } = await supabase
    .from("purchase_orders")
    .update({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: "cancelled" as any,
      note: reason ?? "Huỷ đơn đặt hàng nhập",
    })
    .eq("id", id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .in("status", ["draft", "ordered", "partial"] as any)
    .select("id")
    .maybeSingle();

  if (error) handleError(error, "cancelPurchaseOrderEntry");
  if (!row) throw new Error("Không thể huỷ — đơn đã hoàn thành hoặc đã huỷ trước đó");
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let headerQuery: any = supabase
    .from("purchase_orders")
    .select(
      "id, code, note, status, supplier:suppliers(code), branch:branches(code)"
    )
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
    .select("*, profiles!input_invoices_created_by_fkey(full_name)", { count: "exact" });

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

// ==================== Complete Supplier Return (Trả hàng nhập hoàn chỉnh) ====================

interface SupplierReturnItem {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
}

interface CompleteSupplierReturnInput {
  purchaseOrderId: string;
  purchaseOrderCode: string;
  supplierId: string;
  supplierName: string;
  items: SupplierReturnItem[];
  reason?: string;
  note?: string;
}

/**
 * Hoàn thành phiếu trả hàng nhập:
 * 1. Insert `supplier_returns` + `supplier_return_items`
 * 2. Stock OUT (trả hàng cho NCC → trừ kho)
 * 3. Cash receipt (phiếu thu — NCC hoàn tiền cho mình)
 */
export async function completeSupplierReturn(input: CompleteSupplierReturnInput): Promise<{ returnId: string; returnCode: string }> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const returnCode = await nextEntityCode("purchase_return", { tenantId: ctx.tenantId });
  const returnTotal = input.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  // 1. Insert supplier_returns record
  const { data: returnRow, error: returnErr } = await sb
    .from("supplier_returns")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
      code: returnCode,
      purchase_order_id: input.purchaseOrderId,
      import_code: input.purchaseOrderCode,
      supplier_id: input.supplierId,
      supplier_name: input.supplierName,
      status: "completed",
      total: returnTotal,
      note: [input.reason, input.note].filter(Boolean).join(" — ") || null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();

  if (returnErr) handleError(returnErr, "completeSupplierReturn:insert_return");
  const returnId: string = returnRow.id;

  // 2. Insert supplier_return_items
  const { error: itemsErr } = await sb
    .from("supplier_return_items")
    .insert(
      input.items.map((item) => ({
        return_id: returnId,
        product_id: item.productId,
        product_name: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total: item.quantity * item.unitPrice,
      }))
    );
  if (itemsErr) handleError(itemsErr, "completeSupplierReturn:insert_items");

  // 3. Stock OUT — trả hàng cho NCC → trừ kho
  await applyManualStockMovement(
    input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      type: "out" as const,
      referenceType: "supplier_return",
      referenceId: returnId,
      note: `${returnCode} - Trả hàng nhập ${input.purchaseOrderCode} - ${item.productName} (-${item.quantity})`,
    })),
    { tenantId: ctx.tenantId, branchId: ctx.branchId, createdBy: ctx.userId }
  );

  // 4. Cash receipt (phiếu thu — NCC hoàn tiền cho mình)
  if (returnTotal > 0) {
    const cashCode = await nextEntityCode("cash_receipt", { tenantId: ctx.tenantId });

    const cashData: CashTransactionInsert = {
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
      code: cashCode,
      type: "receipt",
      category: "Trả hàng nhập",
      amount: returnTotal,
      counterparty: input.supplierName,
      payment_method: "cash",
      reference_type: "supplier_return",
      reference_id: returnId,
      note: `Hoàn tiền trả hàng nhập ${returnCode} (ĐN gốc: ${input.purchaseOrderCode})`,
      created_by: ctx.userId,
    };

    const { error: cashErr } = await supabase.from("cash_transactions").insert(cashData);
    if (cashErr) handleError(cashErr, "completeSupplierReturn:cash_receipt");
  }

  return { returnId, returnCode };
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
  const profile = row.profiles as { full_name: string } | null;
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
    createdByName: profile?.full_name ?? undefined,
  };
}
