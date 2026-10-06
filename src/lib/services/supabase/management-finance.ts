import { getClient, handleError } from './base';

export type FinanceKind = 'income' | 'expense' | 'non_pnl';
export interface FinanceCategory {
  id: string; code: string; name: string; kind: FinanceKind;
  parent_id: string | null; is_group: boolean;
}
export interface FinanceAllocation {
  branchId: string; recognitionDate: string; amount: number;
}
export interface FinancePayment {
  branchId: string; performedBy: string; amount: number;
  paymentMethod: 'cash' | 'bank_transfer' | 'card' | 'other';
  transactionDate: string; occurredAt: string; timeReason?: string;
  direction?: 'receipt' | 'payment'; note?: string;
}
export interface FinanceDocumentInput {
  categoryId: string; businessDate: string; amount: number;
  counterparty: string; note?: string; allocations: FinanceAllocation[];
  payment?: FinancePayment;
}
export interface FinanceEvent {
  id: string; code: string; kind: FinanceKind; category_code: string;
  category_name: string; business_date: string; amount: number;
  report_amount: number; settled_amount: number; counterparty: string;
  status: 'posted' | 'cancelled'; note: string | null; created_by_name: string;
  allocations: Array<{branch_id: string; branch_name: string; recognition_date: string; amount: number}>;
  settlements: Array<{id: string; code: string; amount: number; status: string; transaction_date: string;
    occurred_at: string; performed_by_name: string; branch_id: string; payment_method: string}>;
}
export interface FinanceFilters {
  from: string; to: string; branchId?: string; kind?: FinanceKind; categoryId?: string; search?: string;
}
export interface FinanceWorkspace {
  items: FinanceEvent[]; total: number;
  summary: {income: number; expense: number; non_pnl: number}; basis: 'recognition_date'; as_of: string;
}

async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const {data, error} = await getClient().rpc(name as never, params as never);
  if (error) handleError(error, name);
  if (data == null) throw new Error('Máy chủ chưa trả về dữ liệu thu nhập/chi phí');
  return data as T;
}

export function getFinanceCategories(): Promise<FinanceCategory[]> {
  return rpc('get_management_finance_categories');
}

export function saveFinanceCategory(input: {code: string; name: string; kind: FinanceKind; parentId: string}): Promise<FinanceCategory> {
  return rpc('save_management_finance_category', {
    p_code: input.code.trim().toUpperCase(), p_name: input.name.trim(), p_kind: input.kind, p_parent_id: input.parentId,
  });
}

// The caller retains this request ID and payload after a timeout; never generate a retry ID here.
export function saveFinanceDocument(requestId: string, payload: FinanceDocumentInput): Promise<{event: FinanceEvent; cash: {id: string} | null}> {
  return rpc('save_management_finance_document', {p_request_id: requestId, p_payload: payload});
}

export function settleFinanceDocument(eventId: string, requestId: string, payload: FinancePayment): Promise<{id: string; event_id: string}> {
  return rpc('settle_management_finance_event', {p_event_id: eventId, p_request_id: requestId, p_payload: payload});
}

export async function cancelFinanceDocument(eventId: string, reason: string): Promise<void> {
  const {error} = await getClient().rpc('cancel_management_finance_event' as never, {p_event_id: eventId, p_reason: reason.trim()} as never);
  if (error) handleError(error, 'cancelFinanceDocument');
}

export async function getFinanceWorkspace(filters: FinanceFilters, page = 0, pageSize = 50): Promise<FinanceWorkspace> {
  const result = await rpc<FinanceWorkspace>('get_management_finance_workspace', {
    p_date_from: filters.from, p_date_to: filters.to, p_branch_id: filters.branchId || null,
    p_kind: filters.kind || null, p_category_id: filters.categoryId || null, p_search: filters.search?.trim() || null,
    p_page: page, p_page_size: pageSize,
  });
  if (!Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || !result.summary) {
    throw new Error('Dữ liệu thu nhập/chi phí không hợp lệ');
  }
  return result;
}

export async function getAllFinanceRows(filters: FinanceFilters): Promise<FinanceEvent[]> {
  const rows: FinanceEvent[] = [];
  const ids = new Set<string>();
  let expected: number | undefined;
  for (let page = 0; ; page++) {
    const result = await getFinanceWorkspace(filters, page, 200);
    expected ??= result.total;
    if (result.total !== expected) throw new Error('Dữ liệu đã thay đổi, vui lòng xuất lại báo cáo');
    if (!result.items.length && rows.length < expected) throw new Error('Chưa tải đủ dữ liệu để xuất báo cáo');
    for (const row of result.items) {
      if (ids.has(row.id)) throw new Error('Dữ liệu đã thay đổi, vui lòng xuất lại báo cáo');
      ids.add(row.id); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (rows.length > expected) throw new Error('Số dòng báo cáo không khớp');
  }
}
