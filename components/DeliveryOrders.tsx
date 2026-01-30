import React, { useEffect, useState } from 'react';
import { Search, Plus, Truck, FileText, Calendar, Package, CheckCircle, Printer } from 'lucide-react';
import Drawer from './Drawer';
import {
    fetchDeliveryOrders,
    createDeliveryOrder,
    completeDeliveryOrder,
    voidDeliveryOrder,
    type DeliveryOrder,
    type CreateDeliveryOrderInput,
} from '../lib/deliveryOrders';
import { fetchSalesOrders, type SalesOrder } from '../lib/salesOrders';
import { fetchInventoryWarehouses, type InventoryWarehouse } from '../lib/inventory';
import { useAuth } from '../lib/auth';
import { formatCurrency } from '../constants';
import DeliveryOrderPrint from './DeliveryOrderPrint';
import ReactDOM from 'react-dom/client';

const DeliveryOrders: React.FC = () => {
    const { can } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [deliveries, setDeliveries] = useState<DeliveryOrder[] | null>(null);
    const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
    const [warehouses, setWarehouses] = useState<InventoryWarehouse[]>([]);
    const [selectedDelivery, setSelectedDelivery] = useState<DeliveryOrder | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const [formBusy, setFormBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const reload = async () => {
        const [d, so, w] = await Promise.all([
            fetchDeliveryOrders({ status: statusFilter === 'all' ? undefined : statusFilter }),
            fetchSalesOrders({ status: 'confirmed' }), // Only confirmed SOs can be delivered
            fetchInventoryWarehouses(),
        ]);
        setDeliveries(d);
        setSalesOrders(so);
        setWarehouses(w);
    };

    useEffect(() => {
        reload();
    }, [statusFilter]);

    const filteredDeliveries = (deliveries ?? []).filter(
        (d) =>
            d.delivery_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (d.sales_order_number && d.sales_order_number.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleCreate = async (data: CreateDeliveryOrderInput) => {
        setFormBusy(true);
        setFormError(null);
        const result = await createDeliveryOrder(data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsCreateOpen(false);
        reload();
    };

    const handleComplete = async (id: string) => {
        if (!confirm('Hoàn tất giao hàng? Tồn kho sẽ được cập nhật.')) return;
        const result = await completeDeliveryOrder(id);
        if (result.error) {
            alert(result.error);
            return;
        }
        setIsDetailsOpen(false);
        reload();
    };

    const handleVoid = async (id: string) => {
        if (!confirm('Hủy phiếu giao? Hành động này không thể hoàn tác.')) return;
        const result = await voidDeliveryOrder(id);
        if (result.error) {
            alert(result.error);
            return;
        }
        setIsDetailsOpen(false);
        reload();
    };

    const getStatusBadge = (status: string) => {
        const badges: Record<string, React.ReactElement> = {
            draft: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    Nháp
                </span>
            ),
            in_transit: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                    Đang vận chuyển
                </span>
            ),
            delivered: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                    Đã giao
                </span>
            ),
            returned: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400">
                    Đã trả lại
                </span>
            ),
            cancelled: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
                    Đã hủy
                </span>
            ),
        };
        return badges[status] || null;
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                        <Truck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
                        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Phiếu giao hàng</h1>
                    </div>
                    {can('delivery_orders.create') && (
                        <button
                            onClick={() => setIsCreateOpen(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
                        >
                            <Plus className="w-4 h-4" strokeWidth={2} />
                            <span className="hidden sm:inline">Tạo phiếu</span>
                        </button>
                    )}
                </div>

                {/* Search & Filters */}
                <div className="mt-2 flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" strokeWidth={1.5} />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Tìm theo số phiếu, đơn hàng..."
                            className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="all">Tất cả</option>
                        <option value="draft">Nháp</option>
                        <option value="in_transit">Đang vận chuyển</option>
                        <option value="delivered">Đã giao</option>
                        <option value="returned">Đã trả lại</option>
                        <option value="cancelled">Đã hủy</option>
                    </select>
                </div>
            </div>

            {/* Delivery List */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {deliveries === null ? (
                    <div className="text-center py-8 text-sm text-slate-500">Đang tải...</div>
                ) : filteredDeliveries.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-500">
                        {searchTerm ? 'Không tìm thấy phiếu giao hàng' : 'Chưa có phiếu giao hàng nào'}
                    </div>
                ) : (
                    filteredDeliveries.map((delivery) => (
                        <div
                            key={delivery.id}
                            onClick={() => {
                                setSelectedDelivery(delivery);
                                setIsDetailsOpen(true);
                            }}
                            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                                            {delivery.delivery_number}
                                        </h3>
                                        {getStatusBadge(delivery.status)}
                                    </div>
                                    {delivery.sales_order_number && (
                                        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-600 dark:text-slate-300">
                                            <FileText className="w-3 h-3" strokeWidth={1.5} />
                                            <span>Đơn: {delivery.sales_order_number}</span>
                                        </div>
                                    )}
                                    {delivery.customer_name && (
                                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                            KH: {delivery.customer_name}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        <div className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3" strokeWidth={1.5} />
                                            <span>{new Date(delivery.delivery_date).toLocaleDateString('vi-VN')}</span>
                                        </div>
                                        <span>{delivery.items?.length || 0} sản phẩm</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Drawer */}
            <Drawer isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Tạo phiếu giao hàng">
                <DeliveryOrderForm
                    salesOrders={salesOrders}
                    warehouses={warehouses}
                    onSubmit={handleCreate}
                    onCancel={() => setIsCreateOpen(false)}
                    busy={formBusy}
                    error={formError}
                />
            </Drawer>

            {/* Details Drawer */}
            <Drawer
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                title={selectedDelivery?.delivery_number || ''}
            >
                {selectedDelivery && (
                    <DeliveryOrderDetails
                        delivery={selectedDelivery}
                        onComplete={() => handleComplete(selectedDelivery.id)}
                        onVoid={() => handleVoid(selectedDelivery.id)}
                        canComplete={can('delivery_orders.complete') && selectedDelivery.status === 'draft'}
                        canVoid={can('delivery_orders.cancel') && selectedDelivery.status === 'draft'}
                    />
                )}
            </Drawer>
        </div>
    );
};

// Delivery Order Form Component
interface DeliveryOrderFormProps {
    salesOrders: SalesOrder[];
    warehouses: InventoryWarehouse[];
    onSubmit: (data: CreateDeliveryOrderInput) => void;
    onCancel: () => void;
    busy: boolean;
    error: string | null;
}

const DeliveryOrderForm: React.FC<DeliveryOrderFormProps> = ({
    salesOrders,
    warehouses,
    onSubmit,
    onCancel,
    busy,
    error,
}) => {
    const [salesOrderId, setSalesOrderId] = useState<string>('');
    const [warehouseId, setWarehouseId] = useState('');
    const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    const selectedSO = salesOrders.find((so) => so.id === salesOrderId);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!warehouseId) {
            alert('Vui lòng chọn kho');
            return;
        }
        if (!selectedSO) {
            alert('Vui lòng chọn đơn bán hàng');
            return;
        }

        // Build items from sales order
        const items = (selectedSO.items || []).map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity - item.delivered_quantity,
            sales_order_item_id: item.id,
        }));

        onSubmit({
            sales_order_id: salesOrderId || null,
            customer_id: selectedSO.customer_id,
            warehouse_id: warehouseId,
            delivery_date: deliveryDate,
            notes: notes || null,
            items,
        });
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {error && (
                    <div className="p-2 text-xs bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-lg border border-rose-200 dark:border-rose-800">
                        {error}
                    </div>
                )}

                {/* Basic Info */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Thông tin chung</h3>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Đơn bán hàng <span className="text-rose-500">*</span>
                        </label>
                        <select
                            required
                            value={salesOrderId}
                            onChange={(e) => setSalesOrderId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Chọn đơn hàng --</option>
                            {salesOrders.map((so) => (
                                <option key={so.id} value={so.id}>
                                    {so.order_number} - {so.customer_name} ({formatCurrency(so.total)})
                                </option>
                            ))}
                        </select>
                        {selectedSO && (
                            <div className="mt-1 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300">
                                <div className="font-medium">{selectedSO.customer_name}</div>
                                <div className="mt-0.5">
                                    {selectedSO.items?.length || 0} sản phẩm · {formatCurrency(selectedSO.total)}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Kho xuất <span className="text-rose-500">*</span>
                            </label>
                            <select
                                required
                                value={warehouseId}
                                onChange={(e) => setWarehouseId(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">-- Chọn kho --</option>
                                {warehouses.map((w) => (
                                    <option key={w.id} value={w.id}>
                                        {w.name} ({w.code})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Ngày giao <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="date"
                                required
                                value={deliveryDate}
                                onChange={(e) => setDeliveryDate(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                </div>

                {/* SO Items Preview */}
                {selectedSO && selectedSO.items && selectedSO.items.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                            Sản phẩm từ đơn hàng ({selectedSO.items.length})
                        </h3>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {selectedSO.items.map((item) => (
                                <div
                                    key={item.id}
                                    className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                                        {item.product_name || 'N/A'}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                        {item.product_sku || ''}
                                    </div>
                                    <div className="flex items-center justify-between mt-1 text-xs">
                                        <span className="text-slate-600 dark:text-slate-400">
                                            Đặt: <span className="font-medium tabular-nums">{item.quantity}</span>
                                        </span>
                                        <span className="text-slate-600 dark:text-slate-400">
                                            Đã giao: <span className="font-medium tabular-nums">{item.delivered_quantity}</span>
                                        </span>
                                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold tabular-nums">
                                            Còn: {item.quantity - item.delivered_quantity}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Notes */}
                <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Ghi chú</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        placeholder="Ghi chú về phiếu giao..."
                    />
                </div>
            </div>

            {/* Footer Buttons */}
            <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 flex gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                    Hủy
                </button>
                <button
                    type="submit"
                    disabled={busy}
                    className="flex-1 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50"
                >
                    {busy ? 'Đang tạo...' : 'Tạo phiếu'}
                </button>
            </div>
        </form>
    );
};

// Delivery Order Details Component
interface DeliveryOrderDetailsProps {
    delivery: DeliveryOrder;
    onComplete: () => void;
    onVoid: () => void;
    canComplete: boolean;
    canVoid: boolean;
}

const DeliveryOrderDetails: React.FC<DeliveryOrderDetailsProps> = ({
    delivery,
    onComplete,
    onVoid,
    canComplete,
    canVoid,
}) => {
    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const printContainer = printWindow.document.createElement('div');
        printWindow.document.body.appendChild(printContainer);

        const root = ReactDOM.createRoot(printContainer);
        root.render(<DeliveryOrderPrint delivery={delivery} />);

        setTimeout(() => {
            printWindow.print();
        }, 500);
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* Status & Basic Info */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Trạng thái</h3>
                        {(() => {
                            const badges: Record<string, React.ReactElement> = {
                                draft: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">Nháp</span>,
                                in_transit: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">Đang vận chuyển</span>,
                                delivered: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">Đã giao</span>,
                                returned: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400">Đã trả lại</span>,
                                cancelled: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">Đã hủy</span>,
                            };
                            return badges[delivery.status] || null;
                        })()}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-slate-500 dark:text-slate-400">Ngày giao</div>
                            <div className="font-medium text-slate-900 dark:text-white">
                                {new Date(delivery.delivery_date).toLocaleDateString('vi-VN')}
                            </div>
                        </div>
                        {delivery.warehouse_name && (
                            <div>
                                <div className="text-slate-500 dark:text-slate-400">Kho</div>
                                <div className="font-medium text-slate-900 dark:text-white">{delivery.warehouse_name}</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sales Order */}
                {delivery.sales_order_number && (
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <FileText className="w-4 h-4" strokeWidth={1.5} />
                            Đơn bán hàng
                        </h3>
                        <div className="text-sm text-slate-900 dark:text-white">{delivery.sales_order_number}</div>
                        {delivery.customer_name && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">{delivery.customer_name}</div>
                        )}
                    </div>
                )}

                {/* Line Items */}
                {delivery.items && delivery.items.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Package className="w-4 h-4" strokeWidth={1.5} />
                            Sản phẩm ({delivery.items.length})
                        </h3>
                        <div className="space-y-2">
                            {delivery.items.map((item) => (
                                <div
                                    key={item.id}
                                    className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                                        {item.product_name || 'N/A'}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                        {item.product_sku || ''}
                                    </div>
                                    <div className="mt-1.5 text-xs">
                                        <span className="text-slate-600 dark:text-slate-400">Số lượng giao:</span>{' '}
                                        <span className="font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                                            {item.quantity}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Notes */}
                {delivery.notes && (
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ghi chú</h3>
                        <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{delivery.notes}</div>
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            {(canComplete || canVoid) && (
                <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 space-y-2">
                    <button
                        onClick={handlePrint}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                    >
                        <Printer className="w-4 h-4" strokeWidth={1.5} />
                        <span>In phiếu giao hàng</span>
                    </button>
                    {canComplete && (
                        <button
                            onClick={onComplete}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition"
                        >
                            <CheckCircle className="w-4 h-4" strokeWidth={1.5} />
                            <span>Hoàn tất giao hàng</span>
                        </button>
                    )}
                    {canVoid && (
                        <button
                            onClick={onVoid}
                            className="w-full px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/30 transition"
                        >
                            Hủy phiếu
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default DeliveryOrders;
