import React, { useState, useEffect } from 'react';
import { X, Search, Calendar, Printer, Eye, RefreshCw } from 'lucide-react';
import { searchPosOrders, type OrderSearchResult } from '../../lib/pos';

interface OrderSearchModalProps {
  branchId: string;
  onClose: () => void;
  onReprint: (orderId: string) => void;
}

type DateFilter = 'today' | 'week' | 'month' | 'custom';

export const OrderSearchModal: React.FC<OrderSearchModalProps> = ({
  branchId,
  onClose,
  onReprint,
}) => {
  const [searchText, setSearchText] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [results, setResults] = useState<OrderSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderSearchResult | null>(null);

  // Auto-search on mount with today's filter
  useEffect(() => {
    handleSearch();
  }, []);

  // Auto-search when date filter changes
  useEffect(() => {
    if (dateFilter !== 'custom') {
      handleSearch();
    }
  }, [dateFilter]);

  const getDateRange = (): { from?: string; to?: string } => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    switch (dateFilter) {
      case 'today':
        return {
          from: today.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        };
      case 'week': {
        const weekAgo = new Date(today);
        weekAgo.setDate(today.getDate() - 7);
        return {
          from: weekAgo.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        };
      }
      case 'month': {
        const monthAgo = new Date(today);
        monthAgo.setDate(today.getDate() - 30);
        return {
          from: monthAgo.toISOString().split('T')[0],
          to: today.toISOString().split('T')[0],
        };
      }
      case 'custom':
        return {
          from: fromDate || undefined,
          to: toDate || undefined,
        };
      default:
        return {};
    }
  };

  const handleSearch = async () => {
    try {
      setLoading(true);
      setError(null);

      const dateRange = getDateRange();
      const orders = await searchPosOrders({
        branchId,
        searchText: searchText.trim() || undefined,
        fromDate: dateRange.from,
        toDate: dateRange.to,
        limit: 50,
      });

      setResults(orders);
    } catch (err) {
      console.error('Error searching orders:', err);
      setError(err instanceof Error ? err.message : 'Lỗi khi tìm kiếm đơn hàng');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
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

  const getPaymentMethodLabel = (method: string): string => {
    const labels: Record<string, string> = {
      cash: 'Tiền mặt',
      bank_transfer: 'Chuyển khoản',
      card: 'Thẻ',
      momo: 'MoMo',
      zalopay: 'ZaloPay',
      other: 'Khác',
    };
    return labels[method] || method;
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { label: string; className: string }> = {
      paid: { label: 'Đã thanh toán', className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
      refunded: { label: 'Đã hoàn', className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
      pending: { label: 'Chờ xử lý', className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
    };
    const badge = badges[status] || { label: status, className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400' };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${badge.className}`}>
        {badge.label}
      </span>
    );
  };

  const handleReprint = (order: OrderSearchResult) => {
    onReprint(order.order_id);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <Search className="w-6 h-6 text-blue-600" />
            Tra Cứu Đơn Hàng
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Filters */}
        <div className="p-4 space-y-4 border-b border-slate-200 dark:border-slate-700">
          {/* Search Input */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Tìm theo số đơn hoặc tên khách hàng..."
                className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Đang tìm...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Tìm
                </>
              )}
            </button>
          </div>

          {/* Date Filters */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setDateFilter('today')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1 ${
                dateFilter === 'today'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Hôm nay
            </button>
            <button
              onClick={() => setDateFilter('week')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                dateFilter === 'week'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              7 ngày
            </button>
            <button
              onClick={() => setDateFilter('month')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                dateFilter === 'month'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              30 ngày
            </button>
            <button
              onClick={() => setDateFilter('custom')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                dateFilter === 'custom'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              Tùy chọn
            </button>

            {/* Custom Date Range */}
            {dateFilter === 'custom' && (
              <>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                />
                <span className="flex items-center text-slate-500">-</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-700 text-slate-800 dark:text-white"
                />
                <button
                  onClick={handleSearch}
                  disabled={loading || !fromDate || !toDate}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
                >
                  Áp dụng
                </button>
              </>
            )}
          </div>

          {/* Results Count */}
          <div className="text-sm text-slate-600 dark:text-slate-400">
            {loading ? (
              'Đang tìm kiếm...'
            ) : (
              <>
                Tìm thấy <span className="font-semibold text-slate-800 dark:text-white">{results.length}</span> đơn hàng
                {results.length >= 50 && ' (giới hạn 50 kết quả)'}
              </>
            )}
          </div>
        </div>

        {/* Results Table */}
        <div className="flex-1 overflow-auto p-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          {!loading && results.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-16 h-16 text-slate-300 dark:text-slate-600 mb-4" />
              <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Không tìm thấy đơn hàng
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-700/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Số Đơn
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Khách Hàng
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Thanh Toán
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Tổng Tiền
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Trạng Thái
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Thời Gian
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                      Thao Tác
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {results.map((order) => (
                    <tr
                      key={order.order_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">
                          {order.order_number}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-800 dark:text-white">
                          {order.customer_name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          {getPaymentMethodLabel(order.payment_method)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="text-sm font-semibold text-slate-800 dark:text-white">
                          {formatCurrency(order.total)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(order.status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          {formatDateTime(order.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedOrder(order);
                            }}
                            className="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg text-blue-600 dark:text-blue-400"
                            title="Xem chi tiết"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReprint(order);
                            }}
                            className="p-1.5 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg text-green-600 dark:text-green-400"
                            title="In lại hóa đơn"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Order Detail View */}
        {selectedOrder && (
          <div className="absolute inset-0 bg-white dark:bg-slate-800 flex flex-col z-10">
            <div className="sticky top-0 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                Chi Tiết Đơn Hàng
              </h3>
              <button
                onClick={() => setSelectedOrder(null)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <div className="max-w-2xl mx-auto space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">Số đơn:</span>
                      <span className="ml-2 font-mono font-bold text-blue-600 dark:text-blue-400">
                        {selectedOrder.order_number}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">Trạng thái:</span>
                      <span className="ml-2">{getStatusBadge(selectedOrder.status)}</span>
                    </div>
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">Khách hàng:</span>
                      <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                        {selectedOrder.customer_name}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">Thanh toán:</span>
                      <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                        {getPaymentMethodLabel(selectedOrder.payment_method)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">Thời gian:</span>
                      <span className="ml-2 font-semibold text-slate-800 dark:text-white">
                        {formatDateTime(selectedOrder.created_at)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600 dark:text-slate-400">Tổng tiền:</span>
                      <span className="ml-2 font-bold text-lg text-green-600 dark:text-green-400">
                        {formatCurrency(selectedOrder.total)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold"
                  >
                    Đóng
                  </button>
                  <button
                    onClick={() => handleReprint(selectedOrder)}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold flex items-center justify-center gap-2"
                  >
                    <Printer className="w-4 h-4" />
                    In Lại Hóa Đơn
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
