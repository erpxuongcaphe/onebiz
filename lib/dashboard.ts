import { supabase } from './supabaseClient';

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function pctChange(current: number, prev: number): string {
  if (prev === 0) return current === 0 ? '0%' : '+100%';
  const pct = ((current - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function dayLabelVN(d: Date): string {
  // JS: 0=Sun ... 6=Sat
  const day = d.getDay();
  if (day === 0) return 'CN';
  return `T${day + 1}`; // Mon=2 ... Sat=7
}

export type DashboardOverview = {
  revenue7d: number;
  revenueChange: string;
  revenueTrend: 'up' | 'down';
  profit7d: number;
  profitChange: string;
  profitTrend: 'up' | 'down';
  cash7d: number;
  cashChange: string;
  cashTrend: 'up' | 'down';
  debt: number;
  debtChange: string;
  debtTrend: 'up' | 'down';
  series7d: Array<{ name: string; value: number }>;
};

export async function fetchDashboardOverview(): Promise<DashboardOverview | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const now = new Date();
  const startThis = new Date(now);
  startThis.setDate(now.getDate() - 6);
  const startPrev = new Date(startThis);
  startPrev.setDate(startThis.getDate() - 7);

  const startThisIso = toISODate(startThis);
  const startPrevIso = toISODate(startPrev);
  const nowIso = toISODate(now);

  const [{ data: orders, error: ordersErr }, { data: ordersPrev, error: ordersPrevErr }] = await Promise.all([
    supabase
      .from('sales_orders')
      .select('order_date, total')
      .gte('order_date', startThisIso)
      .lte('order_date', nowIso),
    supabase
      .from('sales_orders')
      .select('order_date, total')
      .gte('order_date', startPrevIso)
      .lt('order_date', startThisIso),
  ]);

  if (ordersErr || ordersPrevErr) return null;

  const sumOrders = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((acc, r) => acc + toNumber(r.total), 0);

  const revenueThis = sumOrders(orders as any[]);
  const revenuePrev = sumOrders(ordersPrev as any[]);
  const revenueChange = pctChange(revenueThis, revenuePrev);
  const revenueTrend: 'up' | 'down' = revenueThis >= revenuePrev ? 'up' : 'down';

  // Simple profit estimate until COGS exists
  // Simple profit estimate until COGS exists
  const profitThis = 0; // Not calculated yet
  const profitPrev = 0;
  const profitChange = '0%';
  const profitTrend: 'up' | 'down' = 'up';

  const [{ data: txThis, error: txThisErr }, { data: txPrev, error: txPrevErr }] = await Promise.all([
    supabase
      .from('finance_transactions')
      .select('transaction_date, total_amount')
      .gte('transaction_date', startThisIso)
      .lte('transaction_date', nowIso),
    supabase
      .from('finance_transactions')
      .select('transaction_date, total_amount')
      .gte('transaction_date', startPrevIso)
      .lt('transaction_date', startThisIso),
  ]);

  if (txThisErr || txPrevErr) return null;

  const sumNet = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((acc, r) => acc + toNumber(r.total_amount), 0);

  const cashThis = sumNet(txThis as any[]);
  const cashPrev = sumNet(txPrev as any[]);
  const cashChange = pctChange(cashThis, cashPrev);
  const cashTrend: 'up' | 'down' = cashThis >= cashPrev ? 'up' : 'down';

  const debt = 0;

  const seriesMap = new Map<string, number>();
  for (const r of (orders as any[]) ?? []) {
    const dateStr = String(r.order_date ?? '');
    seriesMap.set(dateStr, (seriesMap.get(dateStr) ?? 0) + toNumber(r.total));
  }

  const series7d: Array<{ name: string; value: number }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startThis);
    d.setDate(startThis.getDate() + i);
    const iso = toISODate(d);
    series7d.push({ name: dayLabelVN(d), value: seriesMap.get(iso) ?? 0 });
  }

  return {
    revenue7d: revenueThis,
    revenueChange,
    revenueTrend,
    profit7d: profitThis,
    profitChange,
    profitTrend,
    cash7d: cashThis,
    cashChange,
    cashTrend,
    debt,
    debtChange: '0%',
    debtTrend: 'down',
    series7d,
  };
}
