import type {CashBookEntry} from '@/lib/types';
import type {CashFlowDetailedRow} from '@/lib/services/supabase/analytics';
import type {CashFlowActivity, FinanceCashLink, FinanceEvent, FinanceKind} from '@/lib/services/supabase/management-finance';
import {cashCategoryLabel} from '@/lib/utils/cash-book-labels';
import {financeMoneyCents, financeReportRangeError, isFinanceReportDate} from '@/lib/reports/finance-report-input';

export const CASH_FLOW_LABELS: Record<CashFlowActivity, string> = {
  operating: 'Hoạt động kinh doanh', investing: 'Hoạt động đầu tư',
  financing: 'Hoạt động tài trợ', unclassified: 'Chưa phân loại',
};

const OPERATING_CATEGORIES = new Set([
  'supplier_advance', 'customer_advance', 'supplier_advance_refund', 'customer_advance_refund',
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
  const detail = entries.filter(entry => !entry.status || entry.status === 'completed').map(entry => {
    if (!entry.id || ids.has(entry.id)) throw new Error('Phiếu thu/chi bị trùng');
    const amount = financeMoneyCents(entry.amount);
    if (!['receipt', 'payment'].includes(entry.type)) throw new Error('Loại phiếu thu/chi không hợp lệ');
    ids.add(entry.id);
    const source = cashFlowSource(entry, sources);
    const total = totals.find(row => row.activity === source.activity)!;
    total[entry.type] = (financeMoneyCents(total[entry.type]) + amount) / 100; total.count++;
    total.net = (financeMoneyCents(total.receipt) - financeMoneyCents(total.payment)) / 100;
    return {...entry, ...source};
  });
  return {totals, detail, receipt: totals.reduce((sum,row) => sum+financeMoneyCents(row.receipt),0) / 100, payment: totals.reduce((sum,row) => sum+financeMoneyCents(row.payment),0) / 100};
}

export function cashFlowMonths(entries: CashBookEntry[], from: string, to: string): CashFlowDetailedRow[] {
  if (financeReportRangeError(from, to)) throw new Error('Khoảng ngày dòng tiền không hợp lệ');
  const [startYear, startMonth] = from.split('-').map(Number);
  const [endYear, endMonth] = to.split('-').map(Number);
  const buckets = new Map<string, CashFlowDetailedRow>();
  for (let index = startYear * 12 + startMonth - 1; index <= endYear * 12 + endMonth - 1; index++) {
    const year = Math.floor(index / 12), month = index % 12 + 1;
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    buckets.set(key,{month:`T${month}/${year}`,receipts:[],payments:[],totalReceipt:0,totalPayment:0,net:0,cumulativeBalance:0});
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.status && entry.status !== 'completed') continue;
    if (!entry.id || ids.has(entry.id)) throw new Error('Phiếu thu/chi bị trùng');
    ids.add(entry.id);
    const date = entry.date.slice(0,10);
    if (!isFinanceReportDate(date) || !['receipt', 'payment'].includes(entry.type)) throw new Error('Ngày hoặc loại phiếu thu/chi không hợp lệ');
    const amount = financeMoneyCents(entry.amount);
    if (date < from || date > to) throw new Error('Phiếu thu/chi ngoài kỳ báo cáo');
    const bucket = buckets.get(date.slice(0,7));
    if (!bucket) throw new Error('Ngày phiếu thu/chi không hợp lệ');
    const list = entry.type === 'receipt' ? bucket.receipts : bucket.payments;
    const item = list.find(row => row.category === entry.category);
    if (item) item.amount = (financeMoneyCents(item.amount) + amount) / 100; else list.push({category:entry.category,amount:entry.amount});
    if (entry.type === 'receipt') bucket.totalReceipt = (financeMoneyCents(bucket.totalReceipt) + amount) / 100;
    else bucket.totalPayment = (financeMoneyCents(bucket.totalPayment) + amount) / 100;
  }
  let cumulative = 0;
  return [...buckets.values()].map(row => {
    row.net = (financeMoneyCents(row.totalReceipt)-financeMoneyCents(row.totalPayment)) / 100;
    cumulative += financeMoneyCents(row.totalReceipt)-financeMoneyCents(row.totalPayment);
    row.cumulativeBalance = cumulative / 100; return row;
  });
}

export function summarizeRecognition(rows: FinanceEvent[]) {
  const groups = new Map<string, {code: string; name: string; kind: FinanceKind; count: number; amount: number; totalSource: number; settled: number; outstanding: number}>();
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error('Nguồn ghi nhận bị trùng');
    ids.add(row.id);
    if (row.status !== 'posted') continue;
    const amount = financeMoneyCents(row.amount), recognized = financeMoneyCents(row.report_amount), settled = financeMoneyCents(row.settled_amount);
    if (recognized > amount || settled > amount || !['income', 'expense', 'non_pnl'].includes(row.kind)) throw new Error('Nguồn ghi nhận không hợp lệ');
    const key = `${row.kind}:${row.category_code}`;
    const group = groups.get(key) ?? {code: row.category_code, name: row.category_name, kind: row.kind, count: 0, amount: 0, totalSource: 0, settled: 0, outstanding: 0};
    group.count++; group.amount = (financeMoneyCents(group.amount) + recognized) / 100;
    group.totalSource = (financeMoneyCents(group.totalSource) + amount) / 100;
    group.settled = (financeMoneyCents(group.settled) + settled) / 100;
    group.outstanding = (financeMoneyCents(group.outstanding) + amount - settled) / 100;
    groups.set(key,group);
  }
  return [...groups.values()].sort((a,b) => b.amount-a.amount || a.code.localeCompare(b.code));
}
