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
