/**
 * Shift Management Service
 *
 * Open/close shifts, calculate expected cash, reconciliation.
 */

import { getClient, handleError } from "./base";
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
  const { data, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
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
  const { data, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
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

/** Close a shift with cash reconciliation */
export async function closeShift(input: CloseShiftInput): Promise<Shift> {
  const supabase = getClient();

  // 1. Get the shift
  const { data: shift, error: fetchError } = await supabase
    .from("shifts")
    .select("*")
    .eq("id", input.shiftId)
    .eq("status", "open")
    .single();
  if (fetchError || !shift) throw new Error("Không tìm thấy ca đang mở");

  // 2. Calculate expected cash: starting_cash + cash payments during shift
  const { data: cashPayments } = await supabase
    .from("cash_transactions")
    .select("amount, type")
    .eq("branch_id", shift.branch_id)
    .gte("created_at", shift.opened_at)
    .lte("created_at", new Date().toISOString());

  let cashIn = 0;
  let cashOut = 0;
  for (const tx of cashPayments ?? []) {
    if (tx.type === "receipt") cashIn += Number(tx.amount);
    else cashOut += Number(tx.amount);
  }
  const expectedCash = Number(shift.starting_cash) + cashIn - cashOut;

  // 3. Count invoices during shift
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, total, payment_method")
    .eq("branch_id", shift.branch_id)
    .gte("created_at", shift.opened_at)
    .lte("created_at", new Date().toISOString())
    .neq("status", "cancelled");

  const totalSales = (invoices ?? []).reduce((sum, inv) => sum + Number(inv.total), 0);
  const totalOrders = (invoices ?? []).length;

  // Payment method breakdown
  const salesByMethod: Record<string, number> = {};
  for (const inv of invoices ?? []) {
    const method = inv.payment_method ?? "cash";
    salesByMethod[method] = (salesByMethod[method] ?? 0) + Number(inv.total);
  }

  // 4. Update shift
  const { data: closed, error: closeError } = await supabase
    .from("shifts")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      expected_cash: expectedCash,
      actual_cash: input.actualCash,
      cash_difference: input.actualCash - expectedCash,
      total_sales: totalSales,
      total_orders: totalOrders,
      sales_by_method: salesByMethod,
      note: input.note ?? null,
    })
    .eq("id", input.shiftId)
    .select("*, profiles(full_name)")
    .single();

  if (closeError) handleError(closeError, "closeShift");
  return mapShift(closed as unknown as Record<string, unknown>);
}

/** Get shift history for a branch */
export async function getShiftHistory(
  branchId: string,
  limit = 20
): Promise<Shift[]> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("shifts")
    .select("*, profiles(full_name)")
    .eq("branch_id", branchId)
    .order("opened_at", { ascending: false })
    .limit(limit);

  if (error) handleError(error, "getShiftHistory");
  return (data ?? []).map((row) => mapShift(row as unknown as Record<string, unknown>));
}
