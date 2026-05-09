/**
 * Supabase service: Stock Transfers (Chuyển kho giữa chi nhánh)
 *
 * Sprint 7 "Toàn Cảnh"
 *
 * Workflow:
 *   draft → in_transit → completed
 *   draft → cancelled
 *   in_transit → cancelled
 *
 * Stock effects:
 *   - completeStockTransfer():
 *     1. Delegates to `complete_stock_transfer_atomic`
 *     2. Writes OUT/IN stock_movements and source/target branch_stock in one DB transaction
 *     3. Keeps company-wide products.stock unchanged because this is an inter-branch move
 */

import type { QueryParams, QueryResult } from "@/lib/types";
import {
  getClient,
  getCurrentContext,
  getCurrentTenantId,
  getPaginationRange,
  handleError,
} from "./base";
import { recordAuditLog } from "./audit";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface StockTransfer {
  id: string;
  code: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  status: StockTransferStatus;
  totalItems: number;
  note: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  completedAt: string | null;
}

export type StockTransferStatus = "draft" | "in_transit" | "completed" | "cancelled";

export interface StockTransferItem {
  productId: string;
  productName: string;
  productCode: string;
  unit?: string;
  quantity: number;
  note?: string;
}

export interface CreateStockTransferInput {
  fromBranchId: string;
  toBranchId: string;
  items: StockTransferItem[];
  note?: string;
}

/* ------------------------------------------------------------------ */
/*  State machine                                                      */
/* ------------------------------------------------------------------ */

const VALID_TRANSITIONS: Record<StockTransferStatus, StockTransferStatus[]> = {
  draft: ["in_transit", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionTransfer(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from as StockTransferStatus];
  if (!allowed) return false;
  return allowed.includes(to as StockTransferStatus);
}

export function getTransferStatusMeta(): Record<
  StockTransferStatus,
  { label: string; color: string }
> {
  return {
    draft: { label: "Phiếu tạm", color: "#94a3b8" },
    in_transit: { label: "Đang chuyển", color: "#004AC6" },
    completed: { label: "Hoàn thành", color: "#10b981" },
    cancelled: { label: "Đã hủy", color: "#ef4444" },
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export async function getStockTransfers(
  params: QueryParams
): Promise<QueryResult<StockTransfer>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("stock_transfers")
    .select(
      `*,
       from_branch:from_branch_id(name),
       to_branch:to_branch_id(name),
       profiles!stock_transfers_created_by_fkey(full_name)`,
      { count: "exact" }
    )
    .eq("tenant_id", tenantId);

  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,note.ilike.%${params.search}%`);
  }

  const statusFilter = params.filters?.status;
  if (typeof statusFilter === "string" && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  // Filter: chi nhánh — hiện transfer có CN này là source hoặc destination.
  // Tránh leak giữa các CN không liên quan.
  const branchFilter = params.filters?.branchId;
  if (typeof branchFilter === "string" && branchFilter && branchFilter !== "all") {
    query = query.or(`from_branch_id.eq.${branchFilter},to_branch_id.eq.${branchFilter}`);
  }

  query = query.order("created_at", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getStockTransfers");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transfers: StockTransfer[] = (data ?? []).map((row: any) => ({
    id: row.id,
    code: row.code,
    fromBranchId: row.from_branch_id,
    fromBranchName: row.from_branch?.name ?? "—",
    toBranchId: row.to_branch_id,
    toBranchName: row.to_branch?.name ?? "—",
    status: row.status as StockTransferStatus,
    totalItems: row.total_items ?? 0,
    note: row.note ?? "",
    createdBy: row.created_by ?? "",
    createdByName: (row.profiles as { full_name: string } | null)?.full_name ?? "",
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  }));

  return { data: transfers, total: count ?? 0 };
}

export function getTransferStatuses() {
  const meta = getTransferStatusMeta();
  return (Object.keys(meta) as StockTransferStatus[]).map((value) => ({
    label: meta[value].label,
    value,
    count: 0,
  }));
}

/**
 * Lấy chi tiết phiếu chuyển kho — bao gồm items — dùng cho InlineDetailPanel.
 */
export async function getStockTransferById(id: string): Promise<{
  transfer: StockTransfer;
  items: StockTransferItem[];
} | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: headerRow, error: headerErr } = await (supabase as any)
    .from("stock_transfers")
    .select(
      `*,
       from_branch:from_branch_id(name),
       to_branch:to_branch_id(name)`
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .single();

  if (headerErr || !headerRow) {
    if (headerErr) handleError(headerErr, "getStockTransferById:header");
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: itemRows, error: itemErr } = await (supabase as any)
    .from("stock_transfer_items")
    .select("product_id, product_name, product_code, unit, quantity, note")
    .eq("transfer_id", id);

  if (itemErr) handleError(itemErr, "getStockTransferById:items");

  const transfer: StockTransfer = {
    id: headerRow.id,
    code: headerRow.code,
    fromBranchId: headerRow.from_branch_id,
    fromBranchName: headerRow.from_branch?.name ?? "—",
    toBranchId: headerRow.to_branch_id,
    toBranchName: headerRow.to_branch?.name ?? "—",
    status: headerRow.status as StockTransferStatus,
    totalItems: headerRow.total_items ?? 0,
    note: headerRow.note ?? "",
    createdBy: headerRow.created_by ?? "",
    createdAt: headerRow.created_at,
    completedAt: headerRow.completed_at ?? null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: StockTransferItem[] = (itemRows ?? []).map((r: any) => ({
    productId: r.product_id,
    productName: r.product_name ?? "",
    productCode: r.product_code ?? "",
    unit: r.unit ?? undefined,
    quantity: Number(r.quantity ?? 0),
    note: r.note ?? undefined,
  }));

  return { transfer, items };
}

/* ------------------------------------------------------------------ */
/*  Create                                                             */
/* ------------------------------------------------------------------ */

export async function createStockTransfer(
  input: CreateStockTransferInput
): Promise<{ id: string; code: string }> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  if (input.fromBranchId === input.toBranchId) {
    throw new Error("Chi nhánh nguồn và đích không được trùng nhau");
  }
  if (!input.items.length) {
    throw new Error("Phiếu chuyển kho phải có ít nhất 1 sản phẩm");
  }

  // Validate quantities
  for (const it of input.items) {
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) {
      throw new Error(
        `Số lượng của "${it.productName}" phải lớn hơn 0`,
      );
    }
  }

  // ─── Server-side stock guard ─────────────────────────────────────
  // Trước khi tạo phiếu, verify từng SP còn đủ tồn ở chi nhánh xuất.
  // Client UI cũng cap lại qty, nhưng race giữa nhiều người chuyển cùng
  // lúc có thể xảy ra → check ở đây để fail sớm + descriptive error.
  const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: stockRows, error: stockErr } = await (supabase as any)
    .from("branch_stock")
    .select("product_id, quantity, reserved")
    .eq("tenant_id", ctx.tenantId)
    .eq("branch_id", input.fromBranchId)
    .in("product_id", productIds);
  if (stockErr) handleError(stockErr, "createStockTransfer.checkStock");

  const availableMap = new Map<string, number>();
   
  for (const row of stockRows ?? []) {
    const avail = Number(row.quantity ?? 0) - Number(row.reserved ?? 0);
    availableMap.set(row.product_id as string, avail);
  }

  const violations: string[] = [];
  for (const it of input.items) {
    const avail = availableMap.get(it.productId) ?? 0;
    if (it.quantity > avail) {
      violations.push(
        `${it.productName} (cần ${it.quantity}${it.unit ? " " + it.unit : ""}, còn ${avail}${it.unit ? " " + it.unit : ""})`,
      );
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Không đủ tồn kho tại chi nhánh xuất: ${violations.join("; ")}`,
    );
  }

  // Generate code
  const { data: code, error: codeErr } = await supabase.rpc("next_code", {
    p_tenant_id: ctx.tenantId,
    p_entity_type: "stock_transfer",
  });
  if (codeErr) handleError(codeErr, "createStockTransfer.code");
  const transferCode = (code as string | null) ?? `CK${Date.now()}`;

  // Insert header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: transfer, error: insertErr } = await (supabase as any)
    .from("stock_transfers")
    .insert({
      tenant_id: ctx.tenantId,
      code: transferCode,
      from_branch_id: input.fromBranchId,
      to_branch_id: input.toBranchId,
      status: "draft",
      total_items: input.items.length,
      note: input.note ?? null,
      created_by: ctx.userId,
    })
    .select("id, code")
    .single();

  if (insertErr) handleError(insertErr, "createStockTransfer.insert");

  // Insert items
  const itemRows = input.items.map((item) => ({
    transfer_id: transfer.id,
    product_id: item.productId,
    product_name: item.productName,
    product_code: item.productCode,
    unit: item.unit ?? null,
    quantity: item.quantity,
    note: item.note ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: itemsErr } = await (supabase as any)
    .from("stock_transfer_items")
    .insert(itemRows);
  if (itemsErr) handleError(itemsErr, "createStockTransfer.items");

  return { id: transfer.id, code: transfer.code };
}

/* ------------------------------------------------------------------ */
/*  Complete — commits stock movement                                  */
/* ------------------------------------------------------------------ */

/**
 * Complete a stock transfer via one Postgres transaction.
 *
 * The RPC claims the transfer, writes OUT/IN ledger rows, and rebalances
 * branch_stock for source/target branches. products.stock stays unchanged.
 */
export async function completeStockTransfer(transferId: string): Promise<void> {
  const supabase = getClient();
  const ctx = await getCurrentContext();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("complete_stock_transfer_atomic", {
    p_tenant_id: ctx.tenantId,
    p_transfer_id: transferId,
    p_created_by: ctx.userId,
  });
  if (error) handleError(error, "completeStockTransfer.atomic_rpc");

  void recordAuditLog({
    entityType: "stock_transfer",
    entityId: transferId,
    action: "complete",
    newData: { status: "completed", atomic: true },
  });
}

/* ------------------------------------------------------------------ */
/*  Cancel                                                             */
/* ------------------------------------------------------------------ */

export async function cancelStockTransfer(transferId: string): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: claimed, error: claimErr } = await (supabase as any)
    .from("stock_transfers")
    .update({ status: "cancelled" })
    .eq("tenant_id", tenantId)
    .eq("id", transferId)
    .in("status", ["draft", "in_transit"])
    .select("id")
    .maybeSingle();
  if (claimErr) handleError(claimErr, "cancelStockTransfer.claim");
  if (!claimed) {
    throw new Error("Không thể hủy phiếu chuyển kho đã hoàn thành");
  }
}

/* ------------------------------------------------------------------ */
/*  Update status (generic transition)                                 */
/* ------------------------------------------------------------------ */

export async function updateTransferStatus(
  transferId: string,
  newStatus: StockTransferStatus
): Promise<void> {
  if (newStatus === "completed") {
    await completeStockTransfer(transferId);
    return;
  }
  if (newStatus === "cancelled") {
    await cancelStockTransfer(transferId);
    return;
  }

  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current, error: readErr } = await (supabase as any)
    .from("stock_transfers")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", transferId)
    .single();
  if (readErr) handleError(readErr, "updateTransferStatus.read");
  if (!current) throw new Error("Không tìm thấy phiếu chuyển kho");

  if (!canTransitionTransfer(current.status, newStatus)) {
    throw new Error(`Không thể chuyển từ "${current.status}" sang "${newStatus}"`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from("stock_transfers")
    .update({ status: newStatus })
    .eq("tenant_id", tenantId)
    .eq("id", transferId);
  if (updateErr) handleError(updateErr, "updateTransferStatus.update");
}
