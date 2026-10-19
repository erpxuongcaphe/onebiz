import type { CashBookEntry } from "@/lib/types";
import type { FinanceCashLink } from "@/lib/services/supabase/management-finance";
import type { CashAccountReport } from "@/lib/services/supabase/cash-account-report";
import { cashPaymentMethodLabel } from "@/lib/utils/cash-book-labels";
import { CASH_FLOW_LABELS, reconcileCashFlow } from "@/lib/utils/finance-report-reconciliation";
import { financeMoneyCents } from "./finance-report-input";
import { matchesMetricFilters, type MetricFilter } from "./metric-filter";
import { sortReportRows } from "./table-sort";

export const CASH_REVIEW_LABELS = { all: "Tất cả kiểm tra", unassigned: "Chưa gắn tài khoản", unclassified: "Chưa phân loại hoạt động", untimed: "Chưa rõ giờ thu/chi", unperformed: "Chưa rõ người thu/chi" };
export type CashReview = keyof typeof CASH_REVIEW_LABELS;
export const CASH_FIELDS = [
  { key: "code", label: "Mã phiếu" }, { key: "date", label: "Ngày hạch toán" }, { key: "occurredAt", label: "Thực thu/chi lúc" },
  { key: "typeLabel", label: "Loại phiếu" }, { key: "branchName", label: "Chi nhánh" },
  { key: "accountCode", label: "Mã tài khoản" }, { key: "accountName", label: "Quỹ / tài khoản" }, { key: "methodLabel", label: "Phương thức" },
  { key: "counterparty", label: "Đối tượng" }, { key: "category", label: "Khoản mục" }, { key: "activityLabel", label: "Hoạt động" },
  { key: "recognitionLabel", label: "Nhóm ghi nhận" }, { key: "eventCode", label: "Khoản ghi nhận" }, { key: "referenceCode", label: "Chứng từ gốc" },
  { key: "note", label: "Nội dung" }, { key: "createdByName", label: "Người tạo" }, { key: "performedByName", label: "Người thu/chi" },
  { key: "receipt", label: "Thu" }, { key: "payment", label: "Chi" },
] as const;
export const CASH_GROUPS = [{ label: "Chứng từ", span: 5 }, { label: "Nguồn tiền", span: 3 }, { label: "Nghiệp vụ", span: 7 }, { label: "Thực hiện", span: 2 }, { label: "Dòng tiền", span: 2 }];
export const CASH_METRICS = [{ key: "amount", label: "Giá trị phiếu" }, { key: "receipt", label: "Thu" }, { key: "payment", label: "Chi" }];
const KIND_LABELS = { income: "Thu nhập", expense: "Chi phí", non_pnl: "Không vào KQKD" };
export function cashCapitalRows(entries: CashBookEntry[], links: FinanceCashLink[]) {
  const sources = new Map(links.map(link => [link.cash_id, link]));
  return reconcileCashFlow(entries, links).detail.map(row => ({ ...row,
    typeLabel: row.type === "receipt" ? "Thu" : "Chi",
    accountCode: row.moneyAccountCode ?? "", accountName: row.moneyAccountName ?? (row.moneyAccountId ? "Chưa tải được tên tài khoản" : "Chưa gắn tài khoản"),
    methodLabel: cashPaymentMethodLabel(row.paymentMethod), activityLabel: CASH_FLOW_LABELS[row.activity],
    recognitionLabel: sources.get(row.id)?.event_status === "posted" ? KIND_LABELS[sources.get(row.id)!.kind] : "Chưa liên kết",
    receipt: row.type === "receipt" ? row.amount : 0, payment: row.type === "payment" ? row.amount : 0,
  }));
}
export type CashCapitalRow = ReturnType<typeof cashCapitalRows>[number];
export interface CashCapitalFilter { search: string; account: string; method: string; category: string; activity: string; review: CashReview; metrics: MetricFilter[]; }
export const EMPTY_CASH_FILTER: CashCapitalFilter = { search: "", account: "", method: "", category: "", activity: "", review: "all", metrics: [] };
export function cashCapitalSortValue(row: CashCapitalRow, key: string) {
  const value = row[key as keyof CashCapitalRow];
  return key === "occurredAt" ? (row.occurredAt ? Date.parse(row.occurredAt) : null) : value === "" || value === undefined ? null : value;
}
export function cashCapitalView(rows: CashCapitalRow[], filter: CashCapitalFilter, sort: { id: string; direction: "asc" | "desc" }) {
  const search = filter.search.trim().toLocaleLowerCase("vi");
  const result = rows.filter(row => {
    const review = filter.review;
    return (!search || CASH_FIELDS.some(field => String(row[field.key] ?? "").toLocaleLowerCase("vi").includes(search))) &&
      (!filter.account || (filter.account === "unassigned" ? !row.moneyAccountId : row.moneyAccountId === filter.account)) &&
      (!filter.method || row.paymentMethod === filter.method) && (!filter.category || row.category === filter.category) && (!filter.activity || row.activity === filter.activity) &&
      (review === "all" || (review === "unassigned" && !row.moneyAccountId) || (review === "unclassified" && row.activity === "unclassified") || (review === "untimed" && !row.occurredAt) || (review === "unperformed" && !row.performedByName)) && matchesMetricFilters(row, filter.metrics);
  });
  return sortReportRows(result, row => cashCapitalSortValue(row, sort.id), sort.direction);
}
export function cashCapitalSummary(rows: CashCapitalRow[]) {
  const receipt = rows.reduce((sum, row) => sum + financeMoneyCents(row.receipt), 0) / 100;
  const payment = rows.reduce((sum, row) => sum + financeMoneyCents(row.payment), 0) / 100;
  return { count: rows.length, receipt, payment, net: (financeMoneyCents(receipt) - financeMoneyCents(payment)) / 100 };
}
export function cashCategoryRows(rows: CashCapitalRow[]) {
  const groups = new Map<string, CashCapitalRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.category, row.categoryCode, row.activity, row.recognitionLabel]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  return [...groups].map(([id, entries]) => ({ id, category: entries[0].category, categoryCode: entries[0].categoryCode, activityLabel: entries[0].activityLabel, recognitionLabel: entries[0].recognitionLabel, ...cashCapitalSummary(entries) }));
}
export const ACCOUNT_KIND_LABELS = { cash: "Tiền mặt", bank: "Ngân hàng", ewallet: "Ví điện tử", clearing: "Trung gian" };
export const ACCOUNT_FIELDS = [
  { key: "branchName", label: "Chi nhánh" }, { key: "code", label: "Mã tài khoản" }, { key: "name", label: "Quỹ / tài khoản" }, { key: "kindLabel", label: "Loại" },
  { key: "bank_name", label: "Ngân hàng" }, { key: "account_number", label: "Số tài khoản" }, { key: "opening_date", label: "Ngày số dư gốc" },
  { key: "opening_balance", label: "Số dư đầu kỳ" }, { key: "receipts", label: "Thu trong kỳ" }, { key: "payments", label: "Chi trong kỳ" },
  { key: "net", label: "Ròng trong kỳ" }, { key: "closing_balance", label: "Số dư cuối kỳ" }, { key: "movementDifference", label: "Chênh phát sinh" }, { key: "balanceDifference", label: "Chênh cân đối" },
] as const;
export const ACCOUNT_METRICS = ACCOUNT_FIELDS.slice(7);
function signedCents(value: number) { return Math.sign(value) * financeMoneyCents(Math.abs(value)); }
export function cashAccountRows(report: CashAccountReport, entries: CashBookEntry[]) {
  const ids = new Set<string>();
  const amounts = new Map<string, { receipt: number; payment: number }>();
  for (const entry of entries) {
    if (!entry.moneyAccountId || (entry.status && entry.status !== "completed")) continue;
    const amount = amounts.get(entry.moneyAccountId) ?? { receipt: 0, payment: 0 };
    amount[entry.type] += financeMoneyCents(entry.amount); amounts.set(entry.moneyAccountId, amount);
  }
  return report.accounts.map(account => {
    if (!account.id || ids.has(account.id)) throw new Error("Nguồn tài khoản tiền bị trùng");
    ids.add(account.id);
    const { receipt, payment } = amounts.get(account.id) ?? { receipt: 0, payment: 0 };
    const receipts = Number(account.receipts ?? 0), payments = Number(account.payments ?? 0);
    const movementDifference = (Math.abs(financeMoneyCents(receipts) - receipt) + Math.abs(financeMoneyCents(payments) - payment)) / 100;
    const balanceDifference = account.opening_balance == null || account.closing_balance == null ? null :
      (signedCents(account.closing_balance) - signedCents(account.opening_balance) - financeMoneyCents(receipts) + financeMoneyCents(payments)) / 100;
    return { ...account, kindLabel: ACCOUNT_KIND_LABELS[account.kind], opening_balance: account.opening_balance ?? null,
      closing_balance: account.closing_balance ?? null, receipts, payments, net: (financeMoneyCents(receipts) - financeMoneyCents(payments)) / 100, movementDifference, balanceDifference };
  });
}
export type CashAccountRow = ReturnType<typeof cashAccountRows>[number];
export function cashAccountSummary(rows: CashAccountRow[], report: CashAccountReport, entries: CashBookEntry[]) {
  const known = new Set(rows.map(row => row.id));
  const missingAccount = entries.filter(entry => !entry.moneyAccountId || !known.has(entry.moneyAccountId));
  const sourceCountDifference = report.unassignedCount - entries.filter(entry => !entry.moneyAccountId).length;
  const mismatches = rows.filter(row => row.movementDifference >= 0.01 || (row.balanceDifference !== null && Math.abs(row.balanceDifference) >= 0.01)).length;
  const incomplete = rows.length === 0 || report.failures.length > 0 || missingAccount.length > 0 || sourceCountDifference !== 0 || rows.some(row => row.opening_balance === null || row.closing_balance === null) || mismatches > 0;
  const total = (key: "opening_balance" | "closing_balance") => incomplete ? null : rows.reduce((sum, row) => sum + signedCents(row[key]!), 0) / 100;
  return { opening: total("opening_balance"), closing: total("closing_balance"), missingAccount: missingAccount.length, missingOpening: rows.filter(row => row.opening_balance === null).length,
    mismatches, sourceCountDifference, incomplete };
}
