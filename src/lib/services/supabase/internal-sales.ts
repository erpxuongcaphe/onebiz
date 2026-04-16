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

import { getClient, getCurrentContext, handleError } from "./base";
import { applyManualStockMovement } from "./stock-adjustments";

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

// ────────────────────────────────────────────
// Create + Complete (atomic flow)
// ────────────────────────────────────────────

export async function createInternalSale(
  input: CreateInternalSaleInput,
): Promise<InternalSaleResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  // ── Validate ────────────────────────────
  if (input.fromBranchId === input.toBranchId) {
    throw new Error("Chi nhánh bán và chi nhánh mua không được giống nhau");
  }
  if (input.items.length === 0) {
    throw new Error("Cần ít nhất 1 sản phẩm");
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

  // ── 2. Generate codes ──
  const [invoiceCodeRes, inputInvCodeRes, saleCodeRes] = await Promise.all([
    supabase.rpc("next_code", {
      p_tenant_id: ctx.tenantId,
      p_entity_type: "invoice",
    }),
    supabase.rpc("next_code", {
      p_tenant_id: ctx.tenantId,
      p_entity_type: "input_invoice",
    }),
    supabase.rpc("next_code", {
      p_tenant_id: ctx.tenantId,
      p_entity_type: "internal_sale",
    }),
  ]);

  const invoiceCode = (invoiceCodeRes.data as string | null) ?? `HD${Date.now()}`;
  const inputInvCode = (inputInvCodeRes.data as string | null) ?? `HDV${Date.now()}`;
  const saleCode = (saleCodeRes.data as string | null) ?? `BNB${Date.now()}`;

  if (invoiceCodeRes.error) handleError(invoiceCodeRes.error, "createInternalSale:invoiceCode");
  if (inputInvCodeRes.error) handleError(inputInvCodeRes.error, "createInternalSale:inputInvCode");
  if (saleCodeRes.error) handleError(saleCodeRes.error, "createInternalSale:saleCode");

  // ── 3. Invoice trên branch BÁN (doanh thu cho seller) ──
  const payMethod = input.paymentMethod === "debt" ? "cash" : (input.paymentMethod ?? "transfer");
  const paid = input.paymentMethod === "debt" ? 0 : total;
  const debt = total - paid;

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: input.fromBranchId,
      code: invoiceCode,
      customer_id: intCustomer.id,
      customer_name: intCustomer.name,
      status: "completed",
      subtotal,
      discount_amount: 0,
      tax_amount: taxAmount,
      total,
      paid,
      debt,
      payment_method: payMethod as "cash" | "transfer" | "card" | "mixed",
      source: "internal",
      note: `Bán nội bộ ${saleCode} → ${intCustomer.name}`,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (invErr || !invoice) {
    handleError(invErr!, "createInternalSale:invoice");
    throw new Error("Không tạo được hoá đơn bán");
  }

  // ── 3b. Invoice items (invoice_items has no product_code column) ──
  const invoiceItems = lines.map((l) => ({
    invoice_id: invoice.id,
    product_id: l.productId,
    product_name: l.productName,
    unit: l.unit,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    discount: 0,
    vat_rate: l.vatRate,
    vat_amount: l.taxAmount,
    total: l.amount + l.taxAmount,
  }));
  const { error: iiErr } = await supabase
    .from("invoice_items")
    .insert(invoiceItems);
  if (iiErr) handleError(iiErr, "createInternalSale:invoiceItems");

  // ── 4. Input invoice trên branch MUA (chi phí cho buyer) ──
  const { data: inputInv, error: inputInvErr } = await (supabase as any)
    .from("input_invoices")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: input.toBranchId,
      code: inputInvCode,
      supplier_id: intSupplier.id,
      supplier_name: intSupplier.name,
      total_amount: total,
      tax_amount: taxAmount,
      status: "recorded",
      note: `Mua nội bộ ${saleCode} ← ${intSupplier.name}`,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (inputInvErr) {
    handleError(inputInvErr, "createInternalSale:inputInvoice");
    throw new Error("Không tạo được hoá đơn đầu vào");
  }

  // ── 5. Stock OUT branch bán ──
  await applyManualStockMovement(
    lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      type: "out" as const,
      referenceType: "internal_sale",
      referenceId: invoice.id,
      note: `Xuất nội bộ ${saleCode} - ${l.productName}`,
    })),
    {
      tenantId: ctx.tenantId,
      branchId: input.fromBranchId,
      createdBy: ctx.userId,
    },
  );

  // ── 6. Stock IN branch mua ──
  await applyManualStockMovement(
    lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      type: "in" as const,
      referenceType: "internal_sale",
      referenceId: inputInv.id,
      note: `Nhập nội bộ ${saleCode} - ${l.productName}`,
    })),
    {
      tenantId: ctx.tenantId,
      branchId: input.toBranchId,
      createdBy: ctx.userId,
    },
  );

  // ── 7. Cash transactions (nếu không ghi nợ) ──
  if (paid > 0) {
    const paymentNote = `Giao dịch nội bộ ${saleCode}`;

    // Thu tiền bên BÁN
    const { data: cashCode } = await supabase.rpc("next_code", {
      p_tenant_id: ctx.tenantId,
      p_entity_type: "cash_receipt",
    });

    const { error: cashReceiptErr } = await supabase.from("cash_transactions").insert({
      tenant_id: ctx.tenantId,
      branch_id: input.fromBranchId,
      code: (cashCode as string | null) ?? `PT${Date.now()}`,
      type: "receipt",
      category: "Bán hàng nội bộ",
      amount: paid,
      payment_method: payMethod,
      reference_type: "invoice",
      reference_id: invoice.id,
      note: paymentNote,
      created_by: ctx.userId,
    });
    if (cashReceiptErr) handleError(cashReceiptErr, "createInternalSale:cashReceipt");

    // Chi tiền bên MUA
    const { data: cashPayCode } = await supabase.rpc("next_code", {
      p_tenant_id: ctx.tenantId,
      p_entity_type: "cash_payment",
    });

    const { error: cashPayErr } = await supabase.from("cash_transactions").insert({
      tenant_id: ctx.tenantId,
      branch_id: input.toBranchId,
      code: (cashPayCode as string | null) ?? `PC${Date.now()}`,
      type: "payment",
      category: "Mua hàng nội bộ",
      amount: paid,
      payment_method: payMethod,
      reference_type: "input_invoice",
      reference_id: inputInv.id,
      note: paymentNote,
      created_by: ctx.userId,
    });
    if (cashPayErr) handleError(cashPayErr, "createInternalSale:cashPayment");
  }

  // ── 8. Internal sale header ──
  const { data: sale, error: saleErr } = await supabase
    .from("internal_sales")
    .insert({
      tenant_id: ctx.tenantId,
      code: saleCode,
      from_branch_id: input.fromBranchId,
      to_branch_id: input.toBranchId,
      invoice_id: invoice.id,
      input_invoice_id: inputInv.id,
      status: "completed",
      subtotal,
      tax_amount: taxAmount,
      total,
      note: input.note ?? null,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (saleErr || !sale) {
    handleError(saleErr!, "createInternalSale:header");
    throw new Error("Không tạo được đơn nội bộ");
  }

  // ── 8b. Internal sale items ──
  const saleItems = lines.map((l) => ({
    internal_sale_id: sale.id,
    product_id: l.productId,
    product_code: l.productCode,
    product_name: l.productName,
    unit: l.unit,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    vat_rate: l.vatRate,
    amount: l.amount,
  }));
  const { error: siErr } = await supabase
    .from("internal_sale_items")
    .insert(saleItems);
  if (siErr) handleError(siErr, "createInternalSale:saleItems");

  return {
    internalSaleId: sale.id,
    code: saleCode,
    invoiceId: invoice.id,
    invoiceCode: invoice.code,
    inputInvoiceId: inputInv.id,
    inputInvoiceCode: inputInv.code,
    total,
  };
}

// ────────────────────────────────────────────
// Cancel
// ────────────────────────────────────────────

export async function cancelInternalSale(id: string, reason?: string): Promise<void> {
  const supabase = getClient();

  const { data: sale, error } = await supabase
    .from("internal_sales")
    .update({ status: "cancelled", note: reason ?? "Huỷ đơn nội bộ" })
    .eq("id", id)
    .in("status", ["draft", "confirmed"])
    .select("id")
    .maybeSingle();

  if (error) handleError(error, "cancelInternalSale");
  if (!sale) throw new Error("Không thể huỷ — đơn đã hoàn thành hoặc đã huỷ");
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
