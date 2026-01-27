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

export type FinanceCard = {
  id: 'cash' | 'bank' | 'receivable' | 'payable';
  label: string;
  value: number;
  trend: 'up' | 'down';
  change: string;
};

export type FinanceTxn = {
  id: string;
  description: string;
  amount: number;
  type: 'in' | 'out';
  date: string;
};

export async function fetchFinanceOverview(): Promise<{ cards: FinanceCard[]; txns: FinanceTxn[] } | null> {
  if (!supabase) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return null;

  const now = new Date();
  const startThis = new Date(now);
  startThis.setDate(now.getDate() - 30);
  const startPrev = new Date(startThis);
  startPrev.setDate(startThis.getDate() - 30);

  const startThisIso = toISODate(startThis);
  const startPrevIso = toISODate(startPrev);
  const nowIso = toISODate(now);

  const [{ data: txThis, error: txThisErr }, { data: txPrev, error: txPrevErr }] = await Promise.all([
    supabase
      .from('finance_transactions')
      .select('transaction_number, transaction_date, description, total_amount, status')
      .gte('transaction_date', startThisIso)
      .lte('transaction_date', nowIso)
      .order('transaction_date', { ascending: false })
      .limit(30),
    supabase
      .from('finance_transactions')
      .select('total_amount, transaction_date, status')
      .gte('transaction_date', startPrevIso)
      .lt('transaction_date', startThisIso),
  ]);

  if (txThisErr || txPrevErr) return null;

  const sumNet = (rows: any[] | null | undefined) =>
    (rows ?? []).reduce((acc, r) => acc + toNumber(r.total_amount), 0);

  const netThis = sumNet(txThis as any[]);
  const netPrev = sumNet(txPrev as any[]);

  const changeNet = pctChange(netThis, netPrev);
  const trendNet: 'up' | 'down' = netThis >= netPrev ? 'up' : 'down';

  const cards: FinanceCard[] = [
    { id: 'cash', label: 'Tien mat (tam tinh)', value: netThis, trend: trendNet, change: changeNet },
    { id: 'bank', label: 'Ngan hang', value: 0, trend: 'up', change: '0%' },
    { id: 'receivable', label: 'Phai thu', value: 0, trend: 'up', change: '0%' },
    { id: 'payable', label: 'Phai tra', value: 0, trend: 'up', change: '0%' },
  ];

  const txns: FinanceTxn[] = ((txThis as any[]) ?? []).map((t) => {
    const amt = toNumber(t.total_amount);
    const type: 'in' | 'out' = amt >= 0 ? 'in' : 'out';
    return {
      id: t.transaction_number,
      description: t.description ?? 'Giao dich',
      amount: Math.abs(amt),
      type,
      date: String(t.transaction_date ?? ''),
    };
  });

  return { cards, txns };
}
