import { createClient } from "@/lib/supabase/client";
import { formatCashBookDate, formatCashTime } from "@/lib/cash-time";
import { cashCategoryLabel, cashPaymentMethodLabel } from "@/lib/utils/cash-book-labels";
import { exportToExcel } from "@/lib/utils/export";

export const CASH_JOURNAL_COMPANY = "finance.view_cash_journal_company";
export const CASH_JOURNAL_SELF_SPEND = "finance.view_cash_journal_self_spend";
export const CASH_JOURNAL_EXPORT = "finance.export_cash_journal";

export const JOURNAL_COLUMNS = [
  { key: "stt", header: "STT", width: 7 },
  { key: "day", header: "Ngày hạch toán", width: 16 },
  { key: "code", header: "Mã phiếu", width: 18 },
  { key: "note", header: "Diễn giải", width: 45 },
  { key: "party", header: "Bên giao/nhận", width: 25 },
  { key: "receipt", header: "Thu", width: 17 },
  { key: "payment", header: "Chi", width: 17 },
  { key: "net", header: "Tổng", width: 17 },
  { key: "source", header: "Nguồn tiền", width: 30 },
  { key: "category", header: "Khoản mục", width: 26 },
  { key: "branch", header: "Chi nhánh", width: 24 },
  { key: "creator", header: "Người lập", width: 24 },
  { key: "performer", header: "Người thực thu/chi", width: 24 },
  { key: "document", header: "Chứng từ gốc", width: 20 },
] as const;

export type JournalSort = Exclude<typeof JOURNAL_COLUMNS[number]["key"], "stt">;
export type JournalKind = "receipt" | "payment" | "";
export type JournalFilters = {
  from: string; to: string; branch: string; kind: JournalKind; account: string;
  search: string; category: string; sort: JournalSort; desc: boolean; page: number;
};
export type JournalOption = { id: string; label: string };
export type JournalRow = {
  id: string; stt: number; day: string; occurred_at: string | null; code: string; note: string | null;
  party: string | null; receipt: number; payment: number; net: number; account_label: string;
  payment_method: string | null; category: string; category_code: string | null; branch: string;
  creator: string | null; performer: string | null; document: string | null; payer: string | null;
};
export type JournalResult = {
  scope: "company" | "self_spend";
  totals: { count: number; receipt: number; payment: number; net: number };
  pageSize: number; tooMany: boolean; rows: JournalRow[];
  branches: JournalOption[]; accounts: JournalOption[]; categories: JournalOption[];
};

export async function getCashJournal(filters: JournalFilters, signal: AbortSignal, full = false): Promise<JournalResult> {
  const args = {
    p_from: filters.from, p_to: filters.to, p_branch: filters.branch || null,
    p_kind: filters.kind || null, p_account: filters.account || null, p_search: filters.search.trim() || null,
    p_category: filters.category || null, p_sort: filters.sort, p_desc: filters.desc,
    p_page: full ? 1 : filters.page, p_export: full,
  };
  const client = createClient() as unknown as {
    rpc(name: "cash_journal_list_v1", params: typeof args): {
      abortSignal(signal: AbortSignal): PromiseLike<{ data: JournalResult | null; error: { code: string } | null }>;
    };
  };
  const { data, error } = await client.rpc("cash_journal_list_v1", args).abortSignal(signal);
  if (error?.code === "42501") throw new Error("Bạn không có quyền xem hoặc xuất dữ liệu trong phạm vi này.");
  if (error?.code === "22023") throw new Error("Bộ lọc không hợp lệ. Vui lòng kiểm tra lại kỳ báo cáo.");
  if (error || !data) throw new Error("Không tải được Nhật ký thu chi. Vui lòng thử lại.");
  return data;
}

export function journalCells(row: JournalRow) {
  return {
    stt: row.stt, day: formatCashBookDate(row.day), code: row.code,
    note: row.note ?? "", party: row.party ?? "", receipt: row.receipt,
    payment: row.payment, net: row.net,
    source: row.account_label || (row.payment_method ? `${cashPaymentMethodLabel(row.payment_method)} · Chưa gắn tài khoản` : "Chưa gắn tài khoản"),
    category: cashCategoryLabel(row.category), branch: row.branch, creator: row.creator ?? "",
    performer: row.performer ?? "", document: row.document ?? "",
  };
}

export async function exportCashJournal(
  result: JournalResult,
  filters: JournalFilters,
  options: { shouldSave?: () => boolean; onPrepared?: (blob: Blob, name: string) => void } = {},
) {
  if (result.scope !== "company") throw new Error("Bạn không có quyền xuất Nhật ký thu chi.");
  if (result.tooMany) throw new Error("Vượt 5.000 phiếu. Hãy thu hẹp bộ lọc rồi xuất lại.");
  if (result.rows.length !== result.totals.count || result.rows.length === 0) {
    throw new Error("Không có dữ liệu đầy đủ để xuất.");
  }
  const columns = [...JOURNAL_COLUMNS,
    { key: "categoryCode", header: "Mã thu chi", width: 20 },
    { key: "occurredAt", header: "Thời điểm thực thu/chi", width: 26 },
    { key: "payer", header: "Đơn vị thực chi", width: 24 },
  ];
  await exportToExcel(
    result.rows.map(row => ({ ...journalCells(row), categoryCode: row.category_code, payer: row.payer,
      occurredAt: row.occurred_at ? formatCashTime(row.occurred_at) : "" })),
    columns, `nhat-ky-thu-chi_${filters.from}_${filters.to}`,
    { ...options, sheetName: "Nhật ký thu chi", financialTable: true, additionalSheets: [
      { name: "Tổng theo bộ lọc", data: [{ ...result.totals, unit: "đồng",
        from: formatCashBookDate(filters.from), to: formatCashBookDate(filters.to) }],
        columns: [
          { header: "Từ ngày", key: "from" }, { header: "Đến ngày", key: "to" },
          { header: "Số phiếu", key: "count" }, { header: "Thu", key: "receipt" },
          { header: "Chi", key: "payment" }, { header: "Tổng", key: "net" }, { header: "ĐVT", key: "unit" },
        ] },
    ] },
  );
}
