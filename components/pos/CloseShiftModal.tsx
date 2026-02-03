import React, { useState, useEffect } from 'react';
import { X, DollarSign, TrendingUp, AlertCircle, Printer } from 'lucide-react';
import { fetchShiftSummary, closeShiftWithReconciliation, type ShiftSummary } from '../../lib/pos';

interface CloseShiftModalProps {
  shiftId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const CloseShiftModal: React.FC<CloseShiftModalProps> = ({
  shiftId,
  onClose,
  onSuccess,
}) => {
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actualCash, setActualCash] = useState('');
  const [varianceNotes, setVarianceNotes] = useState('');
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch shift summary on mount
  useEffect(() => {
    loadShiftSummary();
  }, [shiftId]);

  async function loadShiftSummary() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchShiftSummary(shiftId);
      if (data) {
        setSummary(data);
      } else {
        setError('Không tải được thông tin ca làm việc');
      }
    } catch (err) {
      console.error('Error loading shift summary:', err);
      setError(err instanceof Error ? err.message : 'Lỗi khi tải dữ liệu');
    } finally {
      setLoading(false);
    }
  }

  const calculateVariance = (): number => {
    if (!summary || !actualCash) return 0;
    return parseFloat(actualCash) - summary.expected_cash;
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(amount);
  };

  const formatDateTime = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handlePrintReport = () => {
    if (!summary) return;

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Báo Cáo Ca - ${summary.shift_code}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .section { margin-top: 30px; }
          .total { font-weight: bold; font-size: 1.1em; }
        </style>
      </head>
      <body>
        <h1>BÁO CÁO ĐÓNG CA</h1>
        <div class="section">
          <h3>Thông Tin Ca</h3>
          <p><strong>Mã ca:</strong> ${summary.shift_code}</p>
          <p><strong>Thu ngân:</strong> ${summary.cashier_name}</p>
          <p><strong>Giờ mở:</strong> ${formatDateTime(summary.opened_at)}</p>
          <p><strong>Giờ đóng:</strong> ${formatDateTime(new Date().toISOString())}</p>
        </div>

        <div class="section">
          <h3>Tổng Kết</h3>
          <table>
            <tr><th>Tổng số đơn</th><td>${summary.total_orders}</td></tr>
            <tr><th>Tổng doanh thu</th><td>${formatCurrency(summary.total_sales)}</td></tr>
          </table>
        </div>

        <div class="section">
          <h3>Chi Tiết Thanh Toán</h3>
          <table>
            <tr><th>Tiền mặt</th><td>${formatCurrency(summary.cash_sales)}</td></tr>
            <tr><th>Chuyển khoản</th><td>${formatCurrency(summary.bank_sales)}</td></tr>
            <tr><th>Thẻ</th><td>${formatCurrency(summary.card_sales)}</td></tr>
            <tr><th>MoMo</th><td>${formatCurrency(summary.momo_sales)}</td></tr>
            <tr><th>ZaloPay</th><td>${formatCurrency(summary.zalopay_sales)}</td></tr>
            <tr><th>Khác</th><td>${formatCurrency(summary.other_sales)}</td></tr>
          </table>
        </div>

        <div class="section">
          <h3>Đối Soát Tiền Mặt</h3>
          <table>
            <tr><th>Tiền mở ca</th><td>${formatCurrency(summary.opening_cash)}</td></tr>
            <tr><th>Tiền mặt bán hàng</th><td>${formatCurrency(summary.cash_sales)}</td></tr>
            <tr class="total"><th>Tiền dự kiến</th><td>${formatCurrency(summary.expected_cash)}</td></tr>
            <tr><th>Tiền thực tế</th><td>${actualCash ? formatCurrency(parseFloat(actualCash)) : '-'}</td></tr>
            <tr class="total"><th>Chênh lệch</th><td>${actualCash ? formatCurrency(calculateVariance()) : '-'}</td></tr>
          </table>
        </div>

        ${varianceNotes ? `
        <div class="section">
          <h3>Ghi Chú</h3>
          <p>${varianceNotes}</p>
        </div>
        ` : ''}
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.print();
  };

  const handleCloseShift = async () => {
    if (!summary) return;

    // Validation
    if (!actualCash || actualCash.trim() === '') {
      setError('Vui lòng nhập số tiền thực tế');
      return;
    }

    const actualCashNum = parseFloat(actualCash);
    if (isNaN(actualCashNum) || actualCashNum < 0) {
      setError('Số tiền thực tế không hợp lệ');
      return;
    }

    const variance = calculateVariance();
    if (Math.abs(variance) > 0 && (!varianceNotes || varianceNotes.trim() === '')) {
      setError('Vui lòng nhập ghi chú khi có chênh lệch tiền');
      return;
    }

    try {
      setClosing(true);
      setError(null);

      const success = await closeShiftWithReconciliation({
        shiftId,
        actualCash: actualCashNum,
        varianceNotes: varianceNotes.trim() || undefined,
      });

      if (success) {
        onSuccess();
      } else {
        setError('Không thể đóng ca. Vui lòng thử lại.');
      }
    } catch (err) {
      console.error('Error closing shift:', err);
      setError(err instanceof Error ? err.message : 'Lỗi khi đóng ca');
    } finally {
      setClosing(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-8">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="text-slate-700 dark:text-slate-300">Đang tải...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle className="w-6 h-6" />
            <h3 className="font-semibold">Lỗi</h3>
          </div>
          <p className="text-slate-700 dark:text-slate-300 mb-4">
            {error || 'Không tải được thông tin ca làm việc'}
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-slate-200 dark:bg-slate-700 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600"
          >
            Đóng
          </button>
        </div>
      </div>
    );
  }

  const variance = calculateVariance();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-blue-600" />
            Đóng Ca Làm Việc
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Section 1: Shift Summary */}
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-3">
              Tóm Tắt Ca
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-slate-600 dark:text-slate-400">Mã ca:</span>
                <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                  {summary.shift_code}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Thu ngân:</span>
                <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                  {summary.cashier_name}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Giờ mở:</span>
                <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                  {formatDateTime(summary.opened_at)}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Giờ đóng:</span>
                <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                  {formatDateTime(new Date().toISOString())}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Tổng đơn:</span>
                <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                  {summary.total_orders}
                </span>
              </div>
              <div>
                <span className="text-slate-600 dark:text-slate-400">Doanh thu:</span>
                <span className="ml-2 font-semibold text-green-600 dark:text-green-400">
                  {formatCurrency(summary.total_sales)}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Payment Breakdown */}
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-white mb-3 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              Chi Tiết Thanh Toán
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-600 dark:text-slate-400">Tiền mặt</div>
                <div className="text-lg font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.cash_sales)}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-600 dark:text-slate-400">Chuyển khoản</div>
                <div className="text-lg font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.bank_sales)}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-600 dark:text-slate-400">Thẻ</div>
                <div className="text-lg font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.card_sales)}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-600 dark:text-slate-400">MoMo</div>
                <div className="text-lg font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.momo_sales)}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-600 dark:text-slate-400">ZaloPay</div>
                <div className="text-lg font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.zalopay_sales)}
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-3">
                <div className="text-xs text-slate-600 dark:text-slate-400">Khác</div>
                <div className="text-lg font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.other_sales)}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Cash Reconciliation */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <h3 className="font-semibold text-slate-800 dark:text-white mb-3">
              Đối Soát Tiền Mặt
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">Tiền mở ca:</span>
                <span className="font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.opening_cash)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 dark:text-slate-400">Tiền mặt bán hàng:</span>
                <span className="font-semibold text-slate-800 dark:text-white">
                  {formatCurrency(summary.cash_sales)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-700">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Tiền mặt dự kiến:
                </span>
                <span className="font-bold text-lg text-blue-600 dark:text-blue-400">
                  {formatCurrency(summary.expected_cash)}
                </span>
              </div>

              {/* Actual Cash Input */}
              <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
                <label className="block text-sm font-semibold text-yellow-900 dark:text-yellow-300 mb-2">
                  Tiền thực tế đếm được: *
                </label>
                <input
                  type="number"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  placeholder="0"
                  className="w-full px-4 py-2 border border-yellow-300 dark:border-yellow-700 rounded-lg text-lg font-semibold bg-white dark:bg-slate-800 text-slate-800 dark:text-white focus:ring-2 focus:ring-yellow-500"
                  min="0"
                  step="1000"
                />
              </div>

              {/* Variance Display */}
              {actualCash && !isNaN(parseFloat(actualCash)) && (
                <div
                  className={`flex justify-between items-center p-3 rounded-lg ${
                    variance === 0
                      ? 'bg-green-50 dark:bg-green-900/20'
                      : variance > 0
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'bg-red-50 dark:bg-red-900/20'
                  }`}
                >
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Chênh lệch:
                  </span>
                  <span
                    className={`font-bold text-xl ${
                      variance === 0
                        ? 'text-green-600 dark:text-green-400'
                        : variance > 0
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {variance > 0 ? '+' : ''}
                    {formatCurrency(variance)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Variance Notes */}
          {actualCash && Math.abs(variance) > 0 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Ghi chú chênh lệch: *
              </label>
              <textarea
                value={varianceNotes}
                onChange={(e) => setVarianceNotes(e.target.value)}
                placeholder="VD: Thiếu 50k - khách trả lẻ không đủ..."
                rows={3}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={closing}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              onClick={handlePrintReport}
              disabled={closing}
              className="flex items-center gap-2 px-4 py-2 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              In Báo Cáo
            </button>
            <button
              onClick={handleCloseShift}
              disabled={closing || !actualCash}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {closing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Đang đóng...
                </>
              ) : (
                'Đóng Ca'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
