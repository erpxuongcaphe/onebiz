export type SalesGrain = 'hour' | 'day' | 'month' | 'year';
export interface SalesRange { from: string; to: string; label: string }
export interface SalesBucket { key: string; sales: number; orders: number }
export interface SalesMode { mode: string; sales: number; orders: number }
export interface SalesDashboard {
  sales: number; discounts: number; returns: number; orders: number;
  received: number; refunded: number; collected: number;
  methods: Record<string, number>; buckets: SalesBucket[]; modes: SalesMode[];
}
export const SALES_MODES: Record<string, string> = {
  dine_in: 'Tại chỗ', takeaway: 'Mang về', delivery: 'Giao hàng',
  retail: 'Bán lẻ', internal: 'Nội bộ', unknown: 'Chưa phân loại',
};
const iso = (date: Date) => date.toISOString().slice(0, 10);

export function salesRange(grain: SalesGrain, anchor: string): SalesRange {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || iso(date) !== anchor) throw new Error('Ngày không hợp lệ.');
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  if (grain === 'hour') return { from: anchor, to: anchor, label: anchor.split('-').reverse().join('/') };
  if (grain === 'day') return {
    from: iso(new Date(Date.UTC(year, month, 1))),
    to: iso(new Date(Date.UTC(year, month + 1, 0))),
    label: `${String(month + 1).padStart(2, '0')}/${year}`,
  };
  if (grain === 'month') return { from: `${year}-01-01`, to: `${year}-12-31`, label: String(year) };
  return { from: `${year - 4}-01-01`, to: `${year}-12-31`, label: `${year - 4}–${year}` };
}

export function salesBucketLabel(key: string, grain: SalesGrain) {
  if (grain === 'hour') return `${key.slice(11, 13)}h`;
  if (grain === 'day') return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
  if (grain === 'month') return `T${Number(key.slice(5, 7))}`;
  return key.slice(0, 4);
}

export interface SalesChartBucket {
  key: string;
  sales: number | null;
  orders: number | null;
  pending: boolean;
  current: boolean;
}

export function salesChartBuckets(
  buckets: SalesBucket[],
  grain: SalesGrain,
  now: Date = new Date(),
): SalesChartBucket[] {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value;
  const localKey = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
  const length = { hour: 13, day: 10, month: 7, year: 4 }[grain];
  const currentKey = localKey.slice(0, length);

  return buckets.map(row => {
    const key = row.key.slice(0, length);
    // Keep unexpected nonzero source data visible; only empty future slots are pending.
    const pending = key > currentKey && row.sales === 0 && row.orders === 0;
    return {
      ...row,
      sales: pending ? null : row.sales,
      orders: pending ? null : row.orders,
      pending,
      current: key === currentKey,
    };
  });
}

export function canViewSalesDashboard(has: (code: string) => boolean, branchType?: string) {
  return branchType === 'store' ? has('pos_fnb.view_sales_summary') : has('reports.dashboard');
}
