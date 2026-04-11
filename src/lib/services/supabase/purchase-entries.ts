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
