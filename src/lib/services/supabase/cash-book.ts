/**
 * Supabase service: Cash Transactions (Sổ quỹ)
 */

import type { CashBookEntry, CashTransaction, QueryParams, QueryResult } from "@/lib/types";
import { applyCreatedAtRangeFilter, toCreatedAtStartIso } from "@/lib/utils/list-date-preset-range";
import {
  getClient,
  getCurrentContext,
  getCurrentTenantId,
  getPaginationRange,
  handleError,
} from "./base";

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
  query = applyCreatedAtRangeFilter(query, params.filters);
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

  let query = supabase
    .from("cash_transactions")
    .select("type, amount")
    .eq("tenant_id", tenantId);

  if (params?.branchId) query = query.eq("branch_id", params.branchId);
  query = applyCreatedAtRangeFilter(query, params);
  // CEO 11/06/2026 (P0-3 audit): filter status — KHÔNG cộng phiếu cancelled.
  if (params?.statuses && params.statuses.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).in("status", params.statuses);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = (query as any).neq("status", "cancelled");
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
      .lt("created_at", toCreatedAtStartIso(params.dateFrom) ?? params.dateFrom);
    if (params?.branchId) openingQ = openingQ.eq("branch_id", params.branchId);
    // P0-3: cũng phải loại cancelled cho opening balance
    if (params?.statuses && params.statuses.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openingQ = (openingQ as any).in("status", params.statuses);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      openingQ = (openingQ as any).neq("status", "cancelled");
    }
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
export interface CreateManualCashTransactionInput {
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
  const { data, error } = await (supabase.rpc as any)(
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
    branchId: ctx.branchId,
    code: tx.code,
    type: tx.type ?? "receipt",
    category: tx.category ?? "other",
    amount: Number(tx.amount ?? 0),
    counterparty: tx.counterparty,
    paymentMethod: tx.paymentMethod,
    note: tx.note,
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
    paymentMethod: row.payment_method ?? undefined,
    branchId: row.branch_id ?? undefined,
    branchName: branch?.name ?? undefined,
    referenceType: row.reference_type ?? undefined,
    referenceId: row.reference_id ?? undefined,
    referenceCode: row.reference_code ?? undefined,
    status: row.status ?? undefined,
    createdAt: row.created_at ?? undefined,
  };
}
