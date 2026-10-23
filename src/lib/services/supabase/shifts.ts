/**
 * Shift Management Service
 *
 * Open/close shifts, calculate expected cash, reconciliation.
 */

import { getClient, handleError, getCurrentTenantId } from "./base";
import type { Shift, OpenShiftInput, CloseShiftInput, ShiftTotalsInput } from "@/lib/types/shift";
import { normalizeCreatedAtRange } from "@/lib/utils/list-date-preset-range";
import type { ShiftCashEntry } from "@/lib/shift-cash-preview";
import { parseShiftPreview, readReconciledShiftPages } from "./shift-readers";

// ── Mappers ──

function mapShift(row: Record<string, unknown>): Shift {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    branchId: row.branch_id as string,
    cashierId: row.cashier_id as string,
    cashierName: typeof row.cashier_name === "string" ? row.cashier_name
      : (row.profiles as { full_name?: string } | null)?.full_name ?? undefined,
    status: row.status as "open" | "closed",
    openedAt: row.opened_at as string,
    closedAt: (row.closed_at as string) ?? null,
    startingCash: row.starting_cash != null ? Number(row.starting_cash) : null,
    expectedCash: row.expected_cash != null ? Number(row.expected_cash) : null,
    actualCash: row.actual_cash != null ? Number(row.actual_cash) : null,
    cashDifference: row.cash_difference != null ? Number(row.cash_difference) : null,
    totalSales: row.total_sales != null ? Number(row.total_sales) : null,
    totalOrders: row.total_orders != null ? Number(row.total_orders) : null,
    salesByMethod: (row.sales_by_method as Record<string, number>) ?? null,
    note: (row.note as string) ?? null,
    closeKind: (row.close_kind as Shift["closeKind"]) ?? null,
    expectedTransfer: row.expected_transfer == null ? null : Number(row.expected_transfer),
    actualTransfer: row.actual_transfer == null ? null : Number(row.actual_transfer),
    transferDifference: row.transfer_difference == null ? null : Number(row.transfer_difference),
  };
}

function mapOperationalShift(row: Record<string, unknown>): Shift {
  return {
    ...mapShift(row), startingCash: null, expectedCash: null, actualCash: null,
    cashDifference: null, totalSales: null, totalOrders: null, salesByMethod: null,
  };
}

// ── Queries ──

async function readOpenShiftStatus(branchId: string): Promise<Record<string, unknown>> {
  const { data, error } = await getClient().rpc("get_open_shift_status_scoped" as never,
    { p_branch_id: branchId } as never);
  if (error) handleError(error, "readOpenShiftStatus");
  const result = data as unknown as Record<string, unknown> | null;
  if (!result || result.branch_id !== branchId) throw new Error("Chưa xác nhận được trạng thái ca.");
  return result;
}

function readOperationalRow(value: unknown, branchId: string, cashierId?: string): Shift | null {
  if (value === null) return null;
  const row = value as Record<string, unknown> | undefined;
  if (!row || typeof row.id !== "string" || typeof row.tenant_id !== "string"
    || typeof row.cashier_id !== "string" || row.branch_id !== branchId || row.status !== "open"
    || typeof row.opened_at !== "string" || !Number.isFinite(Date.parse(row.opened_at))
    || (cashierId !== undefined && row.cashier_id !== cashierId)) {
    throw new Error("Chưa xác nhận được trạng thái ca.");
  }
  return mapOperationalShift(row);
}

/** Get current open shift for a cashier at a branch */
export async function getOpenShift(branchId: string, cashierId: string): Promise<Shift | null> {
  const result = await readOpenShiftStatus(branchId);
  return readOperationalRow(result.own, branchId, cashierId);
}

/** Get any open shift at a branch (for checking if someone else is on shift) */
export async function getAnyOpenShift(branchId: string): Promise<Shift | null> {
  const result = await readOpenShiftStatus(branchId);
  return readOperationalRow(result.active, branchId);
}

async function openShiftWithRpc(
  input: OpenShiftInput,
  channel: "retail" | "fnb",
): Promise<Shift & { alreadyOpen?: boolean }> {
  if (!Number.isFinite(input.startingCash) || input.startingCash < 0) {
    throw new Error("Số tiền đầu ca không hợp lệ.");
  }
  const supabase = getClient();
  // Actor and tenant are derived by the RPC. If another tab already opened
  // the shift, it returns that row instead of raising idx_shifts_open.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("open_shift_operational", {
    p_branch_id: input.branchId,
    p_starting_cash: input.startingCash,
    p_channel: channel,
  });

  if (error) {
    handleError(error, "openShift");
  }
  if (!data) throw new Error("Không mở được ca");

  const row = data as Record<string, unknown>;
  return {
    ...readOperationalRow(row, input.branchId, input.cashierId)!,
    alreadyOpen: Boolean(row.already_open),
  };
}

/** Open a Retail POS shift. Server requires pos_retail.checkout. */
export async function openShift(
  input: OpenShiftInput,
): Promise<Shift & { alreadyOpen?: boolean }> {
  return openShiftWithRpc(input, "retail");
}

/** Open an FnB POS shift. Server requires pos_fnb.checkout. */
export async function openFnbShift(
  input: OpenShiftInput,
): Promise<Shift & { alreadyOpen?: boolean }> {
  return openShiftWithRpc(input, "fnb");
}

/**
 * Báo cáo chi tiết 1 ca vừa đóng — dùng để in báo cáo X/Z trên máy in nhiệt.
 * Trả về thêm `cashIn`/`cashOut` so với `Shift` interface.
 */
export interface ShiftReport extends Shift {
  startingCash: number;
  expectedCash: number;
  actualCash: number;
  cashDifference: number;
  totalSales: number;
  totalOrders: number;
  salesByMethod: Record<string, number>;
  cashIn: number;
  cashOut: number;
}

export interface ShiftCloseResult {
  shiftId: string;
  closedAt: string;
  actualCash: number;
  report: ShiftReport | null;
}

/**
 * Đóng ca qua nguồn vận hành; máy chủ gọi chung hàm chốt tiền hiện tại.
 *
 * Khác biệt so với implementation cũ:
 *   - Filter `cash_transactions` + `invoices` theo `shift_id` (KHÔNG theo
 *     branch_id + thời gian) → chính xác tuyệt đối, không trộn với ca khác
 *     cùng chi nhánh.
 *   - All-or-nothing: update shift + tính toán trong cùng 1 transaction.
 *   - Return chi tiết cash_in / cash_out / sales_by_method để in báo cáo X/Z.
 *
 * Nguồn vận hành phải được phát hành trước giao diện.
 */
async function reconcileFnbShift(shiftId: string, actualCash: number, totals: ShiftTotalsInput, note?: string, reason?: string) {
  const {data,error} = await getClient().rpc("fnb_reconcile_shift_totals_20261022" as never, {
    p_shift_id:shiftId,p_actual_cash:actualCash,p_actual_transfer:totals.actualTransfer,
    p_expected_cash:totals.expectedCash,p_expected_transfer:totals.expectedTransfer,p_close_kind:totals.closeKind,
    p_note:note??null,p_reason:reason??null,
  } as never);
  if(error) {
    if(error.message?.includes("SHIFT_STATE_CHANGED")||error.message?.includes("SHIFT_NOT_OPEN")) throw new Error("Ca đã được chốt hoặc đổi trạng thái ở thiết bị khác. Tải lại trạng thái ca trước khi tiếp tục.");
    if(error.message?.includes("SHIFT_TOTALS_CHANGED")) throw new Error("Số tiền của ca vừa thay đổi. Tải lại tổng quan, đối chiếu lại rồi xác nhận; ca chưa được chốt.");
    if(error.message?.includes("SHIFT_DIFFERENCE_REASON_REQUIRED")) throw new Error("Nhập lý do chênh lệch tiền mặt hoặc chuyển khoản trước khi chốt ca.");
    if(error.code==="PGRST202") throw new Error("Chưa cập nhật chức năng đối soát ca. Tải lại sau khi quản trị hoàn tất cập nhật.");
    handleError(error,"reconcileFnbShift");
  }
  return {data,error};
}

export async function closeShift(input: CloseShiftInput): Promise<ShiftCloseResult> {
  if (!Number.isFinite(input.actualCash) || input.actualCash < 0) {
    throw new Error("Số tiền kiểm đếm không hợp lệ.");
  }
  const supabase = getClient();

  const { data, error } = input.reconciliation
    ? await reconcileFnbShift(input.shiftId,input.actualCash,input.reconciliation,input.note)
    : await supabase.rpc("close_shift_operational" as never, {
    p_shift_id: input.shiftId,
    p_actual_cash: input.actualCash,
    p_note: input.note ?? null,
  } as never);

  if (error) handleError(error, "closeShift");
  return resolveShiftCloseResult(input, data, Boolean(input.reconciliation));
}

async function resolveShiftCloseResult(input: CloseShiftInput, data: unknown, reconciliation = false): Promise<ShiftCloseResult> {
  const supabase = getClient();
  const isNumeric = (value: unknown) => (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
    && Number.isFinite(Number(value));
  const response = data as Record<string, unknown> | null;
  const embeddedShift = reconciliation && response?.shift && typeof response.shift === "object"
    ? response.shift as Record<string, unknown> : null;
  const receipt = embeddedShift ? { ...response, shift_id: embeddedShift.id,
    closed_at: embeddedShift.closed_at, actual_cash: embeddedShift.actual_cash } : response;
  if (!receipt || receipt.shift_id !== input.shiftId
    || typeof receipt.closed_at !== "string" || !Number.isFinite(Date.parse(receipt.closed_at))
    || !isNumeric(receipt.actual_cash) || Number(receipt.actual_cash) !== input.actualCash) {
    throw new Error("Chưa xác nhận được trạng thái đóng ca. Tải lại trạng thái ca trước khi thử tiếp.");
  }
  const result: ShiftCloseResult = {
    shiftId: input.shiftId,
    closedAt: receipt.closed_at,
    actualCash: input.actualCash,
    report: null,
  };
  if (!isNumeric(receipt.cash_in) || !isNumeric(receipt.cash_out)) return result;

  // The atomic receipt confirms the close; report loading cannot undo it.
  try {
    const { data: context, error: fetchError } = embeddedShift
      ? { data: { mode: "reconciliation", shift: embeddedShift }, error: null }
      : await supabase.rpc("get_shift_context_scoped" as never, { p_shift_id: input.shiftId } as never);
    const payload = context as unknown as { mode?: string; shift?: Record<string, unknown> } | null;
    const shift = payload?.shift;
    if (!fetchError && payload?.mode === "reconciliation" && shift && shift.id === input.shiftId && shift.status === "closed"
      && typeof shift.tenant_id === "string" && typeof shift.branch_id === "string"
      && Number(shift.actual_cash) === input.actualCash
      && [shift.starting_cash, shift.expected_cash, shift.actual_cash, shift.cash_difference,
        shift.total_sales, shift.total_orders].every(isNumeric)) {
      result.report = {
        ...mapShift(shift as unknown as Record<string, unknown>),
        startingCash: Number(shift.starting_cash),
        expectedCash: Number(shift.expected_cash),
        actualCash: Number(shift.actual_cash),
        cashDifference: Number(shift.cash_difference),
        totalSales: Number(shift.total_sales),
        totalOrders: Number(shift.total_orders),
        salesByMethod: (shift.sales_by_method as Record<string, number>) ?? {},
        cashIn: Number(receipt.cash_in),
        cashOut: Number(receipt.cash_out),
      };
    }
  } catch {
    // Reporting is read-only recovery work, never a second close attempt.
  }
  return result;
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
  reconciliation?: ShiftTotalsInput;
}): Promise<ShiftCloseResult> {
  if (!Number.isFinite(input.actualCash) || input.actualCash < 0) {
    throw new Error("Số tiền kiểm đếm không hợp lệ.");
  }
  const supabase = getClient();
  const { data, error } = input.reconciliation
    ? await reconcileFnbShift(input.shiftId,input.actualCash,input.reconciliation,input.note,input.reason)
    : await supabase.rpc(
    "reconcile_pending_shift" as never,
    {
      p_shift_id: input.shiftId,
      p_actual_cash: input.actualCash,
      p_reason: input.reason,
      p_note: input.note ?? null,
    } as never,
  );
  if (error) handleError(error, "reconcilePendingShift");
  return resolveShiftCloseResult(input, data, Boolean(input.reconciliation));
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
  cashEntries: ShiftCashEntry[];
  cashEntryCount?: number;
}

export async function previewShiftClose(shiftId: string): Promise<ShiftPreview> {
  if (!shiftId) throw new Error("Thiếu mã ca cần đối chiếu.");
  const tenantId = await getCurrentTenantId();
  const { data, error } = await getClient().rpc("get_shift_close_preview_scoped" as never,
    { p_shift_id: shiftId } as never);
  if (error) handleError(error, "previewShiftClose");
  return parseShiftPreview(data, shiftId, tenantId);
}

// ============================================================
// BÁO CÁO ĐỐI CHIẾU CA — CEO 05/06/2026
// Liệt kê ca đã reconcile (manual close hoặc reconcile_pending_shift).
// CEO dùng để theo dõi: ai tự đối chiếu, variance bao nhiêu, lý do gì.
// ============================================================

export interface ReconciledShiftRow {
  id: string;
  branchId: string;
  branchName: string;
  cashierId: string;
  cashierName: string;
  /** uid của người đối chiếu — có thể trùng cashier (tự đối chiếu) hoặc khác (chiếu hộ). null nếu close trực tiếp (không qua reconcile_pending_shift) */
  reconciledById: string | null;
  reconciledByName: string | null;
  openedAt: string;
  closedAt: string | null;
  reconciledAt: string | null;
  /** Cờ ca cũ bị auto-mark pending (cashier quên đóng) */
  wasAutoMarkedPending: boolean;
  startingCash: number;
  expectedCash: number;
  actualCash: number;
  closeKind?: Shift["closeKind"];
  expectedTransfer?: number | null; actualTransfer?: number | null; transferDifference?: number | null;
  /** actualCash - expectedCash. >0 thừa, <0 thiếu. */
  variance: number;
  totalSales: number;
  totalOrders: number;
  reason: string | null;
  note: string | null;
}

export interface ReconciledShiftFilter {
  branchId?: string;
  dateFrom?: string; // ISO date
  dateTo?: string; // ISO date
  /** 'all' (mặc định) | 'self' (tự đối chiếu) | 'cross' (chiếu hộ) | 'big_variance' (variance > 5% expectedCash) */
  type?: "all" | "self" | "cross" | "big_variance";
}

export async function getReconciledShifts(
  filter: ReconciledShiftFilter = {},
): Promise<ReconciledShiftRow[]> {
  const tenantId = await getCurrentTenantId();
  const range = normalizeCreatedAtRange(filter);
  return readReconciledShiftPages({ tenantId, branchId: filter.branchId ?? null,
    from: range.from ?? null, toExclusive: range.toExclusive ?? null, type: filter.type ?? "all" },
  async (args) => {
    const { data, error } = await getClient().rpc("get_reconciled_shifts_scoped" as never, args as never);
    if (error) handleError(error, "getReconciledShifts");
    return data;
  });
}

export interface ReconciledShiftInvoiceDetail {
  id: string;
  code: string;
  customerName: string;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  total: number;
  paid: number;
  paymentMethod: string;
  source: string;
  createdAt: string;
  voidReason: string | null;
}

export interface ReconciledShiftCashDetail {
  id: string;
  code: string;
  type: "receipt" | "payment";
  category: string;
  amount: number;
  paymentMethod: string;
  status: "draft" | "completed" | "cancelled";
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  transactionDate: string;
}

export interface ReconciledShiftDetail {
  invoices: ReconciledShiftInvoiceDetail[];
  transactions: ReconciledShiftCashDetail[];
  summary: {
    completedInvoiceCount: number;
    cancelledInvoiceCount: number;
    completedSales: number;
    ledgerReceipts: number;
    ledgerPayments: number;
    cashReceipts: number;
    cashPayments: number;
    netCashMovement: number;
  };
}

export function summarizeReconciledShiftDetail(
  invoices: ReconciledShiftInvoiceDetail[],
  transactions: ReconciledShiftCashDetail[],
): ReconciledShiftDetail["summary"] {
  const completedInvoices = invoices.filter((invoice) => invoice.status === "completed");
  const completedTransactions = transactions.filter(
    (transaction) => transaction.status === "completed",
  );
  const receipts = completedTransactions.filter((transaction) => transaction.type === "receipt");
  const payments = completedTransactions.filter((transaction) => transaction.type === "payment");
  const cashReceipts = receipts
    .filter((transaction) => transaction.paymentMethod === "cash")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const cashPayments = payments
    .filter((transaction) => transaction.paymentMethod === "cash")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    completedInvoiceCount: completedInvoices.length,
    cancelledInvoiceCount: invoices.filter((invoice) => invoice.status === "cancelled").length,
    completedSales: completedInvoices.reduce((sum, invoice) => sum + invoice.total, 0),
    ledgerReceipts: receipts.reduce((sum, transaction) => sum + transaction.amount, 0),
    ledgerPayments: payments.reduce((sum, transaction) => sum + transaction.amount, 0),
    cashReceipts,
    cashPayments,
    netCashMovement: cashReceipts - cashPayments,
  };
}

/**
 * Bounded, read-only drill-down for one reconciled shift. Both sources are
 * joined by shift_id so overlapping cashiers or back-dated invoices cannot be
 * pulled into the wrong reconciliation.
 */
export async function getReconciledShiftDetail(
  shiftId: string,
): Promise<ReconciledShiftDetail> {
  if (!shiftId) throw new Error("Thiếu mã ca cần đối soát.");
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { data: context, error: contextError } = await supabase.rpc(
    "get_shift_context_scoped" as never, { p_shift_id: shiftId } as never,
  );
  if (contextError) handleError(contextError, "getReconciledShiftDetail.context");
  const payload = context as unknown as { mode?: string; shift?: Record<string, unknown> } | null;
  const shift = payload?.shift;
  if (payload?.mode !== "reconciliation" || !shift || shift.id !== shiftId
    || shift.tenant_id !== tenantId || typeof shift.branch_id !== "string" || !shift.branch_id) {
    throw new Error("Không có quyền đối chiếu ca hoặc chưa xác nhận được phạm vi chi nhánh.");
  }

  // Keep the legacy table consumers branch-bound until their server readers replace them.
  async function readAllPages<T extends { id: string }>(
    read: (offset: number, pageSize: number) => PromiseLike<{
      data: T[] | null; error: { message: string } | null; count: number | null;
    }>,
  ): Promise<T[]> {
    const pageSize = 500;
    const rows: T[] = [];
    const seen = new Set<string>();
    let total: number | null = null;
    for (;;) {
      const { data, error, count } = await read(rows.length, pageSize);
      if (error) handleError(error, "getReconciledShiftDetail.documents");
      if (!Array.isArray(data) || !Number.isSafeInteger(count) || count! < 0
        || (total !== null && count !== total) || data.length > pageSize
        || rows.length + data.length > count!) {
        throw new Error("Dữ liệu đối chiếu ca đã thay đổi hoặc chưa đầy đủ. Tải lại để đối chiếu.");
      }
      total = count!;
      for (const row of data) {
        if (!row || typeof row.id !== "string" || !row.id || seen.has(row.id)) {
          throw new Error("Dữ liệu đối chiếu ca bị trùng hoặc không hợp lệ. Tải lại để đối chiếu.");
        }
        seen.add(row.id);
        rows.push(row);
      }
      if (rows.length === total) return rows;
      if (data.length === 0) {
        throw new Error("Dữ liệu đối chiếu ca chưa đầy đủ. Tải lại để đối chiếu.");
      }
    }
  }

  const [invoiceRows, cashRows] = await Promise.all([
    readAllPages((offset, pageSize) => supabase
      .from("invoices")
      .select(
        "id, code, customer_name, status, total, paid, payment_method, source, created_at, void_reason",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("branch_id", shift.branch_id as string)
      .eq("shift_id", shiftId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1)),
    readAllPages((offset, pageSize) => supabase
      .from("cash_transactions")
      .select(
        "id, code, type, category, amount, payment_method, status, reference_type, reference_id, note, transaction_date",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("branch_id", shift.branch_id as string)
      .eq("shift_id", shiftId)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1)),
  ]);

  const invoices: ReconciledShiftInvoiceDetail[] = invoiceRows.map((row) => ({
    id: row.id,
    code: row.code,
    customerName: row.customer_name || "Khách lẻ",
    status: row.status,
    total: Number(row.total ?? 0),
    paid: Number(row.paid ?? 0),
    paymentMethod: row.payment_method,
    source: row.source,
    createdAt: row.created_at,
    voidReason: row.void_reason ?? null,
  }));
  const transactions: ReconciledShiftCashDetail[] = cashRows.map((row) => ({
    id: row.id,
    code: row.code,
    type: row.type,
    category: row.category,
    amount: Number(row.amount ?? 0),
    paymentMethod: row.payment_method,
    status: row.status,
    referenceType: row.reference_type ?? null,
    referenceId: row.reference_id ?? null,
    note: row.note ?? null,
    transactionDate: row.transaction_date,
  }));

  return {
    invoices,
    transactions,
    summary: summarizeReconciledShiftDetail(invoices, transactions),
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
