/**
 * Internal Sales Service — Giao dịch nội bộ giữa các chi nhánh.
 *
 * Flow: Branch A bán cho Branch B
 *   1. Invoice trên branch A (source='internal', customer = internal customer of B)
 *   2. Input invoice trên branch B (supplier = internal supplier of A)
 *   3. Stock OUT branch A
 *   4. Stock IN branch B
 *   5. Cash transactions 2 bên (hoặc ghi nợ)
 *   6. Internal sale header linking all
 */

import type { InternalSaleImportRow } from "@/lib/excel/schemas";
import { getClient, getCurrentContext, handleError } from "./base";
import { applyCreatedAtRangeFilter, normalizeCreatedAtRange } from "@/lib/utils/list-date-preset-range";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export interface InternalSaleItemInput {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export interface CreateInternalSaleInput {
  fromBranchId: string;
  toBranchId: string;
  items: InternalSaleItemInput[];
  note?: string;
  paymentMethod?: "cash" | "transfer" | "debt";
}

export interface InternalSaleResult {
  internalSaleId: string;
  code: string;
  invoiceId: string;
  invoiceCode: string;
  inputInvoiceId: string;
  inputInvoiceCode: string;
  total: number;
}

export interface InternalSalesListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  branchId?: string;
  search?: string;
  searchField?: string;
  filters?: Record<string, string | string[]>;
}

export interface InternalSaleListRow {
  id: string;
  code: string;
  fromBranchId: string;
  fromBranchCode: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchCode: string;
  toBranchName: string;
  invoiceId?: string;
  inputInvoiceId?: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  subtotal: number;
  taxAmount: number;
  total: number;
  note?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

const VALID_INTERNAL_SALE_STATUSES = new Set([
  "draft",
  "confirmed",
  "completed",
  "cancelled",
]);

// ────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────

export async function getInternalSales(
  params: InternalSalesListParams,
): Promise<{ data: InternalSaleListRow[]; total: number }> {
  const supabase = getClient();
  // P0-11 fix 12/06/2026: filter tenant_id để chống cross-tenant leak khi RLS
  // bị bypass (multi-tenant SaaS). Trước đây query lấy bất kỳ internal_sales nào
  // RLS cho phép — sai về nguyên tắc defense-in-depth.
  const ctx = await getCurrentContext();
  const page = params.page ?? 1;
  const size = params.pageSize ?? 20;
  const from = (page - 1) * size;
  const to = from + size - 1;

  const search = params.search?.trim();
  const fromBranchRelation =
    search &&
    (params.searchField === "from_branch_code" ||
      params.searchField === "from_branch_name")
      ? "from_branch:branches!internal_sales_from_branch_id_fkey!inner(code, name, tenant_id)"
      : "from_branch:branches!internal_sales_from_branch_id_fkey(code, name)";
  const toBranchRelation =
    search &&
    (params.searchField === "to_branch_code" ||
      params.searchField === "to_branch_name")
      ? "to_branch:branches!internal_sales_to_branch_id_fkey!inner(code, name, tenant_id)"
      : "to_branch:branches!internal_sales_to_branch_id_fkey(code, name)";
  const creatorRelation =
    search && params.searchField === "creator_name"
      ? "creator:profiles!internal_sales_created_by_fkey!inner(full_name, tenant_id)"
      : "creator:profiles!internal_sales_created_by_fkey(full_name)";
  const itemRelation =
    search &&
    (params.searchField === "product_code" ||
      params.searchField === "product_name")
      ? ", item_match:internal_sale_items!inner(product_code, product_name)"
      : "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("internal_sales")
    .select(
      `*, ${fromBranchRelation}, ${toBranchRelation}, ${creatorRelation}${itemRelation}`,
      { count: "exact" },
    )
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  const rawStatuses = params.filters?.status ?? params.status;
  if (rawStatuses && rawStatuses !== "all") {
    const statuses = (Array.isArray(rawStatuses) ? rawStatuses : [rawStatuses]).filter(
      (status) => VALID_INTERNAL_SALE_STATUSES.has(status),
    );
    if (statuses.length > 0) query = query.in("status", statuses);
  }

  query = applyCreatedAtRangeFilter(query, params.filters);

  if (params.branchId) {
    query = query.or(
      `from_branch_id.eq.${params.branchId},to_branch_id.eq.${params.branchId}`,
    );
  }

  const fromBranchId = params.filters?.fromBranchId;
  const toBranchId = params.filters?.toBranchId;
  const createdBy = params.filters?.createdBy;
  if (typeof fromBranchId === "string" && fromBranchId) {
    query = query.eq("from_branch_id", fromBranchId);
  }
  if (typeof toBranchId === "string" && toBranchId) {
    query = query.eq("to_branch_id", toBranchId);
  }
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

  if (search) {
    const escaped = search.replace(/[%_]/g, "\\$&");
    switch (params.searchField) {
      case "from_branch_code":
        query = query
          .eq("from_branch.tenant_id", ctx.tenantId)
          .ilike("from_branch.code", `%${escaped}%`);
        break;
      case "from_branch_name":
        query = query
          .eq("from_branch.tenant_id", ctx.tenantId)
          .ilike("from_branch.name", `%${escaped}%`);
        break;
      case "to_branch_code":
        query = query
          .eq("to_branch.tenant_id", ctx.tenantId)
          .ilike("to_branch.code", `%${escaped}%`);
        break;
      case "to_branch_name":
        query = query
          .eq("to_branch.tenant_id", ctx.tenantId)
          .ilike("to_branch.name", `%${escaped}%`);
        break;
      case "creator_name":
        query = query
          .eq("creator.tenant_id", ctx.tenantId)
          .ilike("creator.full_name", `%${escaped}%`);
        break;
      case "product_code":
        query = query.ilike("item_match.product_code", `%${escaped}%`);
        break;
      case "product_name":
        query = query.ilike("item_match.product_name", `%${escaped}%`);
        break;
      case "note":
        query = query.ilike("note", `%${escaped}%`);
        break;
      case "code":
      default:
        query = query.ilike("code", `%${escaped}%`);
        break;
    }
  }

  const { data, count, error } = await query;
  if (error) handleError(error, "getInternalSales");

  return {
    data: (data ?? []).map(mapInternalSale),
    total: count ?? 0,
  };
}

export interface InternalSaleListWorkspaceParams {page:number;pageSize:number;search?:string;searchField?:string;statuses?:string[];dateFrom?:string;dateTo?:string;fromBranchId?:string;toBranchId?:string;createdBy?:string;amountMin?:number;amountMax?:number;branchId?:string}
export interface InternalSaleListWorkspaceResult {data:InternalSaleListRow[];total:number;summary:{completedCount:number;cancelledCount:number;totalValue:number;completedValue:number;taxValue:number}}
export async function getInternalSaleListWorkspace(params:InternalSaleListWorkspaceParams):Promise<InternalSaleListWorkspaceResult>{
 const supabase=getClient();const{from,toExclusive}=normalizeCreatedAtRange({dateFrom:params.dateFrom,dateTo:params.dateTo});
 const{data,error}=await(supabase.rpc as any)("get_internal_sale_list_workspace",{p_page:params.page,p_page_size:params.pageSize,p_search:params.search?.trim()||null,p_search_field:params.searchField??"all",p_statuses:params.statuses?.length?params.statuses:null,p_date_from:from??null,p_date_to_exclusive:toExclusive??null,p_from_branch_id:params.fromBranchId||null,p_to_branch_id:params.toBranchId||null,p_created_by:params.createdBy||null,p_amount_min:Number.isFinite(params.amountMin)?params.amountMin:null,p_amount_max:Number.isFinite(params.amountMax)?params.amountMax:null,p_branch_id:params.branchId??null});
 if(error)handleError(error,"getInternalSaleListWorkspace");const payload=(data??{})as Record<string,any>;const summary=(payload.summary??{})as Record<string,unknown>;
 return{data:Array.isArray(payload.items)?payload.items.map(mapInternalSale):[],total:Number(payload.total??0),summary:{completedCount:Number(summary.completedCount??0),cancelledCount:Number(summary.cancelledCount??0),totalValue:Number(summary.totalValue??0),completedValue:Number(summary.completedValue??0),taxValue:Number(summary.taxValue??0)}};
}

export async function getInternalSaleById(id: string) {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("internal_sales")
    .select(
      "*, from_branch:branches!internal_sales_from_branch_id_fkey(name), to_branch:branches!internal_sales_to_branch_id_fkey(name), creator:profiles!internal_sales_created_by_fkey(full_name)",
    )
    .eq("id", id)
    .single();
  if (error) handleError(error, "getInternalSaleById");

  const { data: items, error: itemsErr } = await supabase
    .from("internal_sale_items")
    .select("*")
    .eq("internal_sale_id", id)
    .order("product_name");
  if (itemsErr) handleError(itemsErr, "getInternalSaleById.items");

  return {
    ...mapInternalSale(data),
    items: (items ?? []).map((it: Record<string, unknown>) => ({
      id: it.id as string,
      productId: it.product_id as string,
      productCode: it.product_code as string,
      productName: it.product_name as string,
      unit: it.unit as string,
      quantity: Number(it.quantity ?? 0),
      unitPrice: Number(it.unit_price ?? 0),
      vatRate: Number(it.vat_rate ?? 0),
      amount: Number(it.amount ?? 0),
      note: (it.note as string) ?? undefined,
    })),
  };
}

/**
 * Export đơn bán nội bộ — trả về rows phẳng theo schema Excel Import.
 *
 * Mỗi line item = 1 row. Các row cùng "code" sẽ gộp thành 1 đơn khi import lại.
 * Đảm bảo round-trip export/import (Plan 19/04 yêu cầu #2).
 *
 * Note: paymentMethod không được lưu trên internal_sales header (lưu ở invoice
 * liên kết). Để đơn giản, export bỏ trống — user có thể chỉnh trong Excel
 * trước khi import. Default "debt" khi import lại.
 */
export async function getInternalSalesForExport(
  params: Omit<InternalSalesListParams, "page" | "pageSize">,
): Promise<InternalSaleImportRow[]> {
  const supabase = getClient();
  const headerList: InternalSaleListRow[] = [];
  const batchSize = 200;
  for (let page = 0; ; page += 1) {
    const result = await getInternalSaleListWorkspace({
      page,
      pageSize: batchSize,
      search: params.search,
      searchField: params.searchField,
      statuses: Array.isArray(params.filters?.status)
        ? params.filters.status
        : params.filters?.status && params.filters.status !== "all"
          ? [String(params.filters.status)]
          : undefined,
      dateFrom: String(params.filters?.dateFrom ?? "") || undefined,
      dateTo: String(params.filters?.dateTo ?? "") || undefined,
      fromBranchId: String(params.filters?.fromBranchId ?? "") || undefined,
      toBranchId: String(params.filters?.toBranchId ?? "") || undefined,
      createdBy: String(params.filters?.createdBy ?? "") || undefined,
      amountMin: Number(params.filters?.amountMin),
      amountMax: Number(params.filters?.amountMax),
      branchId: params.branchId,
    });
    headerList.push(...result.data);
    if (headerList.length >= result.total || result.data.length < batchSize) break;
  }
  if (headerList.length === 0) return [];

  const saleIds = headerList.map((header) => header.id);
  const items: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < saleIds.length; offset += 200) {
    const { data, error } = await supabase
      .from("internal_sale_items")
      .select("internal_sale_id, product_code, quantity, unit_price, vat_rate")
      .in("internal_sale_id", saleIds.slice(offset, offset + 200));
    if (error) handleError(error, "getInternalSalesForExport.items");
    items.push(...((data ?? []) as Array<Record<string, unknown>>));
  }

  const headerMap = new Map<string, InternalSaleListRow>();
  for (const h of headerList) headerMap.set(h.id, h);

  const rows: InternalSaleImportRow[] = [];
  for (const it of items) {
    const h = headerMap.get(it.internal_sale_id as string);
    if (!h) continue;
    rows.push({
      code: h.code,
      fromBranchCode: h.fromBranchCode,
      toBranchCode: h.toBranchCode,
      note: h.note ?? "",
      productCode: (it.product_code ?? "") as string,
      quantity: Number(it.quantity ?? 0),
      unitPrice: Number(it.unit_price ?? 0),
      vatRate: Number(it.vat_rate ?? 0),
    });
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));
  return rows;
}

// ────────────────────────────────────────────
// Create + Complete (atomic flow)
// ────────────────────────────────────────────

export async function createInternalSale(
  input: CreateInternalSaleInput,
): Promise<InternalSaleResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  // ── Validate ────────────────────────────
  // P0-10 13/06/2026: validate channel + resolve customer/supplier vẫn ở
  // service vì cần error UX-friendly. Sau khi pre-flight OK → ưu tiên RPC
  // atomic. Fallback luồng cũ nếu RPC chưa apply migration 00141.
  if (input.fromBranchId === input.toBranchId) {
    throw new Error("Chi nhánh bán và chi nhánh mua không được giống nhau");
  }
  if (input.items.length === 0) {
    throw new Error("Cần ít nhất 1 sản phẩm");
  }

  // Day 20/05/2026 (CEO audit Fix #4): Validate channel consistency.
  // VD: SKU channel='retail' chuyển sang Quán FnB (branchType='store') →
  // sản phẩm sẽ treo ở quán (Quán không bán SP retail). Cảnh báo trước.
  // CEO 07/07/2026 — CHỐT MÔ HÌNH (Cách B, khớp thiết kế 00123): Quán FnB nhận
  // SKU Retail làm HÀNG THÀNH PHẦN (sữa lon, cà phê rang xay, syrup, ly...) qua
  // bán nội bộ — đây là LUỒNG CHÍNH THỨC. Rule cũ chặn "SKU retail → store" là
  // tàn dư thiết kế trước Sprint 3 → GỠ.
  // Chặn ĐÚNG duy nhất: MÓN MENU F&B (mọi mã sku + channel='fnb', KHÔNG suy từ
  // has_bom — khớp inventory_role='fnb_menu_item'). Món chưa gắn công thức vẫn là
  // menu, KHÔNG giữ tồn → không có gì để chuyển đi.
  const itemProductIds = input.items.map((it) => it.productId);
  if (itemProductIds.length > 0) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, code, name, channel, product_type, has_bom")
      .eq("tenant_id", ctx.tenantId)
      .in("id", itemProductIds);

    const menuItems: string[] = [];
    for (const p of prods ?? []) {
      const pr = p as {
        code: string;
        name: string;
        channel?: string | null;
        product_type?: string;
        has_bom?: boolean | null;
      };
      if (pr.product_type === "sku" && pr.channel === "fnb") {
        menuItems.push(`${pr.code} — ${pr.name}`);
      }
    }
    if (menuItems.length > 0) {
      throw new Error(
        `Không thể đưa MÓN MENU F&B vào phiếu bán nội bộ:\n` +
          menuItems.map((s) => `  • ${s}`).join("\n") +
          `\n\nMón menu bán theo công thức, không giữ tồn kho — không có hàng để chuyển. ` +
          `Hãy chuyển các HÀNG THÀNH PHẦN (NVL hoặc SKU Retail) mà công thức món sử dụng.`,
      );
    }
  }

  // ── Calculate totals ────────────────────
  const lines = input.items.map((it) => {
    const lineAmount = Math.round(it.quantity * it.unitPrice);
    const taxAmount = Math.round(lineAmount * it.vatRate / 100);
    return { ...it, amount: lineAmount, taxAmount };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const taxAmount = lines.reduce((s, l) => s + l.taxAmount, 0);
  const total = subtotal + taxAmount;

  // ── 1. Resolve internal customer + supplier ──
  // Customer nội bộ: branch MUA đã được seed → customer record (is_internal, branch_id=toBranch)
  const { data: intCustomer, error: custErr } = await supabase
    .from("customers")
    .select("id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_internal", true)
    .eq("branch_id", input.toBranchId)
    .single();
  if (custErr || !intCustomer) {
    throw new Error(
      "Chưa có khách hàng nội bộ cho chi nhánh mua. Hãy chạy đồng bộ trước.",
    );
  }

  // Supplier nội bộ: branch BÁN → supplier record (is_internal, branch_id=fromBranch)
  const { data: intSupplier, error: suppErr } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_internal", true)
    .eq("branch_id", input.fromBranchId)
    .single();
  if (suppErr || !intSupplier) {
    throw new Error(
      "Chưa có nhà cung cấp nội bộ cho chi nhánh bán. Hãy chạy đồng bộ trước.",
    );
  }

  // Toàn bộ chứng từ, tồn kho và sổ quỹ phải hoàn tất trong một giao dịch DB.
  // Không được rơi về luồng nhiều bước ở client khi RPC lỗi.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: atomicData, error: atomicError } = await (supabase.rpc as any)(
    "create_internal_sale_atomic",
    {
      p_tenant_id: ctx.tenantId,
      p_from_branch_id: input.fromBranchId,
      p_to_branch_id: input.toBranchId,
      p_created_by: ctx.userId,
      p_int_customer_id: intCustomer.id,
      p_int_customer_name: intCustomer.name,
      p_int_supplier_id: intSupplier.id,
      p_int_supplier_name: intSupplier.name,
      p_items: input.items,
      p_payment_method: input.paymentMethod ?? "transfer",
      p_paid_full: (input.paymentMethod ?? "transfer") !== "debt",
      p_note: input.note ?? null,
    },
  );
  if (atomicError) handleError(atomicError, "createInternalSale:atomic_rpc");
  if (!atomicData) {
    throw new Error("Không nhận được kết quả tạo phiếu bán nội bộ");
  }

  const result = atomicData as {
    internal_sale_id?: string;
    code?: string;
    invoice_id?: string;
    invoice_code?: string;
    input_invoice_id?: string;
    input_invoice_code?: string;
    total?: number;
  };
  if (!result.internal_sale_id || !result.code || !result.invoice_id) {
    throw new Error("Kết quả tạo phiếu bán nội bộ không đầy đủ");
  }

  return {
    internalSaleId: result.internal_sale_id,
    code: result.code,
    invoiceId: result.invoice_id,
    invoiceCode: result.invoice_code ?? "",
    inputInvoiceId: result.input_invoice_id ?? "",
    inputInvoiceCode: result.input_invoice_code ?? "",
    total: Number(result.total ?? total),
  };
}

// ────────────────────────────────────────────
// Cancel
// ────────────────────────────────────────────

export async function cancelInternalSale(id: string, reason?: string): Promise<void> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("cancel_internal_sale_atomic", {
    p_internal_sale_id: id,
    p_reason: reason ?? "Hủy đơn bán nội bộ",
  });
  if (error) handleError(error, "cancelInternalSale.atomic_rpc");
}

// ────────────────────────────────────────────
// Mapper
// ────────────────────────────────────────────

function mapInternalSale(row: Record<string, unknown>): InternalSaleListRow {
  const fromBranch = row.from_branch as { code?: string; name: string } | null;
  const toBranch = row.to_branch as { code?: string; name: string } | null;
  const creator = row.creator as { full_name: string } | null;

  return {
    id: row.id as string,
    code: row.code as string,
    fromBranchId: row.from_branch_id as string,
    fromBranchCode: fromBranch?.code ?? "",
    fromBranchName: fromBranch?.name ?? "",
    toBranchId: row.to_branch_id as string,
    toBranchCode: toBranch?.code ?? "",
    toBranchName: toBranch?.name ?? "",
    invoiceId: (row.invoice_id as string) ?? undefined,
    inputInvoiceId: (row.input_invoice_id as string) ?? undefined,
    status: row.status as "draft" | "confirmed" | "completed" | "cancelled",
    subtotal: Number(row.subtotal ?? 0),
    taxAmount: Number(row.tax_amount ?? 0),
    total: Number(row.total ?? 0),
    note: (row.note as string) ?? undefined,
    createdBy: row.created_by as string,
    createdByName: creator?.full_name ?? "",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
