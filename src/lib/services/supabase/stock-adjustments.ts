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

  // 1. Insert stock_movements ledger rows (always positive quantity)
  const movements: StockMovementInsert[] = inputs.map((i) => ({
    tenant_id: resolved.tenantId,
    branch_id: resolved.branchId,
    product_id: i.productId,
    type: i.type,
    quantity: i.quantity,
    reference_type: i.referenceType,
    reference_id: i.referenceId ?? null,
    note: i.note,
    created_by: resolved.createdBy,
  }));

  const { error: smErr } = await supabase
    .from("stock_movements")
    .insert(movements);
  if (smErr) handleError(smErr, "applyManualStockMovement:movements");

  // 2 + 3. Update products.stock and branch_stock per item
  // FIX: Use SQL atomic increment (`stock = stock + delta`) instead of
  // read-compute-write to prevent race conditions when two concurrent
  // mutations operate on the same product.
  for (const item of inputs) {
    const delta =
      item.type === "in" ? item.quantity
      : item.type === "out" ? -item.quantity
      : 0; // 'adjust' is a no-op for delta math
    if (delta === 0) continue;

    // 2. products.stock — atomic SQL increment via RPC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (supabase.rpc as any)("increment_product_stock", {
      p_product_id: item.productId,
      p_delta: delta,
    });
    if (updErr) handleError(updErr, "applyManualStockMovement:product_update");

    // 3. branch_stock — atomic upsert via RPC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: bsErr } = await (supabase.rpc as any)("upsert_branch_stock", {
      p_tenant_id: resolved.tenantId,
      p_branch_id: resolved.branchId,
      p_product_id: item.productId,
      p_delta: delta,
    });
    if (bsErr) handleError(bsErr, "applyManualStockMovement:branch_stock");
  }
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
