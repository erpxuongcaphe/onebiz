/**
 * Supabase service: Cash Transactions (Sổ quỹ)
 */

import type { CashBookEntry, CashTransaction, QueryParams, QueryResult } from "@/lib/types";
import type { CashTimingInput } from "@/lib/cash-time";
import { recordTimedCash } from "./cash-timing";
import { cashBookDate } from "@/lib/cash-time";
import {
  getClient,
  getCurrentContext,
  getCurrentTenantId,
  getPaginationRange,
  handleError,
} from "./base";

/** Cash balances use DATE bookkeeping boundaries, never creation timestamps. */
function applyCashDateRange<T>(query: T, filters?: {dateFrom?: unknown; dateTo?: unknown}): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  if (typeof filters?.dateFrom === "string" && filters.dateFrom) q = q.gte("transaction_date", cashBookDate(filters.dateFrom));
  if (typeof filters?.dateTo === "string" && filters.dateTo) q = q.lte("transaction_date", cashBookDate(filters.dateTo));
  return q;
}

export interface CashBookWorkspaceParams {
  page: number;
  pageSize: number;
  search?: string;
  searchField?: string;
  types?: string[];
  paymentMethods?: string[];
  categories?: string[];
  statuses?: string[];
  dateFrom?: string;
  dateToExclusive?: string;
  amountMin?: number;
  amountMax?: number;
  branchId?: string;
}

/** Exact party identity, not a name search; RLS and branch scope remain active. */
export interface PartyCashHistoryFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: "receipt" | "payment";
  status?: "draft" | "completed" | "cancelled";
  paymentMethod?: "cash" | "transfer" | "card" | "ewallet";
  sortBy?: "transaction_date" | "amount" | "code";
  ascending?: boolean;
}

export async function getPartyCashHistory(
  mode: "customer" | "supplier", partyId: string,
  branchId?: string | null, page = 0,
  filters: PartyCashHistoryFilters = {}, pageSize = 25,
): Promise<QueryResult<CashBookEntry>> {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("Invalid history page");
  const supabase = getClient();
  const { data, error } = await supabase.rpc("get_party_cash_history_detail" as never, {
    p_mode: mode, p_party_id: partyId, p_branch_id: branchId || null,
    p_page: page, p_size: pageSize, p_filters: filters,
  } as never);
  if (error?.message.includes('PARTY_CASH_HISTORY_DENIED')) throw new Error('Tài khoản chưa có quyền xem lịch sử đối tượng hoặc chi nhánh này.');
  if (error?.message.includes('PARTY_CASH_FILTER_INVALID')) throw new Error('Bộ lọc lịch sử thu chi chưa hợp lệ. Kiểm tra lại kỳ và điều kiện lọc.');
  if (error) handleError(error, "getPartyCashHistory");
  const result = data as unknown as {items: Record<string,unknown>[]; total: number};
  if (!result || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.length > pageSize) throw new Error("Lịch sử thu chi chưa trả về đủ dữ liệu hợp lệ.");
  return { data: result.items.map(mapCashEntry), total: result.total };
}

export async function getAllPartyCashHistory(mode: "customer" | "supplier", partyId: string, branchId?: string | null, filters: PartyCashHistoryFilters = {}) {
  const rows: CashBookEntry[] = [];
  const ids = new Set<string>();
  let expected: number | undefined;
  for (let page = 0; ; page++) {
    const result = await getPartyCashHistory(mode, partyId, branchId, page, filters, 1000);
    expected ??= result.total;
    if (result.total !== expected || (!result.data.length && rows.length < expected)) throw new Error("Lịch sử đã thay đổi hoặc chưa tải đủ. Vui lòng xuất lại.");
    for (const row of result.data) {
      if (!row.id || ids.has(row.id)) throw new Error("Lịch sử bị trùng trong lúc tải. Vui lòng xuất lại.");
      ids.add(row.id); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (rows.length > expected) throw new Error("Số dòng lịch sử không khớp.");
  }
}

export interface CashBookWorkspaceSummary {
  totalReceipt: number;
  totalPayment: number;
  receiptCount: number;
  paymentCount: number;
  openingBalance: number;
  closingBalance: number;
}

export interface CashBookWorkspaceResult extends QueryResult<CashBookEntry> {
  summary: CashBookWorkspaceSummary;
  categoryOptions: Array<{ value: string; count: number }>;
}

/** Một nguồn đọc duy nhất cho bảng, KPI, bộ lọc và file xuất Sổ quỹ. */
export async function getCashBookListWorkspace(
  params: CashBookWorkspaceParams,
): Promise<CashBookWorkspaceResult> {
  const supabase = getClient();
  const { data, error } = await (supabase.rpc as any)(
    "get_cash_book_list_workspace",
    {
      p_page: params.page,
      p_page_size: params.pageSize,
      p_search: params.search?.trim() || null,
      p_search_field: params.searchField ?? "all",
      p_types: params.types?.length ? params.types : null,
      p_payment_methods: params.paymentMethods?.length
        ? params.paymentMethods
        : null,
      p_categories: params.categories?.length ? params.categories : null,
      p_statuses: params.statuses?.length ? params.statuses : null,
      p_date_from: params.dateFrom?.slice(0, 10) || null,
      p_date_to_exclusive: params.dateToExclusive?.slice(0, 10) || null,
      p_amount_min: Number.isFinite(params.amountMin) ? params.amountMin : null,
      p_amount_max: Number.isFinite(params.amountMax) ? params.amountMax : null,
      p_branch_id: params.branchId ?? null,
    },
  );
  if (error) handleError(error, "getCashBookListWorkspace");

  const payload = (data ?? {}) as Record<string, any>;
  const rawSummary = (payload.summary ?? {}) as Record<string, unknown>;
  return {
    data: Array.isArray(payload.items) ? payload.items.map(mapCashEntry) : [],
    total: Number(payload.total ?? 0),
    summary: {
      totalReceipt: Number(rawSummary.totalReceipt ?? 0),
      totalPayment: Number(rawSummary.totalPayment ?? 0),
      receiptCount: Number(rawSummary.receiptCount ?? 0),
      paymentCount: Number(rawSummary.paymentCount ?? 0),
      openingBalance: Number(rawSummary.openingBalance ?? 0),
      closingBalance: Number(rawSummary.closingBalance ?? 0),
    },
    categoryOptions: Array.isArray(payload.categoryOptions)
      ? payload.categoryOptions.map((item: Record<string, unknown>) => ({
          value: String(item.value ?? ""),
          count: Number(item.count ?? 0),
        })).filter((item: { value: string }) => item.value.length > 0)
      : [],
  };
}

/** Tải đủ kết quả theo lô 200 dòng; không làm phình một phản hồi RPC. */
export async function getAllCashBookEntries(
  params: Omit<CashBookWorkspaceParams, "page" | "pageSize">,
): Promise<CashBookEntry[]> {
  const rows: CashBookEntry[] = [];
  let page = 0;
  let total = 0;
  do {
    const result = await getCashBookListWorkspace({ ...params, page, pageSize: 200 });
    if (result.data.length === 0 && rows.length < result.total) {
      throw new Error("Chưa tải đủ sổ quỹ. Vui lòng tải lại trước khi xuất báo cáo.");
    }
    rows.push(...result.data);
    total = result.total;
    page += 1;
  } while (rows.length < total);
  return rows;
}

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

  // Search — CEO 05/07: tìm theo cột chọn; "all"/lạ → OR mã+đối tượng như cũ.
  if (params.search) {
    const esc = params.search.replace(/[%_]/g, "\\$&");
    if (params.searchField === "code") query = query.ilike("code", `%${esc}%`);
    else if (params.searchField === "counterparty")
      query = query.ilike("counterparty", `%${esc}%`);
    else query = query.or(`code.ilike.%${esc}%,counterparty.ilike.%${esc}%`);
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
  query = applyCashDateRange(query, params.filters);
  // Filter: branch
  if (params.branchId) {
    query = query.eq("branch_id", params.branchId);
  }

  // CEO 11/06/2026 (P0-3 audit): filter theo status. UI sổ quỹ có state
  // `selectedStatuses` (mặc định ['completed','pending']) nhưng trước đây
  // KHÔNG truyền vào → phiếu CANCELLED vẫn hiện trong list + cộng vào tổng
  // → tồn quỹ lệch số dư bank thực. Giờ:
  // - Nếu UI truyền statuses (array) → filter .in
  // - Nếu không truyền → MẶC ĐỊNH loại cancelled (giữ tương thích caller cũ)
  const statuses = params.filters?.statuses as string[] | undefined;
  if (Array.isArray(statuses) && statuses.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).in("status", statuses);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).neq("status", "cancelled");
  }

  // Sort & paginate
  query = query
    .order("transaction_date", { ascending: false })
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
  statuses?: string[];
}): Promise<{
  totalReceipt: number;
  totalPayment: number;
  openingBalance: number;
}> {
  const supabase = getClient();
  const tenantId = await getCurrentTenantId();

  // Rebuild each page so PostgREST's response cap cannot truncate either balance.
  async function aggregate(beforePeriod: boolean) {
    let totalReceipt = 0;
    let totalPayment = 0;
    for (let offset = 0; ; offset += 1000) {
      let query = supabase.from("cash_transactions").select("id, type, amount")
        .eq("tenant_id", tenantId);
      if (params?.branchId) query = query.eq("branch_id", params.branchId);
      if (beforePeriod) query = query.lt("transaction_date", cashBookDate(params!.dateFrom!));
      else query = applyCashDateRange(query, params);
      // Existing callers also support legacy pending vouchers outside generated enums.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (params?.statuses?.length) query = (query as any).in("status", params.statuses);
      else query = query.neq("status", "cancelled");
      const { data, error } = await query.order("id").range(offset, offset + 999);
      if (error) handleError(error, "getCashBookSummaryAsync");
      for (const entry of data ?? []) {
        const amount = Number(entry.amount ?? 0);
        if (entry.type === "receipt") totalReceipt += amount;
        else if (entry.type === "payment") totalPayment += amount;
      }
      if (!data || data.length < 1000) break;
    }
    return { totalReceipt, totalPayment };
  }
  const period = await aggregate(false);
  const opening = params?.dateFrom ? await aggregate(true) : null;
  return { ...period, openingBalance: opening ? opening.totalReceipt - opening.totalPayment : 0 };
}

// --- Write Operations ---

/**
 * Tạo phiếu thu/chi mới.
 */
export interface CreateManualCashTransactionInput extends CashTimingInput {
  branchId: string;
  code?: string | null;
  type: "receipt" | "payment";
  category: string;
  amount: number;
  counterparty?: string | null;
  paymentMethod?: string | null;
  note?: string | null;
  transactionDate?: string | null;
}

export async function createManualCashTransactionAtomic(
  input: CreateManualCashTransactionInput,
): Promise<CashBookEntry> {
  const supabase = getClient();
  const { data, error } = input.occurredAt || input.transactionDate || input.performedBy || input.moneyAccountId
    ? { data: await recordTimedCash("manual", { ...input }, { ...input, timeReason: input.timeReason || input.note }), error: null }
    : await (supabase.rpc as any)(
    "create_manual_cash_transaction_atomic",
    {
      p_requested_code: input.code?.trim() || null,
      p_branch_id: input.branchId,
      p_type: input.type,
      p_category: input.category,
      p_amount: Number(input.amount),
      p_counterparty: input.counterparty || null,
      p_payment_method: input.paymentMethod ?? "cash",
      p_note: input.note || null,
      p_transaction_date: input.transactionDate ?? null,
    },
  );
  if (error) handleError(error, "createManualCashTransactionAtomic");
  if (!data) throw new Error("Máy chủ không trả về phiếu thu/chi hợp lệ.");
  return mapCashEntry(data);
}

export async function createCashTransaction(tx: Partial<CashTransaction>): Promise<CashBookEntry> {
  const ctx = await getCurrentContext();
  return createManualCashTransactionAtomic({
    branchId: tx.branchId ?? ctx.branchId,
    code: tx.code,
    type: tx.type ?? "receipt",
    category: tx.category ?? "other",
    amount: Number(tx.amount ?? 0),
    counterparty: tx.counterparty,
    paymentMethod: tx.paymentMethod,
    note: tx.note,
    occurredAt: tx.occurredAt,
    transactionDate: tx.date,
    timeReason: tx.timeReason,
    performedBy: tx.performedBy,
    moneyAccountId: tx.moneyAccountId,
  });
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
  const { error } = await (supabase.rpc as any)("cancel_cash_transaction", {
    p_cash_id: id,
    p_reason: reason,
  });
  if (error) handleError(error, "cancelCashTransaction");
}

// --- Mapper ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCashEntry(row: any): CashBookEntry {
  const profile = row.profiles as { full_name: string } | null;
  const branch = row.branches as { name: string } | null;
  return {
    id: row.id,
    code: row.code,
    date: row.transaction_date ?? row.created_at,
    type: row.type,
    typeName: row.type === "receipt" ? "Phiếu thu" : "Phiếu chi",
    category: row.category,
    counterparty: row.counterparty ?? "",
    amount: row.amount,
    note: row.note ?? undefined,
    createdBy: row.created_by,
    createdByName: profile?.full_name ?? "",
    performedBy: row.performed_by ?? undefined,
    performedByName: row.performed_by_name ?? undefined,
    paymentMethod: row.payment_method ?? undefined,
    branchId: row.branch_id ?? undefined,
    branchName: branch?.name ?? undefined,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
    referenceCode: row.reference_code ?? undefined,
    status: row.status ?? undefined,
    createdAt: row.created_at ?? undefined,
    occurredAt: row.occurred_at ?? null,
    timeSource: row.time_source ?? null,
    timeReason: row.time_reason ?? null,
    updatedAt: row.updated_at,
    moneyAccountId: row.money_account_id,
    moneyAccountName: row.money_account_name,
    moneyAccountCode: row.money_account_code,
    advanceOriginal: row.advance_original == null ? undefined : Number(row.advance_original),
    advanceApplied: row.advance_applied == null ? undefined : Number(row.advance_applied),
    advanceRemaining: row.advance_remaining == null ? undefined : Number(row.advance_remaining),
    advanceRefunded: row.advance_refunded == null ? undefined : Number(row.advance_refunded),
    refundSourceCode: row.refund_source_code,
    originalCode: row.original_code,
    replacementCode: row.replacement_code,
  };
}

export interface CashAmendmentInput {
  amount: number; paymentMethod: string; transactionDate: string;
  occurredAt: string | null; moneyAccountId: string | null; note: string;
}
export class CashAmendmentRejectedError extends Error {}
export async function amendPartyCash(row: CashBookEntry, requestId: string, payload: CashAmendmentInput, reason: string) {
  if (!row.updatedAt) throw new Error('Cần tải lại phiếu trước khi chỉnh sửa.');
  const {data,error} = await getClient().rpc('amend_party_cash' as never, {
    p_cash_id: row.id, p_expected_updated_at: row.updatedAt, p_request_id: requestId, p_payload: payload, p_reason: reason,
  } as never);
  const messages: Record<string,string> = {
    CASH_AMEND_ADVANCE_ALREADY_ALLOCATED: 'Tiền ứng đã dùng cho chứng từ khác. Không thể đổi số tiền trước khi đối soát và hoàn tác phân bổ; vẫn có thể sửa nội dung/ngày/tài khoản khi giữ nguyên số tiền.',
    CASH_AMEND_CHANGED_RELOAD: 'Phiếu vừa được người khác thay đổi. Đóng và tải lại trước khi sửa.',
    CASH_AMEND_USE_SOURCE_WORKFLOW: 'Số tiền phiếu này do nghiệp vụ gốc tạo. Hãy điều chỉnh tại chứng từ gốc; tại đây có thể sửa thông tin khi giữ nguyên số tiền.',
    CASH_AMEND_DOCUMENT_RECONCILIATION_REQUIRED: 'Chứng từ có trả hàng hoặc điều chỉnh công nợ khác. Cần đối soát các liên kết trước khi đổi số tiền; không tự ghi đè số dư.',
    MONEY_ACCOUNT_METHOD_OR_BRANCH_INVALID: 'Tài khoản không phù hợp phương thức hoặc chi nhánh của phiếu.',
  };
  if (error) {
    const known = Object.keys(messages).find(code => error.message.includes(code));
    if (known) throw new CashAmendmentRejectedError(messages[known]);
    if (error.code && /^[0-9A-Z]{5}$/.test(error.code) && !error.code.startsWith('PGRST')) throw new CashAmendmentRejectedError(error.message);
    handleError(error,'amendPartyCash');
  }
  return data as unknown as {cash_id: string; replacement: boolean; idempotent: boolean};
}

export interface PartyAdvanceLedgerRow {
  id: string; branchId: string; branchName: string; cashCode: string; date: string; note: string | null;
  originalAmount: number; remainingAmount: number; status: string;
  allocations: Array<{documentCode: string; amount: number; note: string; createdAt: string}>;
  appliedAmount?: number; refundedAmount?: number;
  refunds?: Array<{cashId: string; cashCode: string; amount: number; date: string; note: string; status: string; cancellationReason: string | null}>;
}

export interface CashAmendmentSnapshot {
  amount: number; note: string | null; date: string; occurredAt: string | null;
  paymentMethod: string; accountName: string | null;
}
export interface CashAmendmentHistoryRow {
  id: string; createdAt: string; createdByName: string | null; reason: string;
  originalCode: string; replacementCode: string | null;
  before: CashAmendmentSnapshot; after: CashAmendmentSnapshot;
}
export async function getCashAmendmentHistory(cashId: string): Promise<CashAmendmentHistoryRow[]> {
  const {data,error} = await getClient().rpc('get_cash_amendment_history' as never, {p_cash_id:cashId} as never);
  if (error) handleError(error,'getCashAmendmentHistory');
  if (!Array.isArray(data)) throw new Error('Không tải được lịch sử chỉnh sửa phiếu.');
  return data as unknown as CashAmendmentHistoryRow[];
}
export async function getPartyAdvanceLedger(mode: 'customer'|'supplier', partyId: string, branchId?: string | null) {
  const {data,error} = await getClient().rpc('get_party_advance_ledger' as never,{p_mode:mode,p_party_id:partyId,p_branch_id:branchId || null} as never);
  if (error) handleError(error,'getPartyAdvanceLedger');
  if (!Array.isArray(data)) throw new Error('Chưa tải được nguồn tiền ứng.');
  return data as unknown as PartyAdvanceLedgerRow[];
}
