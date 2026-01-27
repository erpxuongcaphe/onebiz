import { supabase } from './supabaseClient';

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
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

export type ReportRow = {
  id: string;
  name: string;
  type: string;
  total: number;
  trend: 'up' | 'down';
  change: string;
};

export type ReportKpis = {
  revenue: number;
  profit: number;
  debt: number;
  expense: number;
  changeRevenue: string;
  changeExpense: string;
};

export async function fetchReportsOverview(): Promise<{ kpis: ReportKpis; rows: ReportRow[] } | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const now = new Date();
  const thisStart = startOfMonth(now);
  const nextStart = addMonths(thisStart, 1);
  const prevStart = addMonths(thisStart, -1);

  const thisStartIso = toISODate(thisStart);
  const nextStartIso = toISODate(nextStart);
  const prevStartIso = toISODate(prevStart);

  const [{ data: thisOrders, error: thisOrdersErr }, { data: prevOrders, error: prevOrdersErr }] = await Promise.all([
    supabase
      .from('sales_orders')
      .select('total, order_date, status')
      .gte('order_date', thisStartIso)
      .lt('order_date', nextStartIso),
    supabase
      .from('sales_orders')
      .select('total, order_date, status')
      .gte('order_date', prevStartIso)
      .lt('order_date', thisStartIso),
  ]);

  if (thisOrdersErr || prevOrdersErr) return null;

  const sumOrders = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((acc, r) => acc + toNumber(r.total), 0);

  const revenueThis = sumOrders(thisOrders as any[]);
  const revenuePrev = sumOrders(prevOrders as any[]);

  // Expense: finance_transactions with negative totals (this month)
  const [{ data: thisTx, error: thisTxErr }, { data: prevTx, error: prevTxErr }] = await Promise.all([
    supabase
      .from('finance_transactions')
      .select('total_amount, transaction_date, status')
      .gte('transaction_date', thisStartIso)
      .lt('transaction_date', nextStartIso),
    supabase
      .from('finance_transactions')
      .select('total_amount, transaction_date, status')
      .gte('transaction_date', prevStartIso)
      .lt('transaction_date', thisStartIso),
  ]);

  if (thisTxErr || prevTxErr) return null;

  const sumExpense = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((acc, r) => {
      const amt = toNumber(r.total_amount);
      return acc + (amt < 0 ? Math.abs(amt) : 0);
    }, 0);

  const expenseThis = sumExpense(thisTx as any[]);
  const expensePrev = sumExpense(prevTx as any[]);

  // Profit/debt are placeholders until AR/AP & COGS are modeled
  const profitThis = Math.max(0, Math.round(revenueThis * 0.25));
  const debtThis = 0;

  // Recent report rows: last 4 months revenue
  const fourMonthsAgo = addMonths(thisStart, -3);
  const rangeStartIso = toISODate(fourMonthsAgo);

  const { data: recentOrders, error: recentOrdersErr } = await supabase
    .from('sales_orders')
    .select('order_date, total')
    .gte('order_date', rangeStartIso)
    .lt('order_date', nextStartIso);

  if (recentOrdersErr) return null;

  const byMonth = new Map<string, number>();
  for (const r of (recentOrders as any[]) ?? []) {
    const dateStr = String(r.order_date ?? '');
    const key = dateStr.slice(0, 7); // YYYY-MM
    byMonth.set(key, (byMonth.get(key) ?? 0) + toNumber(r.total));
  }

  const months: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const d = addMonths(thisStart, -i);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const rows: ReportRow[] = months.map((m, idx) => {
    const total = byMonth.get(m) ?? 0;
    const prevMonth = idx === 0 ? null : months[idx - 1];
    const prevTotal = prevMonth ? (byMonth.get(prevMonth) ?? 0) : 0;
    const change = idx === 0 ? '0%' : pctChange(total, prevTotal);
    const trend: 'up' | 'down' = idx === 0 ? 'up' : (total >= prevTotal ? 'up' : 'down');
    const mm = m.slice(5, 7);
    return {
      id: `RPT-${m}`,
      name: `Báo cáo tháng ${mm}`,
      type: 'Doanh thu',
      total,
      trend,
      change,
    };
  });

  return {
    kpis: {
      revenue: revenueThis,
      profit: profitThis,
      debt: debtThis,
      expense: expenseThis,
      changeRevenue: pctChange(revenueThis, revenuePrev),
      changeExpense: pctChange(expenseThis, expensePrev),
    },
    rows,
  };
}
