import React, { useEffect, useState, useCallback } from 'react';
import { Wallet, CreditCard, ArrowUpRight, ArrowDownRight, Receipt, Plus, Download, X, Users, FileText, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatCurrency } from '../constants';
import {
  fetchFinanceOverview,
  fetchAccountsReceivable,
  fetchUnpaidInvoices,
  recordInvoicePayment,
  type FinanceTxn,
  type AccountsReceivableRow,
  type UnpaidInvoice,
} from '../lib/finance';

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

type PaymentModalState = {
  open: boolean;
  invoice: UnpaidInvoice | null;
};

const Finance: React.FC = () => {
  const [cards, setCards] = useState<FinanceCard[] | null>(null);
  const [txns, setTxns] = useState<FinanceTxn[] | null>(null);
  const [receivables, setReceivables] = useState<AccountsReceivableRow[]>([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState<UnpaidInvoice[]>([]);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [paymentModal, setPaymentModal] = useState<PaymentModalState>({ open: false, invoice: null });
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'receivable'>('overview');

  const loadData = useCallback(async () => {
    const [overviewRes, receivablesRes, invoicesRes] = await Promise.all([
      fetchFinanceOverview(),
      fetchAccountsReceivable(),
      fetchUnpaidInvoices(),
    ]);

    if (overviewRes) {
      setCards([
        { id: 'cash', label: 'Tiền mặt (tạm tính)', value: overviewRes.cards.find((c) => c.id === 'cash')?.value ?? 0, trend: overviewRes.cards.find((c) => c.id === 'cash')?.trend ?? 'up', change: overviewRes.cards.find((c) => c.id === 'cash')?.change ?? '0%', icon: Wallet },
        { id: 'bank', label: 'Ngân hàng', value: overviewRes.cards.find((c) => c.id === 'bank')?.value ?? 0, trend: 'up', change: '0%', icon: CreditCard },
        { id: 'receivable', label: 'Phải thu', value: overviewRes.cards.find((c) => c.id === 'receivable')?.value ?? 0, trend: 'up', change: '0%', icon: Receipt },
        { id: 'payable', label: 'Phải trả', value: overviewRes.cards.find((c) => c.id === 'payable')?.value ?? 0, trend: 'up', change: '0%', icon: Receipt },
      ]);
      setTxns(overviewRes.txns);
    } else {
      setCards(FINANCE_CARDS);
      setTxns(TRANSACTIONS);
    }

    setReceivables(receivablesRes);
    setUnpaidInvoices(invoicesRes);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRecordPayment = async () => {
    if (!paymentModal.invoice || !paymentAmount) return;
    const amount = Number.parseFloat(paymentAmount);
    if (Number.isNaN(amount) || amount <= 0) return;

    setIsSubmitting(true);
    const result = await recordInvoicePayment({
      orderId: paymentModal.invoice.id,
      amount,
      method: paymentMethod,
      reference: paymentReference || undefined,
      notes: paymentNotes || undefined,
    });
    setIsSubmitting(false);

    if (result.success) {
      setPaymentModal({ open: false, invoice: null });
      setPaymentAmount('');
      setPaymentMethod('cash');
      setPaymentReference('');
      setPaymentNotes('');
      loadData(); // Refresh data
    } else {
      alert(`Lỗi: ${result.error}`);
    }
  };

  const openPaymentModal = (invoice: UnpaidInvoice) => {
    setPaymentModal({ open: true, invoice });
    setPaymentAmount(invoice.outstanding.toString());
  };

  const shownCards = cards ?? FINANCE_CARDS;
  const shownTxns: Array<FinanceTxn | Transaction> = txns ?? TRANSACTIONS;

  // Group invoices by customer for expanded view
  const invoicesByCustomer = unpaidInvoices.reduce((acc, inv) => {
    const key = inv.customerId || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(inv);
    return acc;
  }, {} as Record<string, UnpaidInvoice[]>);

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      {/* Payment Modal */}
      {paymentModal.open && paymentModal.invoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md mx-4 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Ghi nhận thanh toán</h3>
              <button
                onClick={() => setPaymentModal({ open: false, invoice: null })}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Hóa đơn</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{paymentModal.invoice.orderNumber}</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">{paymentModal.invoice.customerName}</p>
                <div className="flex justify-between mt-2 text-[11px]">
                  <span className="text-slate-500">Tổng tiền:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(paymentModal.invoice.total)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Đã thanh toán:</span>
                  <span className="font-semibold text-emerald-600">{formatCurrency(paymentModal.invoice.amountPaid)}</span>
                </div>
                <div className="flex justify-between text-[11px] border-t border-slate-200 dark:border-slate-700 pt-1 mt-1">
                  <span className="text-slate-500">Còn lại:</span>
                  <span className="font-bold text-rose-600">{formatCurrency(paymentModal.invoice.outstanding)}</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Số tiền thanh toán
                </label>
                <input
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Nhập số tiền"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Phương thức
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="cash">Tiền mặt</option>
                  <option value="bank_transfer">Chuyển khoản</option>
                  <option value="card">Thẻ</option>
                  <option value="momo">MoMo</option>
                  <option value="zalopay">ZaloPay</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Mã tham chiếu (nếu có)
                </label>
                <input
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  placeholder="Số giao dịch, mã chuyển khoản..."
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Ghi chú
                </label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  rows={2}
                  placeholder="Ghi chú thêm..."
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setPaymentModal({ open: false, invoice: null })}
                  className="flex-1 px-4 py-2 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Hủy
                </button>
                <button
                  onClick={handleRecordPayment}
                  disabled={isSubmitting || !paymentAmount}
                  className="flex-1 px-4 py-2 text-[11px] font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Đang xử lý...' : 'Xác nhận'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
            activeTab === 'overview'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Tổng quan
        </button>
        <button
          onClick={() => setActiveTab('receivable')}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
            activeTab === 'receivable'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Công nợ phải thu
          {receivables.length > 0 && (
            <span className="bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
              {receivables.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'overview' && (
        <>
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
        </>
      )}

      {activeTab === 'receivable' && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-rose-50 dark:bg-rose-900/20 text-rose-600">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Tổng nợ phải thu</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">
                    {formatCurrency(receivables.reduce((sum, r) => sum + r.totalOutstanding, 0))}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-600">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Khách hàng nợ</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{receivables.length}</p>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-lg shadow-soft border border-slate-200 dark:border-slate-800 p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-600">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Hóa đơn chưa thu</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{unpaidInvoices.length}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Receivables by Customer */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="p-2 border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Công nợ theo khách hàng
            </div>
            {receivables.length === 0 ? (
              <div className="p-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                Không có công nợ phải thu
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {receivables.map((r) => (
                  <div key={r.customerId}>
                    <button
                      onClick={() => setExpandedCustomer(expandedCustomer === r.customerId ? null : r.customerId)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-slate-900 dark:text-slate-200">{r.customerName}</p>
                        <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {r.invoiceCount} hóa đơn • Nợ từ {r.oldestInvoiceDate ? new Date(r.oldestInvoiceDate).toLocaleDateString('vi-VN') : 'N/A'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                          {formatCurrency(r.totalOutstanding)}
                        </span>
                        {expandedCustomer === r.customerId ? (
                          <ChevronUp className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {/* Expanded invoices */}
                    {expandedCustomer === r.customerId && invoicesByCustomer[r.customerId] && (
                      <div className="bg-slate-50 dark:bg-slate-800/50 px-3 py-2 space-y-2">
                        {invoicesByCustomer[r.customerId].map((inv) => (
                          <div
                            key={inv.id}
                            className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-lg p-2 border border-slate-200 dark:border-slate-700"
                          >
                            <div>
                              <p className="text-[11px] font-semibold text-slate-900 dark:text-white">{inv.orderNumber}</p>
                              <p className="text-[9px] text-slate-500 dark:text-slate-400">
                                {new Date(inv.createdAt).toLocaleDateString('vi-VN')} •{' '}
                                <span className={inv.paymentStatus === 'partial' ? 'text-amber-600' : 'text-rose-600'}>
                                  {inv.paymentStatus === 'partial' ? 'Thanh toán một phần' : 'Chưa thanh toán'}
                                </span>
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <p className="text-[10px] text-slate-500 dark:text-slate-400">Còn lại</p>
                                <p className="text-[11px] font-bold text-rose-600 tabular-nums">{formatCurrency(inv.outstanding)}</p>
                              </div>
                              <button
                                onClick={() => openPaymentModal(inv)}
                                className="px-2 py-1 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md"
                              >
                                Thu tiền
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* All Unpaid Invoices */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="p-2 border-b border-slate-100 dark:border-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Tất cả hóa đơn chưa thanh toán
            </div>
            {unpaidInvoices.length === 0 ? (
              <div className="p-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
                Không có hóa đơn chưa thanh toán
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-50 dark:bg-slate-800">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Mã HĐ</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600 dark:text-slate-300">Khách hàng</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Tổng tiền</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Đã thu</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-600 dark:text-slate-300">Còn lại</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600 dark:text-slate-300">Trạng thái</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600 dark:text-slate-300"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {unpaidInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{inv.orderNumber}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{inv.customerName}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-900 dark:text-white">{formatCurrency(inv.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{formatCurrency(inv.amountPaid)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-rose-600">{formatCurrency(inv.outstanding)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                            inv.paymentStatus === 'partial'
                              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                              : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400'
                          }`}>
                            {inv.paymentStatus === 'partial' ? 'Một phần' : 'Chưa thu'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => openPaymentModal(inv)}
                            className="px-2 py-1 text-[10px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded"
                          >
                            Thu tiền
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Finance;
