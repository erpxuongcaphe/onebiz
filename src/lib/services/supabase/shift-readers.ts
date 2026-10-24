import type { ReconciledShiftRow, ShiftPreview, ReconciledShiftInvoiceDetail, ReconciledShiftCashDetail } from "./shifts";
import type { ShiftCashEntry } from "@/lib/shift-cash-preview";

type Row = Record<string, unknown>;
function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dữ liệu đối chiếu ca không hợp lệ.");
  return value as Row;
}
function number(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || value === ""
    || (typeof value === "string" && !value.trim()) || !Number.isFinite(Number(value))) {
    throw new Error("Dữ liệu tiền đối chiếu ca chưa đầy đủ.");
  }
  return Number(value);
}
function count(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Số chứng từ đối chiếu ca không hợp lệ.");
  return result;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Thiếu định danh đối chiếu ca.");
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Thiếu thời điểm đối chiếu ca.");
  return value;
}
function optionalText(value: unknown): string | null { return typeof value === "string" ? value : null; }

export function parseShiftPreview(value: unknown, shiftId: string, tenantId: string): ShiftPreview {
  const row = record(value);
  if (row.shift_id !== shiftId || row.tenant_id !== tenantId) throw new Error("Sai phạm vi đối chiếu ca.");
  identifier(row.branch_id);
  const startingCash = number(row.starting_cash);
  const cashIn = number(row.cash_in);
  const cashOut = number(row.cash_out);
  const expectedCash = number(row.expected_cash);
  const totalSales = number(row.total_sales);
  const totalOrders = count(row.total_orders);
  const cashEntryCount = count(row.cash_entries_count);
  if (startingCash < 0 || cashIn < 0 || cashOut < 0 || Math.abs(expectedCash - startingCash - cashIn + cashOut) > 0.01) {
    throw new Error("Tổng tiền đối chiếu ca không khớp. Tải lại để đối chiếu.");
  }
  const salesByMethod = Object.fromEntries(Object.entries(record(row.sales_by_method)).map(([key, amount]) => [key, number(amount)]));
  if (Math.abs(Object.values(salesByMethod).reduce((sum, amount) => sum + amount, 0) - totalSales) > 0.01
    || !Array.isArray(row.cash_entries) || row.cash_entries.length !== Math.min(100, cashEntryCount)) {
    throw new Error("Dữ liệu đối chiếu ca chưa đầy đủ. Tải lại để đối chiếu.");
  }
  const ids = new Set<string>();
  const cashEntries = row.cash_entries.map<ShiftCashEntry>(value => {
    const entry = record(value);
    const id = identifier(entry.id);
    if (ids.has(id) || (entry.type !== "receipt" && entry.type !== "payment")) throw new Error("Phiếu đối chiếu ca không hợp lệ.");
    ids.add(id);
    return { code: identifier(entry.code), type: entry.type, amount: number(entry.amount),
      category: optionalText(entry.category) ?? "", note: optionalText(entry.note), createdAt: date(entry.created_at) };
  });
  return { startingCash, cashIn, cashOut, expectedCash, totalSales, totalOrders, salesByMethod, cashEntries, cashEntryCount };
}

interface ShiftListScope {
  tenantId: string;
  branchId: string | null;
  from: string | null;
  toExclusive: string | null;
  type: "all" | "self" | "cross" | "big_variance";
}
function sameDate(value: unknown, expected: string | null): boolean {
  return expected === null ? value === null : typeof value === "string" && Date.parse(value) === Date.parse(expected);
}
function parseReconciledRow(value: unknown, scope: ShiftListScope): ReconciledShiftRow {
  const row = record(value);
  if (row.tenant_id !== scope.tenantId || (scope.branchId !== null && row.branch_id !== scope.branchId)) {
    throw new Error("Sai phạm vi danh sách đối chiếu ca.");
  }
  const closeKind = row.close_kind;
  if (closeKind !== null && closeKind !== "shift_change" && closeKind !== "end_of_day") {
    throw new Error("Loại chốt ca không hợp lệ.");
  }
  return {
    id: identifier(row.id), branchId: identifier(row.branch_id), branchName: optionalText(row.branch_name) ?? "—",
    cashierId: identifier(row.cashier_id), cashierName: optionalText(row.cashier_name) ?? "—",
    reconciledById: optionalText(row.reconciled_by), reconciledByName: optionalText(row.reconciled_by_name),
    openedAt: date(row.opened_at), closedAt: row.closed_at === null ? null : date(row.closed_at),
    reconciledAt: row.reconciled_at === null ? null : date(row.reconciled_at),
    wasAutoMarkedPending: row.auto_marked_pending_at !== null,
    startingCash: number(row.starting_cash), expectedCash: number(row.expected_cash), actualCash: number(row.actual_cash),
    variance: number(row.cash_difference), totalSales: number(row.total_sales), totalOrders: count(row.total_orders),
    reason: optionalText(row.reconcile_reason), note: optionalText(row.note), closeKind,
    expectedTransfer: row.expected_transfer === null ? null : number(row.expected_transfer),
    actualTransfer: row.actual_transfer === null ? null : number(row.actual_transfer),
    transferDifference: row.transfer_difference === null ? null : number(row.transfer_difference),
  };
}

export async function readReconciledShiftPages(
  scope: ShiftListScope,
  read: (args: { p_branch_id: string | null; p_from: string | null; p_to_exclusive: string | null;
    p_type: string; p_offset: number; p_limit: number }) => Promise<unknown>,
): Promise<ReconciledShiftRow[]> {
  const rows: ReconciledShiftRow[] = [];
  const ids = new Set<string>();
  const limit = 200;
  let total: number | null = null;
  let revision: string | null = null;
  for (;;) {
    const page = record(await read({ p_branch_id: scope.branchId, p_from: scope.from,
      p_to_exclusive: scope.toExclusive, p_type: scope.type, p_offset: rows.length, p_limit: limit }));
    const pageTotal = count(page.total_count);
    const pageRevision = identifier(page.revision);
    if (page.tenant_id !== scope.tenantId || page.branch_id !== scope.branchId || page.type !== scope.type
      || !sameDate(page.from, scope.from) || !sameDate(page.to_exclusive, scope.toExclusive)
      || page.offset !== rows.length || page.limit !== limit || !Array.isArray(page.rows)
      || page.rows.length > limit || rows.length + page.rows.length > pageTotal
      || (total !== null && total !== pageTotal) || (revision !== null && revision !== pageRevision)) {
      throw new Error("Danh sách đối chiếu ca đã thay đổi hoặc chưa đầy đủ. Tải lại báo cáo.");
    }
    total = pageTotal;
    revision = pageRevision;
    for (const value of page.rows) {
      const row = parseReconciledRow(value, scope);
      if (ids.has(row.id)) throw new Error("Danh sách đối chiếu ca bị trùng. Tải lại báo cáo.");
      ids.add(row.id);
      rows.push(row);
    }
    if (rows.length === total) return rows;
    if (page.rows.length === 0) throw new Error("Danh sách đối chiếu ca chưa đầy đủ. Tải lại báo cáo.");
  }
}

const SHIFT_FINANCIAL_FIELDS = ["starting_cash", "expected_cash", "actual_cash", "cash_difference",
  "total_sales", "total_orders", "sales_by_method", "expected_transfer", "actual_transfer", "transfer_difference"];

export async function readShiftDocumentPages(
  shiftId: string, tenantId: string,
  read: (args: { p_shift_id: string; p_offset: number; p_limit: number }) => Promise<unknown>,
): Promise<{ invoices: ReconciledShiftInvoiceDetail[]; transactions: ReconciledShiftCashDetail[] }> {
  const invoices: ReconciledShiftInvoiceDetail[] = [];
  const transactions: ReconciledShiftCashDetail[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let revision: string | null = null;
  let branch: string | null = null;
  for (;;) {
    const page = record(await read({ p_shift_id: shiftId, p_offset: seen.size, p_limit: 200 }));
    const nextTotal = count(page.total_count);
    const nextRevision = identifier(page.revision);
    const nextBranch = identifier(page.branch_id);
    if (page.shift_id !== shiftId || page.tenant_id !== tenantId || page.offset !== seen.size || page.limit !== 200
      || !Array.isArray(page.rows) || page.rows.length > 200 || seen.size + page.rows.length > nextTotal
      || (total !== null && total !== nextTotal) || (revision !== null && revision !== nextRevision)
      || (branch !== null && branch !== nextBranch)) {
      throw new Error("Dữ liệu đối chiếu ca đã thay đổi hoặc chưa đầy đủ. Tải lại để đối chiếu.");
    }
    total = nextTotal; revision = nextRevision; branch = nextBranch;
    for (const value of page.rows) {
      const row = record(value);
      const id = identifier(row.id);
      const kind = row.document_kind;
      const key = `${kind}:${id}`;
      if (row.shift_id !== shiftId || row.tenant_id !== tenantId || row.branch_id !== branch
        || (kind !== "invoice" && kind !== "cash") || seen.has(key)) {
        throw new Error("Chứng từ đối chiếu ca sai phạm vi hoặc bị trùng.");
      }
      const code = identifier(row.code);
      const method = optionalText(row.payment_method) || "unknown";
      if (kind === "invoice") {
        if (!["draft", "confirmed", "completed", "cancelled"].includes(String(row.status))) throw new Error("Trạng thái hóa đơn không hợp lệ.");
        invoices.push({ id, code, customerName: optionalText(row.customer_name) || "Khách lẻ",
          status: row.status as ReconciledShiftInvoiceDetail["status"], total: number(row.total), paid: number(row.paid),
          paymentMethod: method, source: optionalText(row.source) || "unknown", createdAt: date(row.created_at),
          voidReason: optionalText(row.void_reason) });
      } else {
        if ((row.type !== "receipt" && row.type !== "payment") || !["draft", "completed", "cancelled"].includes(String(row.status))) {
          throw new Error("Phiếu thu/chi đối chiếu ca không hợp lệ.");
        }
        transactions.push({ id, code, type: row.type, category: optionalText(row.category) || "Chưa phân loại",
          amount: number(row.amount), paymentMethod: method, status: row.status as ReconciledShiftCashDetail["status"],
          referenceType: optionalText(row.reference_type), referenceId: optionalText(row.reference_id), note: optionalText(row.note),
          transactionDate: date(row.transaction_date) });
      }
      seen.add(key);
    }
    if (seen.size === total) return { invoices, transactions };
    if (page.rows.length === 0) throw new Error("Dữ liệu đối chiếu ca chưa đầy đủ. Tải lại để đối chiếu.");
  }
}

export async function readShiftRecordPages(
  scope: { kind: "pending" | "history"; tenantId: string; branchId: string | null; maxRows?: number },
  read: (args: { p_kind: string; p_branch_id: string | null; p_offset: number; p_limit: number }) => Promise<unknown>,
): Promise<{ rows: Row[]; asOf: string }> {
  const rows: Row[] = [];
  const ids = new Set<string>();
  let total: number | null = null;
  let revision: string | null = null;
  let actor: string | null = null;
  let mode: string | null = null;
  let asOf = "";
  for (;;) {
    const limit = Math.min(200, scope.maxRows === undefined ? 200 : scope.maxRows - rows.length);
    const page = record(await read({ p_kind: scope.kind, p_branch_id: scope.branchId, p_offset: rows.length, p_limit: limit }));
    const pageTotal = count(page.total_count);
    const pageRevision = identifier(page.revision);
    const pageActor = identifier(page.actor_id);
    const pageAsOf = date(page.as_of);
    if (page.tenant_id !== scope.tenantId || page.branch_id !== scope.branchId || page.kind !== scope.kind
      || (page.mode !== "reconciliation" && page.mode !== "blind")
      || (scope.kind === "pending" && page.mode !== "reconciliation")
      || page.offset !== rows.length || page.limit !== limit || !Array.isArray(page.rows)
      || page.rows.length > limit || rows.length + page.rows.length > pageTotal
      || (total !== null && pageTotal !== total) || (revision !== null && revision !== pageRevision)
      || (actor !== null && actor !== pageActor) || (mode !== null && mode !== page.mode)) {
      throw new Error("Danh sách ca đã thay đổi hoặc chưa đầy đủ. Tải lại để kiểm tra.");
    }
    total = pageTotal; revision = pageRevision; actor = pageActor; mode = page.mode;
    asOf ||= pageAsOf;
    for (const value of page.rows) {
      const row = record(value);
      const id = identifier(row.id);
      identifier(row.branch_id); identifier(row.cashier_id); date(row.opened_at);
      if (row.closed_at !== null) date(row.closed_at);
      if (row.tenant_id !== scope.tenantId || (scope.branchId !== null && row.branch_id !== scope.branchId)
        || !["open", "closed", "pending_reconcile"].includes(String(row.status)) || ids.has(id)
        || (scope.kind === "pending" && row.status !== "pending_reconcile")
        || (mode === "blind" && (row.cashier_id !== actor || SHIFT_FINANCIAL_FIELDS.some(key => key in row)))) {
        throw new Error("Sai phạm vi hoặc dữ liệu danh sách ca không hợp lệ.");
      }
      if (mode === "reconciliation") {
        for (const field of SHIFT_FINANCIAL_FIELDS.filter(key => key !== "sales_by_method")) {
          if (field in row && row[field] !== null) number(row[field]);
        }
      }
      if (scope.kind === "pending") {
        number(row.starting_cash);
        if (row.auto_marked_pending_at !== null) date(row.auto_marked_pending_at);
      }
      ids.add(id); rows.push(row);
    }
    if (rows.length === Math.min(total, scope.maxRows ?? total)) return { rows, asOf };
    if (page.rows.length === 0) throw new Error("Danh sách ca chưa đầy đủ. Tải lại để kiểm tra.");
  }
}
