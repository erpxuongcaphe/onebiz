/**
 * Stock Adjustments Service
 *
 * Helper for "manual" stock movements driven by warehouse dialogs:
 *   - Internal export   (out)  XNB
 *   - Disposal          (out)  XH
 *   - Purchase return   (out)  THN
 *   - Ad-hoc manufacturing (in) SX
 *
 * Mirrors the dual-table sync of `applyStockDecrement` in pos-checkout.ts:
 *   1. INSERT row(s) into `stock_movements` (positive quantity, sign carried by `type`)
 *   2. UPDATE `products.stock` (company snapshot)
 *   3. UPSERT `branch_stock` (per-branch snapshot, resilient: insert if missing)
 *
 * NOT atomic across items (fetch-then-update loop). Acceptable for single-cashier
 * terminals; a future RPC will harden this.
 *
 * Tenant/branch/createdBy are auto-resolved via `getCurrentContext` if not passed.
 * This is the fix for G2/G3 — the legacy dialogs hardcoded `tenant_id: ""` and
 * `branch_id: ""` which would fail FK validation under any RLS-enabled environment.
 */

import { getClient, getCurrentContext, handleError } from "./base";
import { recordAuditLog } from "./audit";
import { isInventoryLocked } from "./tenant-settings";
import type { Database } from "@/lib/supabase/types";

type StockMovementInsert = Database["public"]["Tables"]["stock_movements"]["Insert"];
type StockMovementType = StockMovementInsert["type"];

export interface ManualStockMovementInput {
  productId: string;
  /** Always positive magnitude — sign comes from `type`. */
  quantity: number;
  type: Exclude<StockMovementType, "transfer">;
  referenceType: string;
  referenceId?: string | null;
  note: string;
}

export interface ManualStockMovementContext {
  tenantId?: string;
  branchId?: string;
  createdBy?: string;
}

/**
 * Apply one or more manual stock movements as a single batch.
 *
 * Behavior by `type`:
 *   - 'in'      → +quantity to products.stock and branch_stock
 *   - 'out'     → -quantity from products.stock and branch_stock (can go negative)
 *   - 'adjust'  → no auto stock change; caller writes the new value via a separate path
 *
 * Stock CAN go negative ("owe to warehouse" / oversold). The dialogs warn the
 * user up front; the backend records the truth so the ledger and snapshots
 * stay in sync.
 */
export async function applyManualStockMovement(
  inputs: ManualStockMovementInput[],
  ctx?: ManualStockMovementContext
): Promise<void> {
  if (inputs.length === 0) return;
  const supabase = getClient();

  // Resolve full context (tenantId, branchId, createdBy) — fall back to current user
  const resolved = await resolveContext(ctx);

  const rpcItems = inputs.map((i) => ({
    product_id: i.productId,
    type: i.type,
    quantity: i.quantity,
    reference_type: i.referenceType,
    reference_id: i.referenceId ?? null,
    note: i.note,
  }));

  // All stock side effects are handled in one Postgres transaction:
  // stock_movements + products.stock + branch_stock.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcErr } = await (supabase.rpc as any)("apply_manual_stock_movement_atomic", {
    p_tenant_id: resolved.tenantId,
    p_branch_id: resolved.branchId,
    p_created_by: resolved.createdBy,
    p_items: rpcItems,
  });
  if (rpcErr) handleError(rpcErr, "applyManualStockMovement:atomic_rpc");

  // Audit log — gom theo referenceType/referenceId (1 event/đơn) để
  // detail panel "Lịch sử" nhặt được. Nếu không có referenceId (ad-hoc),
  // log từng item riêng.
  const groups = new Map<string, ManualStockMovementInput[]>();
  for (const i of inputs) {
    const key = i.referenceId ? `${i.referenceType}:${i.referenceId}` : `__adhoc:${i.productId}:${Math.random()}`;
    const arr = groups.get(key) ?? [];
    arr.push(i);
    groups.set(key, arr);
  }
  for (const [key, items] of groups) {
    const [refType, refId] = key.startsWith("__adhoc")
      ? [items[0].referenceType, ""]
      : key.split(":");
    void recordAuditLog({
      entityType: refType,
      entityId: refId || items[0].productId,
      action: items[0].type === "in" ? "create" : "delete",
      newData: {
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          type: i.type,
          note: i.note,
        })),
        branchId: resolved.branchId,
      },
    });
  }
}

/**
 * CEO 28/05/2026: Điều chỉnh tồn kho về 1 GIÁ TRỊ MỚI cho 1 SP tại 1 chi nhánh.
 *
 * Dùng cho nút "Điều chỉnh tồn" trong panel chi tiết trang Tồn kho. Tính
 * delta = newQty − currentQty rồi ghi nhận qua applyManualStockMovement:
 *   - delta > 0 → type 'in'  (nhập điều chỉnh)
 *   - delta < 0 → type 'out' (xuất điều chỉnh)
 *   - delta = 0 → no-op
 *
 * Tự động: ghi stock_movements (hiện ở tab "Lịch sử xuất nhập") + cập nhật
 * products.stock + branch_stock + audit log — tất cả atomic qua RPC.
 *
 * referenceType = 'stock_adjustment' để phân biệt với nhập/xuất thường.
 */
export async function adjustStockToValue(params: {
  productId: string;
  branchId: string;
  currentQty: number;
  newQty: number;
  reason: string;
}): Promise<void> {
  // CEO 28/05/2026: chặn nếu tồn kho đang khóa (defense-in-depth — kể cả
  // gọi API trực tiếp). UI cũng đã disable nút nhưng service vẫn check.
  if (await isInventoryLocked()) {
    throw new Error("Tồn kho đang khóa — cần mở khóa trước khi điều chỉnh.");
  }
  const delta = params.newQty - params.currentQty;
  if (Math.abs(delta) < 1e-9) return; // không đổi → bỏ qua
  await applyManualStockMovement(
    [
      {
        productId: params.productId,
        quantity: Math.abs(delta),
        type: delta > 0 ? "in" : "out",
        referenceType: "stock_adjustment",
        note: params.reason,
      },
    ],
    { branchId: params.branchId },
  );
}

/**
 * Generate a sequenced code for a warehouse entity via the `next_code` RPC.
 * This is the fix for G4 — the legacy dialogs used `Math.random()`
 * which produced collisions across tenants and was not monotonic.
 *
 * `entity_type` should match a row in `code_sequences` (the trigger
 * `handle_new_user` seeds the standard set; warehouse types are seeded by
 * the same trigger as of this commit, see 00003_functions_triggers.sql).
 * If the row does not exist, `next_code` falls back to `upper(left(type,2))`
 * as a prefix and creates the row on demand.
 */
export async function nextEntityCode(
  entityType: string,
  ctx?: { tenantId?: string }
): Promise<string> {
  const supabase = getClient();
  const tenantId = ctx?.tenantId ?? (await resolveContext()).tenantId;
  const { data, error } = await supabase.rpc("next_code", {
    p_tenant_id: tenantId,
    p_entity_type: entityType,
  });
  if (error) handleError(error, "nextEntityCode");
  return (data as string | null) ?? `${entityType.slice(0, 2).toUpperCase()}${Date.now()}`;
}

// ============================================================
// Internal helpers
// ============================================================

interface ResolvedContext {
  tenantId: string;
  branchId: string;
  createdBy: string;
}

async function resolveContext(ctx?: ManualStockMovementContext): Promise<ResolvedContext> {
  if (ctx?.tenantId && ctx?.branchId && ctx?.createdBy) {
    return { tenantId: ctx.tenantId, branchId: ctx.branchId, createdBy: ctx.createdBy };
  }
  const cur = await getCurrentContext();
  return {
    tenantId: ctx?.tenantId ?? cur.tenantId,
    branchId: ctx?.branchId ?? cur.branchId,
    createdBy: ctx?.createdBy ?? cur.userId,
  };
}
