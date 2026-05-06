/**
 * Duplicate services — Stage 8 (CEO 06/05/2026).
 *
 * Pattern "Sao chép" cho 5 entity warehouse + production. Clone fields chính,
 * KHÔNG clone items chi tiết (caller sẽ add lại nếu cần). Reset status→'draft'
 * + generate code mới qua nextEntityCode.
 *
 * 8 kind còn lại defer (sales_return / shipping / goods_receipt /
 * purchase_return / input_invoice / internal_export / cash_transaction):
 * UI list page chưa có nhu cầu rõ "sao chép" — sẽ wire khi có ticket cụ thể.
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { nextEntityCode } from "./stock-adjustments";
import { recordAuditLog } from "./audit";

interface DuplicateResult {
  id: string;
  code: string;
}

// ============================================================
// 1. Inventory Check (Kiểm kho)
// ============================================================

/**
 * Sao chép phiếu kiểm kho. Mỗi tháng kho thường tạo phiếu mới với cùng
 * danh sách SP — sao chép giúp setup nhanh.
 */
export async function duplicateInventoryCheck(
  sourceId: string,
): Promise<DuplicateResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Fetch source
  const { data: src, error: fErr } = await sb
    .from("inventory_checks")
    .select("branch_id, note")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sourceId)
    .single();
  if (fErr) handleError(fErr, "duplicateInventoryCheck.fetch");
  if (!src) throw new Error("Không tìm thấy phiếu kiểm kho gốc");

  const code = await nextEntityCode("inventory_check");
  const { data: created, error: iErr } = await sb
    .from("inventory_checks")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: src.branch_id ?? ctx.branchId,
      code,
      status: "draft",
      note: src.note ? `[Sao chép] ${src.note}` : `Sao chép từ phiếu ${sourceId.slice(0, 8)}`,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (iErr) handleError(iErr, "duplicateInventoryCheck.insert");

  await recordAuditLog({
    entityType: "inventory_check",
    entityId: created.id,
    action: "create",
    newData: { sourceId, code: created.code, kind: "duplicate" },
  });

  return { id: created.id, code: created.code };
}

// ============================================================
// 2. Stock Transfer (Chuyển kho)
// ============================================================

export async function duplicateStockTransfer(
  sourceId: string,
): Promise<DuplicateResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: src, error: fErr } = await sb
    .from("stock_transfers")
    .select("from_branch_id, to_branch_id, note")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sourceId)
    .single();
  if (fErr) handleError(fErr, "duplicateStockTransfer.fetch");
  if (!src) throw new Error("Không tìm thấy phiếu chuyển kho gốc");

  const code = await nextEntityCode("stock_transfer");
  const { data: created, error: iErr } = await sb
    .from("stock_transfers")
    .insert({
      tenant_id: ctx.tenantId,
      from_branch_id: src.from_branch_id,
      to_branch_id: src.to_branch_id,
      code,
      status: "draft",
      note: src.note ? `[Sao chép] ${src.note}` : `Sao chép từ phiếu ${sourceId.slice(0, 8)}`,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (iErr) handleError(iErr, "duplicateStockTransfer.insert");

  await recordAuditLog({
    entityType: "stock_transfer",
    entityId: created.id,
    action: "create",
    newData: { sourceId, code: created.code, kind: "duplicate" },
  });

  return { id: created.id, code: created.code };
}

// ============================================================
// 3. Disposal Export (Xuất hủy)
// ============================================================

export async function duplicateDisposalExport(
  sourceId: string,
): Promise<DuplicateResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: src, error: fErr } = await sb
    .from("disposal_exports")
    .select("branch_id, reason, note")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sourceId)
    .single();
  if (fErr) handleError(fErr, "duplicateDisposalExport.fetch");
  if (!src) throw new Error("Không tìm thấy phiếu xuất hủy gốc");

  const code = await nextEntityCode("disposal_export");
  const { data: created, error: iErr } = await sb
    .from("disposal_exports")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: src.branch_id ?? ctx.branchId,
      code,
      status: "draft",
      reason: src.reason ?? null,
      note: src.note ? `[Sao chép] ${src.note}` : null,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (iErr) handleError(iErr, "duplicateDisposalExport.insert");

  await recordAuditLog({
    entityType: "disposal_export",
    entityId: created.id,
    action: "create",
    newData: { sourceId, code: created.code, kind: "duplicate" },
  });

  return { id: created.id, code: created.code };
}

// ============================================================
// 4. Internal Sale (Bán nội bộ giữa chi nhánh)
// ============================================================

export async function duplicateInternalSale(
  sourceId: string,
): Promise<DuplicateResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: src, error: fErr } = await sb
    .from("internal_sales")
    .select("from_branch_id, to_branch_id, note")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sourceId)
    .single();
  if (fErr) handleError(fErr, "duplicateInternalSale.fetch");
  if (!src) throw new Error("Không tìm thấy phiếu bán nội bộ gốc");

  const code = await nextEntityCode("internal_sale");
  const { data: created, error: iErr } = await sb
    .from("internal_sales")
    .insert({
      tenant_id: ctx.tenantId,
      from_branch_id: src.from_branch_id,
      to_branch_id: src.to_branch_id,
      code,
      status: "draft",
      note: src.note ? `[Sao chép] ${src.note}` : null,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (iErr) handleError(iErr, "duplicateInternalSale.insert");

  await recordAuditLog({
    entityType: "internal_sale",
    entityId: created.id,
    action: "create",
    newData: { sourceId, code: created.code, kind: "duplicate" },
  });

  return { id: created.id, code: created.code };
}

// ============================================================
// 5. Production Order (Lệnh sản xuất)
// ============================================================

export async function duplicateProductionOrder(
  sourceId: string,
): Promise<DuplicateResult> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: src, error: fErr } = await sb
    .from("production_orders")
    .select("branch_id, product_id, planned_qty, bom_id, note")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", sourceId)
    .single();
  if (fErr) handleError(fErr, "duplicateProductionOrder.fetch");
  if (!src) throw new Error("Không tìm thấy lệnh sản xuất gốc");

  const code = await nextEntityCode("production_order");
  const { data: created, error: iErr } = await sb
    .from("production_orders")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: src.branch_id ?? ctx.branchId,
      code,
      status: "draft",
      product_id: src.product_id,
      planned_qty: src.planned_qty,
      bom_id: src.bom_id ?? null,
      note: src.note ? `[Sao chép] ${src.note}` : null,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();
  if (iErr) handleError(iErr, "duplicateProductionOrder.insert");

  await recordAuditLog({
    entityType: "production_order",
    entityId: created.id,
    action: "create",
    newData: { sourceId, code: created.code, kind: "duplicate" },
  });

  return { id: created.id, code: created.code };
}
