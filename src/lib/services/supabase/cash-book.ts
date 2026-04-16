/**
 * Supabase service: Cash Transactions (Sổ quỹ)
 */

import type { CashBookEntry, CashTransaction, QueryParams, QueryResult } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { getClient, getCurrentContext, getPaginationRange, handleError } from "./base";

type CashTransactionInsert = Database["public"]["Tables"]["cash_transactions"]["Insert"];

export async function getCashBookEntries(params: QueryParams): Promise<QueryResult<CashBookEntry>> {
  const supabase = getClient();
  const { from, to } = getPaginationRange(params);

  let query = supabase
    .from("cash_transactions")
    .select("*", { count: "exact" });

  // Search
  if (params.search) {
    query = query.or(`code.ilike.%${params.search}%,counterparty.ilike.%${params.search}%`);
  }

  // Filter: type
  if (params.filters?.type && params.filters.type !== "all") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = query.eq("type", params.filters.type as any);
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
 */
export async function getCashBookSummaryAsync() {
  const supabase = getClient();

  const { data, error } = await supabase
    .from("cash_transactions")
    .select("type, amount");

  if (error) handleError(error, "getCashBookSummaryAsync");

  const totalReceipt = (data ?? [])
    .filter((e) => e.type === "receipt")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalPayment = (data ?? [])
    .filter((e) => e.type === "payment")
    .reduce((sum, e) => sum + e.amount, 0);

  return { totalReceipt, totalPayment };
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
  return mapCashEntry(data);
}

/**
 * Xóa phiếu thu/chi.
 */
export async function deleteCashTransaction(id: string): Promise<void> {
  const supabase = getClient();

  const { error } = await supabase
    .from("cash_transactions")
    .delete()
    .eq("id", id);

  if (error) handleError(error, "deleteCashTransaction");
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCashEntry(row: any): CashBookEntry {
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
  };
}
