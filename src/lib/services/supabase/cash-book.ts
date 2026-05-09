/**
 * Supabase service: Cash Transactions (Sổ quỹ)
 */

import type { CashBookEntry, CashTransaction, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import {
  getClient,
  getCurrentContext,
  getCurrentTenantId,
  getPaginationRange,
  handleError,
} from "./base";
import { recordAuditLog } from "./audit";

type CashTransactionInsert = Database["public"]["Tables"]["cash_transactions"]["Insert"];

export async function getCashBookEntries(params: QueryParams): Promise<QueryResult<CashBookEntry>> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("cash_transactions")
    .select(
      "*, profiles!cash_transactions_created_by_fkey(full_name), branches!cash_transactions_branch_id_fkey(name)",
      { count: "exact" },
    )
    // Defense-in-depth: tenant filter ngay cả khi RLS bật. Trước đây service
    // không filter → demo có 4-5 tenant data trộn trong DB → user thấy phiếu
    // của tenant khác khi RLS tạm tắt.
    .eq("tenant_id", tenantId);

  // Search
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    query = query.or(`code.ilike.%${esc}%,counterparty.ilike.%${esc}%`);
  }

  // Filter: type (receipt | payment)
  if (params.filters?.type && params.filters.type !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("type", params.filters.type as any);
  }

  // Filter: payment method (cash | transfer | card | ewallet)
  if (params.filters?.paymentMethod && params.filters.paymentMethod !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("payment_method", params.filters.paymentMethod as any);
  }

  // Filter: category (thu_tien_khach, chi_tra_ncc, ...)
  if (params.filters?.category && params.filters.category !== "all") {
    query = query.eq("category", params.filters.category as string);
  }

  // Filter: ngày tạo (from/to)
  if (params.filters?.dateFrom) {
    query = query.gte("created_at", params.filters.dateFrom as string);
  }
  if (params.filters?.dateTo) {
    const end = new Date(params.filters.dateTo as string);
    end.setDate(end.getDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // Sort & paginate
  query = query
    .order("created_at", { ascending: false })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) handleError(error, "getCashBookEntries");

  const entries: CashBookEntry[] = (data ?? []).map(mapCashEntry);
  return { data: entries, total: count ?? 0 };
}

export function getCashBookTypes() {
  return [
    { value: "all", label: "Tất cả" },
    { value: "receipt", label: "Phiếu thu" },
    { value: "payment", label: "Phiếu chi" },
  ];
}

/**
 * Get cash book summary synchronously (zero fallback).
 * Used in components where async isn't ergonomic.
 * For real data, use getCashBookSummaryAsync().
 */
export function getCashBookSummary() {
  return { totalReceipt: 0, totalPayment: 0 };
}

/**
 * Get cash book summary from DB (async).
 *
 * @param branchId   filter theo chi nhánh (undefined = tất cả)
 * @param dateFrom   ISO string — tính tổng từ ngày này (inclusive)
 * @param dateTo     ISO string — tính tổng đến ngày này (inclusive, lt+1)
 *
 * Trước đây không nhận tham số → KPI luôn là tổng ALL TIME, ALL BRANCH
 * → CEO mở 1 quán xem tháng này thấy số ngàn tỷ ALL TIME → vô nghĩa.
 */
export async function getCashBookSummaryAsync(params?: {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{
  totalReceipt: number;
  totalPayment: number;
  openingBalance: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  let query = supabase
    .from("cash_transactions")
    .select("type, amount")
    .eq("tenant_id", tenantId);

  if (params?.branchId) query = query.eq("branch_id", params.branchId);
  if (params?.dateFrom) query = query.gte("created_at", params.dateFrom);
  if (params?.dateTo) {
    const end = new Date(params.dateTo);
    end.setDate(end.getDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }

  const { data, error } = await query;
  if (error) handleError(error, "getCashBookSummaryAsync");

  const totalReceipt = (data ?? [])
    .filter((e) => e.type === "receipt")
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

  const totalPayment = (data ?? [])
    .filter((e) => e.type === "payment")
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

  // Quỹ đầu kỳ = tổng (receipt - payment) TRƯỚC dateFrom (cho cùng branch).
  // Nếu không có dateFrom → openingBalance = 0 (period là all-time).
  let openingBalance = 0;
  if (params?.dateFrom) {
    let openingQ = supabase
      .from("cash_transactions")
      .select("type, amount")
      .eq("tenant_id", tenantId)
      .lt("created_at", params.dateFrom);
    if (params?.branchId) openingQ = openingQ.eq("branch_id", params.branchId);
    const { data: openingData } = await openingQ;
    openingBalance = (openingData ?? []).reduce((sum, e) => {
      const amt = Number(e.amount ?? 0);
      return sum + (e.type === "receipt" ? amt : -amt);
    }, 0);
  }

  return { totalReceipt, totalPayment, openingBalance };
}

// --- Write Operations ---

/**
 * Tạo phiếu thu/chi mới.
 */
export async function createCashTransaction(tx: Partial<CashTransaction>): Promise<CashBookEntry> {
  const supabase = getClient();
  const ctx = await getCurrentContext();

  const { data, error } = await supabase
    .from("cash_transactions")
    .insert({
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
      code: tx.code!,
      type: tx.type!,
      category: tx.category!,
      amount: tx.amount!,
      counterparty: tx.counterparty || null,
      payment_method: (tx.paymentMethod as "cash" | "transfer" | "card") ?? "cash",
      reference_type: tx.referenceType || null,
      reference_id: tx.referenceId || null,
      note: tx.note || null,
      created_by: tx.createdBy || ctx.userId,
    } satisfies CashTransactionInsert)
    .select()
    .single();

  if (error) handleError(error, "createCashTransaction");

  await recordAuditLog({
    entityType: "cash_transaction",
    entityId: data.id,
    action: "create",
    newData: {
      code: data.code,
      type: data.type,
      category: data.category,
      amount: data.amount,
      counterparty: data.counterparty,
      payment_method: data.payment_method,
    },
  });

  return mapCashEntry(data);
}

/**
 * Hủy phiếu thu/chi.
 *
 * Sprint SỔ-QUỸ-2: nếu phiếu có reference_id (gắn invoice/PO), gọi RPC
 * `cancel_cash_transaction` (migration 00046) để ATOMIC đảo lại
 * invoice/PO.paid/debt + customer/supplier.debt. Phiếu chỉ chuyển sang
 * status='cancelled' (giữ audit trail), KHÔNG hard delete.
 *
 * Phiếu tự do chỉ flip status='cancelled'. Phiếu có reference phải đi qua RPC
 * để đảo công nợ atomic; nếu thiếu RPC thì fail closed, không hard delete.
 */
export async function deleteCashTransaction(id: string): Promise<void> {
  await cancelCashTransaction(id, "Hủy từ UI sổ quỹ");
}

/**
 * Hủy phiếu thu/chi — Stage 5b refactor (CEO 06/05/2026).
 *
 * `deleteCashTransaction` now delegates here for backward compatibility.
 * - Cancel = giữ row + flip status='cancelled' + audit log với reason.
 * - Nếu phiếu gắn reference (invoice/PO) → reverse debt qua RPC.
 *
 * Schema cash_transactions có `status` column (chưa enforce CHECK constraint).
 *
 * @param id — cash transaction id
 * @param reason — lý do hủy (bắt buộc)
 */
export async function cancelCashTransaction(
  id: string,
  reason: string,
): Promise<void> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Snapshot
  let oldRow: Record<string, unknown> | null = null;
  let referenceType: string | null = null;
  try {
    const res = await supabase
      .from("cash_transactions")
      .select("code, type, category, amount, counterparty, reference_type, reference_id, status")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    oldRow = (res?.data as Record<string, unknown> | null) ?? null;
    referenceType = (oldRow?.reference_type as string | null) ?? null;
  } catch {
    /* snapshot optional */
  }
  if (!oldRow) throw new Error("Không tìm thấy phiếu thu/chi");

  // Nếu phiếu gắn reference → cancel RPC (atomic reverse debt)
  if (referenceType === "invoice" || referenceType === "purchase_order") {
    try {
      const { error: rpcErr } = await supabase.rpc(
        "cancel_cash_transaction" as never,
        {
          p_cash_id: id,
          p_reason: reason,
        } as never,
      );
      if (!rpcErr) {
        await recordAuditLog({
          entityType: "cash_transaction",
          entityId: id,
          action: "cancel",
          oldData: oldRow,
          newData: { status: "cancelled", reason },
        });
        return;
      }
      if (!/(does not exist|404|PGRST202)/i.test(rpcErr.message)) {
        handleError(rpcErr, "cancelCashTransaction.rpc");
      }
      throw new Error("Chưa có RPC cancel_cash_transaction. Không thể hủy phiếu có công nợ vì sẽ làm lệch sổ.");
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error("Không thể hủy phiếu thu/chi có công nợ.");
    }
  }

  // Phiếu tự do: chỉ flip status = 'cancelled' + ghi note reason.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from("cash_transactions")
    .update({
      status: "cancelled",
      note:
        ((oldRow.note as string | null) ?? "") +
        `\n[ĐÃ HỦY ${new Date().toISOString()}] ${reason}`.trim(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (updErr) handleError(updErr, "cancelCashTransaction.update");

  await recordAuditLog({
    entityType: "cash_transaction",
    entityId: id,
    action: "cancel",
    oldData: oldRow,
    newData: { status: "cancelled", reason },
  });
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCashEntry(row: any): CashBookEntry {
  const profile = row.profiles as { full_name: string } | null;
  const branch = row.branches as { name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.created_at,
    type: row.type,
    typeName: row.type === "receipt" ? "Phiếu thu" : "Phiếu chi",
    category: row.category,
    counterparty: row.counterparty ?? "",
    amount: row.amount,
    note: row.note ?? undefined,
    createdBy: row.created_by,
    createdByName: profile?.full_name ?? "",
    paymentMethod: row.payment_method ?? undefined,
    branchId: row.branch_id ?? undefined,
    branchName: branch?.name ?? undefined,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
  };
}
