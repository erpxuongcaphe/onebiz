import type {CashBookEntry} from '@/lib/types';
import type {CashFlowDetailedRow} from '@/lib/services/supabase/analytics';
import type {CashFlowActivity, FinanceCashLink, FinanceEvent, FinanceKind} from '@/lib/services/supabase/management-finance';
import {cashCategoryLabel} from '@/lib/utils/cash-book-labels';

export const CASH_FLOW_LABELS: Record<CashFlowActivity, string> = {
  operating: 'Hoạt động kinh doanh', investing: 'Hoạt động đầu tư',
  financing: 'Hoạt động tài trợ', unclassified: 'Chưa phân loại',
};

const OPERATING_CATEGORIES = new Set([
  'Bán hàng', 'Nhập hàng', 'Mua hàng nội bộ', 'Hoàn tiền hủy đơn', 'Hoàn trả', 'Trả hàng', 'Tra hang',
  'Trả nhà cung cấp', 'supplier_payment', 'customer_payment', 'thu_tien_khach', 'chi_tra_ncc',
  'chi_phi_van_chuyen', 'salary', 'rent', 'utility',
]);

export function cashFlowSource(entry: CashBookEntry, links: ReadonlyMap<string, FinanceCashLink>) {
  const link = links.get(entry.id);
  const activity: CashFlowActivity = link
    ? link.event_status === 'posted' ? link.cash_flow_activity : 'unclassified'
    : OPERATING_CATEGORIES.has(entry.category ?? '') ? 'operating' : 'unclassified';
  return {activity, category: link?.category_name ?? (entry.category ? cashCategoryLabel(entry.category) : 'Chưa có danh mục'),
    categoryCode: link?.category_code ?? '', eventCode: link?.event_code ?? '', eventId: link?.event_id,
    basis: link ? 'Khoản ghi nhận liên kết' : 'Danh mục phiếu thu/chi'};
}

export function reconcileCashFlow(entries: CashBookEntry[], links: FinanceCashLink[]) {
  const sources = new Map(links.map(link => [link.cash_id, link]));
  if (sources.size !== links.length) throw new Error('Nguồn dòng tiền bị trùng');
  const ids = new Set<string>();
  const totals = Object.keys(CASH_FLOW_LABELS).map(activity => ({activity: activity as CashFlowActivity, receipt: 0, payment: 0, count: 0, net: 0}));
  const detail = entries.map(entry => {
    if (!entry.id || ids.has(entry.id)) throw new Error('Phiếu thu/chi bị trùng');
    if (!Number.isFinite(entry.amount) || entry.amount < 0) throw new Error('Số tiền phiếu thu/chi không hợp lệ');
    ids.add(entry.id);
    const source = cashFlowSource(entry, sources);
    const total = totals.find(row => row.activity === source.activity)!;
    total[entry.type] += entry.amount; total.count++;
    total.net = total.receipt - total.payment;
    return {...entry, ...source};
  });
  return {totals, detail, receipt: totals.reduce((sum,row) => sum+row.receipt,0), payment: totals.reduce((sum,row) => sum+row.payment,0)};
}

export function cashFlowMonths(entries: CashBookEntry[], from: string, to: string): CashFlowDetailedRow[] {
  const start = new Date(`${from.slice(0,7)}-01T00:00:00Z`);
  const end = new Date(`${to.slice(0,7)}-01T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw new Error('Khoảng ngày dòng tiền không hợp lệ');
  const buckets = new Map<string, CashFlowDetailedRow>();
  while (start <= end) {
    const key = start.toISOString().slice(0,7);
    buckets.set(key,{month:`T${start.getUTCMonth()+1}/${start.getUTCFullYear()}`,receipts:[],payments:[],totalReceipt:0,totalPayment:0,net:0,cumulativeBalance:0});
    start.setUTCMonth(start.getUTCMonth()+1);
  }
  for (const entry of entries) {
    const date = entry.date.slice(0,10);
    if (date < from || date > to) throw new Error('Phiếu thu/chi ngoài kỳ báo cáo');
    const bucket = buckets.get(date.slice(0,7));
    if (!bucket) throw new Error('Ngày phiếu thu/chi không hợp lệ');
    const list = entry.type === 'receipt' ? bucket.receipts : bucket.payments;
    const item = list.find(row => row.category === entry.category);
    if (item) item.amount += entry.amount; else list.push({category:entry.category,amount:entry.amount});
    if (entry.type === 'receipt') bucket.totalReceipt += entry.amount; else bucket.totalPayment += entry.amount;
  }
  let cumulative = 0;
  return [...buckets.values()].map(row => {
    row.net = row.totalReceipt-row.totalPayment;
    cumulative += row.net; row.cumulativeBalance = cumulative; return row;
  });
}

export function summarizeRecognition(rows: FinanceEvent[]) {
  const groups = new Map<string, {code: string; name: string; kind: FinanceKind; count: number; amount: number; totalSource: number; settled: number; outstanding: number}>();
  for (const row of rows) {
    if (row.status !== 'posted') continue;
    const key = `${row.kind}:${row.category_code}`;
    const group = groups.get(key) ?? {code: row.category_code, name: row.category_name, kind: row.kind, count: 0, amount: 0, totalSource: 0, settled: 0, outstanding: 0};
    group.count++; group.amount += row.report_amount; group.totalSource += row.amount;
    group.settled += row.settled_amount; group.outstanding += Math.max(0,row.amount-row.settled_amount);
    groups.set(key,group);
  }
  return [...groups.values()].sort((a,b) => b.amount-a.amount || a.code.localeCompare(b.code));
}
