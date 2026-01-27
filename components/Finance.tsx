import React, { useEffect, useState } from 'react';
import { Wallet, CreditCard, ArrowUpRight, ArrowDownRight, Receipt, Plus, Download } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatCurrency } from '../constants';
import { fetchFinanceOverview, type FinanceTxn } from '../lib/finance';

type Trend = 'up' | 'down';

type FinanceCard = {
  id: string;
  label: string;
  value: number;
  trend: Trend;
  change: string;
  icon: LucideIcon;
};

const FINANCE_CARDS: FinanceCard[] = [
  { id: 'cash', label: 'Tiền mặt', value: 280000000, trend: 'up', change: '+5.1%', icon: Wallet },
  { id: 'bank', label: 'Ngân hàng', value: 620000000, trend: 'up', change: '+2.3%', icon: CreditCard },
  { id: 'receivable', label: 'Phải thu', value: 98000000, trend: 'down', change: '-1.8%', icon: Receipt },
  { id: 'payable', label: 'Phải trả', value: 76000000, trend: 'up', change: '+1.2%', icon: Receipt },
];

type Transaction = {
  id: string;
  description: string;
  amount: number;
  type: 'in' | 'out';
  date: string;
};

const TRANSACTIONS: Transaction[] = [
  { id: 'TRX-2312', description: 'Thanh toán đơn #ORD-7784', amount: 350000, type: 'in', date: 'Hôm nay, 10:30' },
  { id: 'TRX-2311', description: 'Chi phí vận chuyển', amount: 1200000, type: 'out', date: 'Hôm nay, 09:15' },
  { id: 'TRX-2310', description: 'Thanh toán NCC ABC', amount: 8500000, type: 'out', date: 'Hôm qua, 16:40' },
  { id: 'TRX-2309', description: 'Thu nợ KH Trần Thị B', amount: 5400000, type: 'in', date: 'Hôm qua, 14:05' },
];

const Finance: React.FC = () => {
  const [cards, setCards] = useState<FinanceCard[] | null>(null);
  const [txns, setTxns] = useState<FinanceTxn[] | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchFinanceOverview().then((res) => {
      if (!isMounted) return;
      if (!res) {
        setCards(FINANCE_CARDS);
        setTxns(TRANSACTIONS);
        return;
      }

      // Map to current UI shapes
      setCards([
        { id: 'cash', label: 'Tiền mặt (tạm tính)', value: res.cards.find((c) => c.id === 'cash')?.value ?? 0, trend: res.cards.find((c) => c.id === 'cash')?.trend ?? 'up', change: res.cards.find((c) => c.id === 'cash')?.change ?? '0%', icon: Wallet },
        { id: 'bank', label: 'Ngân hàng', value: res.cards.find((c) => c.id === 'bank')?.value ?? 0, trend: 'up', change: '0%', icon: CreditCard },
        { id: 'receivable', label: 'Phải thu', value: res.cards.find((c) => c.id === 'receivable')?.value ?? 0, trend: 'up', change: '0%', icon: Receipt },
        { id: 'payable', label: 'Phải trả', value: res.cards.find((c) => c.id === 'payable')?.value ?? 0, trend: 'up', change: '0%', icon: Receipt },
      ]);
      setTxns(res.txns);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const shownCards = cards ?? FINANCE_CARDS;
  const shownTxns: Array<FinanceTxn | Transaction> = txns ?? TRANSACTIONS;

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Tài chính</h1>
          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Theo dõi dòng tiền, thu chi và công nợ.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
            <Download className="w-3.5 h-3.5" />
            Xuất sổ quỹ
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">
            <Plus className="w-3.5 h-3.5" />
            Ghi nhận giao dịch
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {shownCards.map((card) => {
          const Icon = card.icon;
          const trendStyle = card.trend === 'up'
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400';
          return (
            <div key={card.id} className="bg-white dark:bg-slate-900 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 p-2.5">
              <div className="flex items-start justify-between">
                <div className="p-1 rounded-md bg-slate-50 dark:bg-slate-800 text-slate-500">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className={`text-[9px] font-bold flex items-center gap-0.5 ${trendStyle}`}>
                  {card.trend === 'up' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {card.change}
                </div>
              </div>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">{card.label}</p>
                <p className="text-sm lg:text-base font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">{formatCurrency(card.value)}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-2 border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          Giao dịch gần đây
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {txns === null && (
            <div className="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">Đang tải dữ liệu...</div>
          )}
          {shownTxns.map((trx) => (
            <div key={trx.id} className="flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-200 truncate">{trx.description}</p>
                <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">{trx.id} • {trx.date}</p>
              </div>
              <div className={`text-right text-[11px] font-bold tabular-nums ${trx.type === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {trx.type === 'in' ? '+' : '-'}{formatCurrency(trx.amount)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Finance;
