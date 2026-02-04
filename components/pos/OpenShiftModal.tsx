import React, { useState } from 'react';
import { X, DollarSign, CheckCircle2 } from 'lucide-react';
import { openShift } from '../../lib/pos';

interface OpenShiftModalProps {
  branchId: string;
  onClose: () => void;
  onSuccess: (shiftId: string) => void;
}

export const OpenShiftModal: React.FC<OpenShiftModalProps> = ({
  branchId,
  onClose,
  onSuccess,
}) => {
  const [openingCash, setOpeningCash] = useState('0');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(amount);
  };

  const handleOpen = async () => {
    const amount = parseFloat(openingCash) || 0;
    if (amount < 0) {
      setError('Tiền mở ca không thể âm');
      return;
    }

    setOpening(true);
    setError(null);

    try {
      const shiftId = await openShift({ branchId, openingCash: amount });
      if (!shiftId) {
        setError('Không thể mở ca. Vui lòng thử lại.');
        return;
      }
      setSuccess(true);
      setTimeout(() => onSuccess(shiftId), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi khi mở ca');
    } finally {
      setOpening(false);
    }
  };

  // Success state
  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-sm mx-4 p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Ca đã được mở</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tiền mở ca: {formatCurrency(parseFloat(openingCash) || 0)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center">
              <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Mở Ca Làm Việc</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 space-y-4">
          {error && (
            <div className="text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-3">
              {error}
            </div>
          )}

          {/* Opening cash input */}
          <div>
            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 block">
              Tiền Mở Ca (VND)
            </label>
            <div className="relative">
              <input
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                step={1000}
                min={0}
                className="w-full pl-8 pr-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                placeholder="0"
                disabled={opening}
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">₫</span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
              Hiển thị: {formatCurrency(parseFloat(openingCash) || 0)}
            </p>
          </div>

          {/* Quick amounts */}
          <div className="flex gap-2 flex-wrap">
            {[0, 100000, 200000, 500000, 1000000].map((amount) => (
              <button
                key={amount}
                onClick={() => setOpeningCash(String(amount))}
                disabled={opening}
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {amount === 0 ? '0' : `${amount / 1000}k`}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Hủy
            </button>
            <button
              onClick={handleOpen}
              disabled={opening}
              className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              {opening ? 'Đang mở...' : 'Mở Ca'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
