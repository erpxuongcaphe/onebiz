/**
 * Shift Management Service
 *
 * Open/close shifts, calculate expected cash, reconciliation.
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import type { Shift, OpenShiftInput, CloseShiftInput } from "@/lib/types/shift";

// ── Mappers ──

function mapShift(row: Record<string, unknown>): Shift {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    branchId: row.branch_id as string,
    cashierId: row.cashier_id as string,
    cashierName: (row.profiles as { full_name?: string } | null)?.full_name ?? undefined,
    status: row.status as "open" | "closed",
    openedAt: row.opened_at as string,
    closedAt: (row.closed_at as string) ?? null,
    startingCash: Number(row.starting_cash ?? 0),
    expectedCash: row.expected_cash != null ? Number(row.expected_cash) : null,
    actualCash: row.actual_cash != null ? Number(row.actual_cash) : null,
    cashDifference: row.cash_difference != null ? Number(row.cash_difference) : null,
    totalSales: Number(row.total_sales ?? 0),
    totalOrders: Number(row.total_orders ?? 0),
    salesByMethod: (row.sales_by_method as Record<string, number>) ?? {},
    note: (row.note as string) ?? null,
  };
}

// ── Queries ──

/** Get current open shift for a cashier at a branch */
export async function getOpenShift(branchId: string, cashierId: string): Promise<Shift | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("cashier_id", cashierId)
    .eq("status", "open")
    .maybeSingle();

  if (error) handleError(error, "getOpenShift");
  if (!data) return null;
  return mapShift(data as unknown as Record<string, unknown>);
}

/** Get any open shift at a branch (for checking if someone else is on shift) */
export async function getAnyOpenShift(branchId: string): Promise<Shift | null> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();

  if (error) handleError(error, "getAnyOpenShift");
  if (!data) return null;
  return mapShift(data as unknown as Record<string, unknown>);
}

/** Open a new shift */
export async function openShift(input: OpenShiftInput): Promise<Shift> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("shifts")
    .insert({
      tenant_id: input.tenantId,
      branch_id: input.branchId,
      cashier_id: input.cashierId,
      starting_cash: input.startingCash,
      status: "open",
    })
    .select("*, profiles(full_name)")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("Bạn đã có ca đang mở tại chi nhánh này");
    }
    handleError(error, "openShift");
  }
  return mapShift(data as unknown as Record<string, unknown>);
}

/**
 * Báo cáo chi tiết 1 ca vừa đóng — dùng để in báo cáo X/Z trên máy in nhiệt.
 * Trả về thêm `cashIn`/`cashOut` so với `Shift` interface.
 */
export interface ShiftReport extends Shift {
  cashIn: number;
  cashOut: number;
}

/**
 * Đóng ca với cash reconciliation — ATOMIC qua RPC `close_shift_atomic`.
 *
 * Khác biệt so với implementation cũ:
 *   - Filter `cash_transactions` + `invoices` theo `shift_id` (KHÔNG theo
 *     branch_id + thời gian) → chính xác tuyệt đối, không trộn với ca khác
 *     cùng chi nhánh.
 *   - All-or-nothing: update shift + tính toán trong cùng 1 transaction.
 *   - Return chi tiết cash_in / cash_out / sales_by_method để in báo cáo X/Z.
 *
 * YÊU CẦU: migration 00030_shift_integrity.sql đã chạy.
 */
export async function closeShift(input: CloseShiftInput): Promise<ShiftReport> {
  const supabase = getClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("close_shift_atomic", {
    p_shift_id: input.shiftId,
    p_actual_cash: input.actualCash,
    p_note: input.note ?? null,
  });

  if (error) handleError(error, "closeShift");
  if (!data) throw new Error("Không đóng được ca");

  // Load full shift record (with cashier name) để map về UI
  const tenantId = await getCurrentTenantId();
  const { data: shift, error: fetchError } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("tenant_id", tenantId)
    .eq("id", input.shiftId)
    .single();
  if (fetchError || !shift) throw new Error("Không đọc được ca sau khi đóng");

  const base = mapShift(shift as unknown as Record<string, unknown>);

  // Ép kiểu JSON từ RPC
  const rpcResult = data as {
    cash_in?: number | string;
    cash_out?: number | string;
  };

  return {
    ...base,
    cashIn: Number(rpcResult.cash_in ?? 0),
    cashOut: Number(rpcResult.cash_out ?? 0),
  };
}

// ============================================================
// PENDING RECONCILE — CEO 05/06/2026 — auto-mark + reconcile
// Migration 00127. Cashier quên đóng ca → POS mount tự mark pending.
// Manager đối chiếu sau qua reconcile_pending_shift RPC.
// ============================================================

/**
 * Mark mọi ca open quá cutoff_hour của branch → pending_reconcile.
 * Gọi MỘT LẦN khi POS mount (idempotent — 0 rows OK).
 * Trả về số ca vừa mark (>0 nghĩa là cần hiển thị popup).
 */
export async function markOverdueShiftsForBranch(branchId: string): Promise<number> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "mark_overdue_shifts_for_branch",
    { p_branch_id: branchId },
  );
  if (error) handleError(error, "markOverdueShiftsForBranch");
  return Number(data ?? 0);
}

export interface PendingShift {
  id: string;
  branchId: string;
  branchName: string;
  cashierId: string;
  cashierName: string;
  openedAt: string;
  autoMarkedPendingAt: string;
  startingCash: number;
  shiftDurationHours: number;
}

/**
 * Get pending shifts cho 1 branch (filter cho POS popup) hoặc all (admin overview).
 * Dùng view `pending_shifts_view` đã create ở migration 00127.
 */
export async function getPendingShifts(branchId?: string): Promise<PendingShift[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("pending_shifts_view")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("opened_at", { ascending: true });
  if (branchId) query = query.eq("branch_id", branchId);

  const { data, error } = await query;
  if (error) handleError(error, "getPendingShifts");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name ?? "—",
    cashierId: row.cashier_id,
    cashierName: row.cashier_name ?? "—",
    openedAt: row.opened_at,
    autoMarkedPendingAt: row.auto_marked_pending_at,
    startingCash: Number(row.starting_cash ?? 0),
    shiftDurationHours: Number(row.shift_duration_hours ?? 0),
  }));
}

/**
 * Manager đối chiếu pending shift → chốt qua close_shift_atomic.
 * Bắt buộc nhập `reason` (>= 3 ký tự).
 */
export async function reconcilePendingShift(input: {
  shiftId: string;
  actualCash: number;
  reason: string;
  note?: string;
}): Promise<ShiftReport> {
  const supabase = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(
    "reconcile_pending_shift",
    {
      p_shift_id: input.shiftId,
      p_actual_cash: input.actualCash,
      p_reason: input.reason,
      p_note: input.note ?? null,
    },
  );
  if (error) handleError(error, "reconcilePendingShift");
  if (!data) throw new Error("Không đối chiếu được ca");

  // Load full shift để return cùng shape với closeShift
  const tenantId = await getCurrentTenantId();
  const { data: shift } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("tenant_id", tenantId)
    .eq("id", input.shiftId)
    .single();
  const base = mapShift((shift ?? {}) as Record<string, unknown>);

  const rpcResult = data as { cash_in?: number; cash_out?: number };
  return {
    ...base,
    cashIn: Number(rpcResult.cash_in ?? 0),
    cashOut: Number(rpcResult.cash_out ?? 0),
  };
}

// ============================================================
// PREVIEW close shift — read-only, dùng để show summary trên dialog
// trước khi cashier xác nhận đóng ca thật (CEO 05/06/2026).
// Logic giống RPC close_shift_atomic nhưng KHÔNG update gì.
// ============================================================

export interface ShiftPreview {
  startingCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  totalSales: number;
  totalOrders: number;
  salesByMethod: Record<string, number>;
}

export async function previewShiftClose(shiftId: string): Promise<ShiftPreview> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // 1. Lấy shift để biết startingCash
  const { data: shift, error: shiftErr } = await supabase
    .from("shifts")
    .select("starting_cash")
    .eq("tenant_id", tenantId)
    .eq("id", shiftId)
    .single();
  if (shiftErr) handleError(shiftErr, "previewShiftClose:shift");
  const startingCash = Number(shift?.starting_cash ?? 0);

  // 2. Cash in/out — chỉ tiền mặt, status != cancelled
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cashRows, error: cashErr } = await (supabase as any)
    .from("cash_transactions")
    .select("type, amount, payment_method, status, reference_type")
    .eq("shift_id", shiftId);
  if (cashErr) handleError(cashErr, "previewShiftClose:cash");

  let cashIn = 0;
  let cashOut = 0;
  const salesByMethod: Record<string, number> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cashRows ?? []).forEach((r: any) => {
    if ((r.status ?? "completed") === "cancelled") return;
    const method = r.payment_method ?? "cash";
    const amt = Number(r.amount ?? 0);

    // Cash drawer reconciliation — chỉ method cash
    if (method === "cash") {
      if (r.type === "receipt") cashIn += amt;
      else if (r.type === "payment") cashOut += amt;
    }

    // Sales by method — chỉ tính giao dịch liên quan đến bán hàng
    if (r.reference_type === "invoice" || r.reference_type === "sales_return") {
      const net = r.type === "receipt" ? amt : -amt;
      salesByMethod[method] = (salesByMethod[method] ?? 0) + net;
    }
  });

  const expectedCash = startingCash + cashIn - cashOut;

  // 3. Đếm số hoá đơn completed
  const { count: orderCount } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("shift_id", shiftId)
    .eq("status", "completed");

  const totalSales = Object.values(salesByMethod).reduce((s, v) => s + v, 0);
  // Lọc method có amount = 0
  const cleanedMethods = Object.fromEntries(
    Object.entries(salesByMethod).filter(([, v]) => v !== 0),
  );

  return {
    startingCash,
    cashIn,
    cashOut,
    expectedCash,
    totalSales,
    totalOrders: orderCount ?? 0,
    salesByMethod: cleanedMethods,
  };
}

/** Get shift history for a branch */
export async function getShiftHistory(
  branchId: string,
  limit = 20
): Promise<Shift[]> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .order("opened_at", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getShiftHistory");
  return (data ?? []).map((row) => mapShift(row as unknown as Record<string, unknown>));
}
