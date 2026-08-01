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

// ────────────────────────────────────────────
// Queries
// ────────────────────────────────────────────

export async function getInternalSales(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  branchId?: string;
  search?: string;
}) {
  const supabase = getClient();
  // P0-11 fix 12/06/2026: filter tenant_id để chống cross-tenant leak khi RLS
  // bị bypass (multi-tenant SaaS). Trước đây query lấy bất kỳ internal_sales nào
  // RLS cho phép — sai về nguyên tắc defense-in-depth.
  const ctx = await getCurrentContext();
  const page = params.page ?? 1;
  const size = params.pageSize ?? 20;
  const from = (page - 1) * size;
  const to = from + size - 1;

  let query = supabase
    .from("internal_sales")
    .select(
      "*, from_branch:branches!internal_sales_from_branch_id_fkey(name), to_branch:branches!internal_sales_to_branch_id_fkey(name), creator:profiles!internal_sales_created_by_fkey(full_name)",
      { count: "exact" },
    )
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.status) query = query.eq("status", params.status as any);
  if (params.branchId) {
    query = query.or(
      `from_branch_id.eq.${params.branchId},to_branch_id.eq.${params.branchId}`,
    );
  }
  if (params.search) query = query.ilike("code", `%${params.search}%`);

  const { data, count, error } = await query;
  if (error) handleError(error, "getInternalSales");

  return {
    data: (data ?? []).map(mapInternalSale),
    total: count ?? 0,
  };
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
export async function getInternalSalesForExport(params: {
  search?: string;
  status?: string;
  branchId?: string;
}): Promise<InternalSaleImportRow[]> {
  const supabase = getClient();
  // P0-11 fix 12/06/2026: filter tenant_id (defense-in-depth ngoài RLS).
  const ctx = await getCurrentContext();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let headerQuery: any = supabase
    .from("internal_sales")
    .select(
      "id, code, note, status, from_branch:branches!internal_sales_from_branch_id_fkey(code), to_branch:branches!internal_sales_to_branch_id_fkey(code)"
    )
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });

  if (params.search) headerQuery = headerQuery.ilike("code", `%${params.search}%`);
  if (params.status) headerQuery = headerQuery.eq("status", params.status);
  if (params.branchId) {
    headerQuery = headerQuery.or(
      `from_branch_id.eq.${params.branchId},to_branch_id.eq.${params.branchId}`
    );
  }

  const { data: headers, error: hErr } = await headerQuery;
  if (hErr) handleError(hErr, "getInternalSalesForExport.headers");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerList = (headers ?? []) as any[];
  if (headerList.length === 0) return [];

  const saleIds = headerList.map((h) => h.id as string);

  const { data: items, error: iErr } = await supabase
    .from("internal_sale_items")
    .select("internal_sale_id, product_code, quantity, unit_price, vat_rate")
    .in("internal_sale_id", saleIds);
  if (iErr) handleError(iErr, "getInternalSalesForExport.items");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headerMap = new Map<string, any>();
  for (const h of headerList) headerMap.set(h.id, h);

  const rows: InternalSaleImportRow[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const it of (items ?? []) as any[]) {
    const h = headerMap.get(it.internal_sale_id);
    if (!h) continue;
    rows.push({
      code: h.code as string,
      fromBranchCode: (h.from_branch?.code ?? "") as string,
      toBranchCode: (h.to_branch?.code ?? "") as string,
      note: (h.note ?? "") as string,
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

function mapInternalSale(row: Record<string, unknown>) {
  const fromBranch = row.from_branch as { name: string } | null;
  const toBranch = row.to_branch as { name: string } | null;
  const creator = row.creator as { full_name: string } | null;

  return {
    id: row.id as string,
    code: row.code as string,
    fromBranchId: row.from_branch_id as string,
    fromBranchName: fromBranch?.name ?? "",
    toBranchId: row.to_branch_id as string,
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
