import React, { useEffect, useState } from 'react';
import { formatCurrency } from '../constants';
import { Order, OrderStatus, ViewMode } from '../types';
import { Download, LayoutList, AlignJustify } from 'lucide-react';
import Drawer from './Drawer';
import { fetchOrders } from '../lib/orders';

const Orders: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('compact');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    let isMounted = true;
    fetchOrders().then((data) => {
      if (!isMounted) return;
      setOrders(data);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const getStatusStyle = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.COMPLETED: return 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400';
      case OrderStatus.WAITING_PICK: return 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400';
      case OrderStatus.PROCESSING: return 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400';
      case OrderStatus.PENDING: return 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400';
      case OrderStatus.CANCELLED: return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 line-through';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  // Matched to Inventory density
  const tablePadding = viewMode === 'comfort' ? 'px-4 py-3' : 'px-2 py-2 text-[11px] lg:text-xs';

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Đơn hàng</h1>
          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Quản lý & xử lý đơn hàng.</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 flex">
            <button 
                onClick={() => setViewMode('comfort')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'comfort' ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                title="Chế độ Thoáng"
            >
                <LayoutList className="w-4 h-4" />
            </button>
            <button 
                onClick={() => setViewMode('compact')}
                className={`p-1.5 rounded-md transition-all ${viewMode === 'compact' ? 'bg-slate-100 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                title="Chế độ Excel"
            >
                <AlignJustify className="w-4 h-4" />
            </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold border-b border-slate-200 dark:border-slate-700 text-[10px] lg:text-[11px]">
              <tr>
                <th className={tablePadding}>Mã đơn</th>
                <th className={tablePadding}>Khách hàng</th>
                <th className={`${tablePadding} hidden sm:table-cell`}>Ngày đặt</th>
                <th className={`${tablePadding} text-center hidden sm:table-cell`}>SL</th>
                <th className={`${tablePadding} text-right`}>Tổng tiền</th>
                <th className={`${tablePadding} text-center`}>Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {orders === null && (
                <tr>
                  <td className={tablePadding} colSpan={6}>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Đang tải dữ liệu...</div>
                  </td>
                </tr>
              )}
              {orders !== null && orders.length === 0 && (
                <tr>
                  <td className={tablePadding} colSpan={6}>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">Không có dữ liệu.</div>
                  </td>
                </tr>
              )}
              {(orders ?? []).map((order) => (
                <tr 
                    key={order.id} 
                    onClick={() => setSelectedOrder(order)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                >
                  <td className={`${tablePadding} font-mono font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap text-[10px] lg:text-[11px]`}>{order.id}</td>
                  <td className={tablePadding}>
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-[9px] font-bold shrink-0">
                            {order.customer.charAt(0)}
                      </div>
                      <div className="min-w-0">
                         <span className="text-slate-900 dark:text-slate-200 font-semibold block truncate max-w-[110px] sm:max-w-xs">{order.customer}</span>
                         <span className="text-[9px] text-slate-400 sm:hidden block mt-0.5">{order.date}</span>
                      </div>
                    </div>
                  </td>
                  <td className={`${tablePadding} hidden sm:table-cell text-slate-600 dark:text-slate-400 font-medium`}>{order.date}</td>
                  <td className={`${tablePadding} hidden sm:table-cell text-center text-slate-700 dark:text-slate-300 tabular-nums`}>{order.items}</td>
                  <td className={`${tablePadding} text-right font-bold text-slate-900 dark:text-slate-200 tabular-nums`}>{formatCurrency(order.total)}</td>
                  <td className={`${tablePadding} text-center`}>
                    <span className={`px-1.5 py-0.5 rounded-[4px] text-[10px] font-bold ${getStatusStyle(order.status)}`}>
                      {order.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

       {/* Order Detail Drawer */}
       <Drawer 
        isOpen={!!selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        title={`${selectedOrder?.id}`}
      >
        {selectedOrder && (
            <div className="space-y-4">
                <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                    <div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Trạng thái</p>
                        <span className={`inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${getStatusStyle(selectedOrder.status)}`}>
                            {selectedOrder.status}
                        </span>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Tổng tiền</p>
                        <p className="text-base font-bold text-indigo-600 dark:text-indigo-400">{formatCurrency(selectedOrder.total)}</p>
                    </div>
                </div>

                <div className="space-y-1.5">
                     <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wide">Thông tin khách hàng</h4>
                     <div className="bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 space-y-1.5">
                         <div className="flex justify-between text-xs">
                             <span className="text-slate-500 dark:text-slate-400 font-medium">Tên:</span>
                             <span className="font-bold text-slate-900 dark:text-slate-200">{selectedOrder.customer}</span>
                         </div>
                         <div className="flex justify-between text-xs">
                             <span className="text-slate-500 dark:text-slate-400 font-medium">Ngày đặt:</span>
                             <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">{selectedOrder.date}</span>
                         </div>
                         <div className="flex justify-between text-xs">
                             <span className="text-slate-500 dark:text-slate-400 font-medium">SĐT:</span>
                             <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">0987 *** ***</span>
                         </div>
                     </div>
                </div>

                <div className="space-y-2">
                     <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wide">Danh sách sản phẩm ({selectedOrder.items})</h4>
                     <div className="space-y-2">
                        {/* Mock items based on order count */}
                        {Array.from({ length: selectedOrder.items }).map((_, i) => (
                            <div key={i} className="flex items-center gap-2.5 p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700">
                                <div className="w-9 h-9 bg-slate-100 dark:bg-slate-800 rounded-md flex-shrink-0 border border-slate-200 dark:border-slate-700"></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-200 truncate">Sản phẩm mẫu #{i + 1}</p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">SKU: SAMPLE-{i}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-200 tabular-nums">{formatCurrency(selectedOrder.total / selectedOrder.items)}</p>
                                    <p className="text-[10px] text-slate-500 tabular-nums">x1</p>
                                </div>
                            </div>
                        ))}
                     </div>
                </div>

                <div className="pt-2 flex gap-2 sticky bottom-0 bg-white dark:bg-slate-900 pb-4 border-t border-slate-100 dark:border-slate-800 mt-auto">
                     <button className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 py-2 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-2">
                        <Download className="w-3.5 h-3.5" />
                        In đơn
                     </button>
                     <button className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-xs font-bold transition-colors">
                        Xử lý đơn
                     </button>
                </div>
            </div>
        )}
      </Drawer>
    </div>
  );
};

export default Orders;
