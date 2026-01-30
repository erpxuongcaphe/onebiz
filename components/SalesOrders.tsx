import React, { useEffect, useState } from 'react';
import { Search, Plus, ShoppingCart, Building2, Calendar, Edit, Package, Check, X, Printer } from 'lucide-react';
import Drawer from './Drawer';
import {
    fetchSalesOrders,
    createSalesOrder,
    updateSalesOrder,
    confirmSalesOrder,
    cancelSalesOrder,
    type SalesOrder,
    type CreateSalesOrderInput,
    type SalesOrderItem,
} from '../lib/salesOrders';
import { fetchCustomers, type Customer } from '../lib/customers';
import { fetchInventoryProducts } from '../lib/inventory';
import { type Product } from '../types';
import { useAuth } from '../lib/auth';
import { formatCurrency } from '../constants';
import SalesOrderPrint from './SalesOrderPrint';
import ReactDOM from 'react-dom/client';

const SalesOrders: React.FC = () => {
    const { can } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [orders, setOrders] = useState<SalesOrder[] | null>(null);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const [formBusy, setFormBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const reload = async () => {
        const [so, cust, prod] = await Promise.all([
            fetchSalesOrders({ status: statusFilter === 'all' ? undefined : statusFilter }),
            fetchCustomers(),
            fetchInventoryProducts(),
        ]);
        setOrders(so);
        setCustomers(cust);
        setProducts(prod);
    };

    useEffect(() => {
        reload();
    }, [statusFilter]);

    const filteredOrders = (orders ?? []).filter(
        (o) =>
            o.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (o.customer_name && o.customer_name.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleCreate = async (data: CreateSalesOrderInput) => {
        setFormBusy(true);
        setFormError(null);
        const result = await createSalesOrder(data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsCreateOpen(false);
        reload();
    };

    const handleEdit = async (data: CreateSalesOrderInput) => {
        if (!selectedOrder) return;
        setFormBusy(true);
        setFormError(null);
        const result = await updateSalesOrder(selectedOrder.id, data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsEditOpen(false);
        reload();
    };

    const handleConfirm = async (id: string) => {
        if (!confirm('Xác nhận đơn hàng? Tồn kho sẽ được kiểm tra.')) return;
        const result = await confirmSalesOrder(id);
        if (result.error) {
            alert(result.error);
            return;
        }
        setIsDetailsOpen(false);
        reload();
    };

    const handleCancel = async (id: string) => {
        if (!confirm('Hủy đơn hàng? Hành động này không thể hoàn tác.')) return;
        const result = await cancelSalesOrder(id);
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
            confirmed: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                    Đã xác nhận
                </span>
            ),
            picking: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400">
                    Đang lấy hàng
                </span>
            ),
            delivering: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
                    Đang giao
                </span>
            ),
            delivered: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                    Đã giao
                </span>
            ),
            completed: (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400">
                    Hoàn thành
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
                        <ShoppingCart className="w-5 h-5 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
                        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Đơn bán hàng</h1>
                    </div>
                    {can('sales_orders.create') && (
                        <button
                            onClick={() => setIsCreateOpen(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
                        >
                            <Plus className="w-4 h-4" strokeWidth={2} />
                            <span className="hidden sm:inline">Tạo đơn</span>
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
                            placeholder="Tìm theo số đơn, khách hàng..."
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
                        <option value="confirmed">Đã xác nhận</option>
                        <option value="picking">Đang lấy hàng</option>
                        <option value="delivering">Đang giao</option>
                        <option value="delivered">Đã giao</option>
                        <option value="completed">Hoàn thành</option>
                        <option value="cancelled">Đã hủy</option>
                    </select>
                </div>
            </div>

            {/* Order List */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {orders === null ? (
                    <div className="text-center py-8 text-sm text-slate-500">Đang tải...</div>
                ) : filteredOrders.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-500">
                        {searchTerm ? 'Không tìm thấy đơn hàng' : 'Chưa có đơn hàng nào'}
                    </div>
                ) : (
                    filteredOrders.map((order) => (
                        <div
                            key={order.id}
                            onClick={() => {
                                setSelectedOrder(order);
                                setIsDetailsOpen(true);
                            }}
                            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                                            {order.order_number}
                                        </h3>
                                        {getStatusBadge(order.status)}
                                    </div>
                                    {order.customer_name && (
                                        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-600 dark:text-slate-300">
                                            <Building2 className="w-3 h-3" strokeWidth={1.5} />
                                            <span>{order.customer_name}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between mt-1">
                                        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                                            <Calendar className="w-3 h-3" strokeWidth={1.5} />
                                            <span>{new Date(order.order_date).toLocaleDateString('vi-VN')}</span>
                                        </div>
                                        <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                                            {formatCurrency(order.total)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Drawer */}
            <Drawer isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Tạo đơn bán hàng">
                <SalesOrderForm
                    customers={customers}
                    products={products}
                    onSubmit={handleCreate}
                    onCancel={() => setIsCreateOpen(false)}
                    busy={formBusy}
                    error={formError}
                />
            </Drawer>

            {/* Edit Drawer */}
            <Drawer isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Sửa đơn bán hàng">
                {selectedOrder && (
                    <SalesOrderForm
                        customers={customers}
                        products={products}
                        initialData={selectedOrder}
                        onSubmit={handleEdit}
                        onCancel={() => setIsEditOpen(false)}
                        busy={formBusy}
                        error={formError}
                    />
                )}
            </Drawer>

            {/* Details Drawer */}
            <Drawer
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                title={selectedOrder?.order_number || ''}
            >
                {selectedOrder && (
                    <SalesOrderDetails
                        order={selectedOrder}
                        onEdit={() => {
                            setIsDetailsOpen(false);
                            setIsEditOpen(true);
                        }}
                        onConfirm={() => handleConfirm(selectedOrder.id)}
                        onCancel={() => handleCancel(selectedOrder.id)}
                        canEdit={can('sales_orders.update') && selectedOrder.status === 'draft'}
                        canConfirm={can('sales_orders.confirm') && selectedOrder.status === 'draft'}
                        canCancel={can('sales_orders.cancel') && !['completed', 'cancelled'].includes(selectedOrder.status)}
                    />
                )}
            </Drawer>
        </div>
    );
};

// Sales Order Form Component
interface SalesOrderFormProps {
    customers: Customer[];
    products: Product[];
    initialData?: SalesOrder;
    onSubmit: (data: CreateSalesOrderInput) => void;
    onCancel: () => void;
    busy: boolean;
    error: string | null;
}

const SalesOrderForm: React.FC<SalesOrderFormProps> = ({
    customers,
    products,
    initialData,
    onSubmit,
    onCancel,
    busy,
    error,
}) => {
    const [customerId, setCustomerId] = useState(initialData?.customer_id || '');
    const [orderDate, setOrderDate] = useState(initialData?.order_date || new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState(initialData?.notes || '');
    const [items, setItems] = useState<CreateSalesOrderInput['items']>(
        initialData?.items?.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_percent: item.discount_percent,
            tax_percent: item.tax_percent,
            notes: item.notes || null,
        })) || []
    );

    const addItem = () => {
        setItems([...items, { product_id: '', quantity: 1, unit_price: 0, discount_percent: 0, tax_percent: 10 }]);
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    const updateItem = (index: number, field: string, value: any) => {
        const updated = [...items];
        (updated[index] as any)[field] = value;
        setItems(updated);
    };

    const calculateTotals = () => {
        let subtotal = 0;
        let totalDiscount = 0;
        let totalTax = 0;
        for (const item of items) {
            const st = item.quantity * item.unit_price;
            const disc = st * ((item.discount_percent ?? 0) / 100);
            const tax = (st - disc) * ((item.tax_percent ?? 0) / 100);
            subtotal += st;
            totalDiscount += disc;
            totalTax += tax;
        }
        return { subtotal, discount: totalDiscount, tax: totalTax, total: subtotal - totalDiscount + totalTax };
    };

    const totals = calculateTotals();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!customerId) {
            alert('Vui lòng chọn khách hàng');
            return;
        }
        if (items.length === 0) {
            alert('Vui lòng thêm ít nhất 1 sản phẩm');
            return;
        }
        onSubmit({ customer_id: customerId, order_date: orderDate, notes: notes || null, items });
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {error && (
                    <div className="p-2 text-xs bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-lg border border-rose-200 dark:border-rose-800">
                        {error}
                    </div>
                )}

                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Thông tin chung</h3>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Khách hàng <span className="text-rose-500">*</span>
                        </label>
                        <select
                            required
                            value={customerId}
                            onChange={(e) => setCustomerId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Chọn khách hàng --</option>
                            {customers.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name} ({c.code})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            Ngày đơn hàng <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="date"
                            required
                            value={orderDate}
                            onChange={(e) => setOrderDate(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                {/* Line Items */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Sản phẩm ({items.length})</h3>
                        <button
                            type="button"
                            onClick={addItem}
                            className="text-xs px-2 py-1 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded"
                        >
                            + Thêm
                        </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {items.map((item, idx) => (
                            <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <select
                                        required
                                        value={item.product_id}
                                        onChange={(e) => updateItem(idx, 'product_id', e.target.value)}
                                        className="flex-1 px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="">-- Chọn sản phẩm --</option>
                                        {products.map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.name} ({p.sku})
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => removeItem(idx)}
                                        className="p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <label className="block text-slate-600 dark:text-slate-400 mb-0.5">SL</label>
                                        <input
                                            type="number"
                                            required
                                            min="0.001"
                                            step="0.001"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-600 dark:text-slate-400 mb-0.5">Đơn giá</label>
                                        <input
                                            type="number"
                                            required
                                            min="0"
                                            value={item.unit_price}
                                            onChange={(e) => updateItem(idx, 'unit_price', Number(e.target.value))}
                                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-600 dark:text-slate-400 mb-0.5">CK (%)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={item.discount_percent ?? 0}
                                            onChange={(e) => updateItem(idx, 'discount_percent', Number(e.target.value))}
                                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-600 dark:text-slate-400 mb-0.5">Thuế (%)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={item.tax_percent ?? 0}
                                            onChange={(e) => updateItem(idx, 'tax_percent', Number(e.target.value))}
                                            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Totals Preview */}
                {items.length > 0 && (
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-xs space-y-1">
                        <div className="flex justify-between">
                            <span>Tạm tính:</span>
                            <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-rose-600 dark:text-rose-400">
                            <span>Chiết khấu:</span>
                            <span className="font-mono">-{formatCurrency(totals.discount)}</span>
                        </div>
                        <div className="flex justify-between text-amber-600 dark:text-amber-400">
                            <span>Thuế:</span>
                            <span className="font-mono">+{formatCurrency(totals.tax)}</span>
                        </div>
                        <div className="flex justify-between font-bold text-indigo-600 dark:text-indigo-400 pt-1 border-t border-blue-300 dark:border-blue-700">
                            <span>Tổng cộng:</span>
                            <span className="font-mono">{formatCurrency(totals.total)}</span>
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
                        placeholder="Ghi chú về đơn hàng..."
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
                    {busy ? 'Đang lưu...' : initialData ? 'Cập nhật' : 'Tạo đơn'}
                </button>
            </div>
        </form>
    );
};

// Sales Order Details Component
interface SalesOrderDetailsProps {
    order: SalesOrder;
    onEdit: () => void;
    onConfirm: () => void;
    onCancel: () => void;
    canEdit: boolean;
    canConfirm: boolean;
    canCancel: boolean;
}

const SalesOrderDetails: React.FC<SalesOrderDetailsProps> = ({
    order,
    onEdit,
    onConfirm,
    onCancel,
    canEdit,
    canConfirm,
    canCancel,
}) => {
    const handlePrint = () => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const printContainer = printWindow.document.createElement('div');
        printWindow.document.body.appendChild(printContainer);

        const root = ReactDOM.createRoot(printContainer);
        root.render(<SalesOrderPrint order={order} />);

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
                                confirmed: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">Đã xác nhận</span>,
                                picking: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400">Đang lấy hàng</span>,
                                delivering: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-100 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">Đang giao</span>,
                                delivered: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">Đã giao</span>,
                                completed: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400">Hoàn thành</span>,
                                cancelled: <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">Đã hủy</span>,
                            };
                            return badges[order.status] || null;
                        })()}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-slate-500 dark:text-slate-400">Ngày đơn</div>
                            <div className="font-medium text-slate-900 dark:text-white">
                                {new Date(order.order_date).toLocaleDateString('vi-VN')}
                            </div>
                        </div>
                        {order.customer_name && (
                            <div>
                                <div className="text-slate-500 dark:text-slate-400">Khách hàng</div>
                                <div className="font-medium text-slate-900 dark:text-white">{order.customer_name}</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Line Items */}
                {order.items && order.items.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Package className="w-4 h-4" strokeWidth={1.5} />
                            Sản phẩm ({order.items.length})
                        </h3>
                        <div className="space-y-2">
                            {order.items.map((item) => (
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
                                    <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
                                        <div>
                                            <span className="text-slate-600 dark:text-slate-400">SL:</span>{' '}
                                            <span className="font-semibold tabular-nums">{item.quantity}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-600 dark:text-slate-400">Đã giao:</span>{' '}
                                            <span className="font-semibold tabular-nums">{item.delivered_quantity}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Totals */}
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 text-xs space-y-1">
                    <div className="flex justify-between">
                        <span>Tạm tính:</span>
                        <span className="font-mono">{formatCurrency(order.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-rose-600 dark:text-rose-400">
                        <span>Chiết khấu:</span>
                        <span className="font-mono">-{formatCurrency(order.discount)}</span>
                    </div>
                    <div className="flex justify-between text-amber-600 dark:text-amber-400">
                        <span>Thuế:</span>
                        <span className="font-mono">+{formatCurrency(order.tax)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-indigo-600 dark:text-indigo-400 pt-1 border-t border-blue-300 dark:border-blue-700">
                        <span>Tổng cộng:</span>
                        <span className="font-mono">{formatCurrency(order.total)}</span>
                    </div>
                </div>

                {/* Notes */}
                {order.notes && (
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ghi chú</h3>
                        <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{order.notes}</div>
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 space-y-2">
                {canConfirm && (
                    <button
                        onClick={onConfirm}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                    >
                        <Check className="w-4 h-4" strokeWidth={1.5} />
                        <span>Xác nhận đơn hàng</span>
                    </button>
                )}
                <button
                    onClick={handlePrint}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                    <Printer className="w-4 h-4" strokeWidth={1.5} />
                    <span>In phiếu</span>
                </button>
                {canEdit && (
                    <button
                        onClick={onEdit}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition"
                    >
                        <Edit className="w-4 h-4" strokeWidth={1.5} />
                        <span>Sửa đơn</span>
                    </button>
                )}
                {canCancel && (
                    <button
                        onClick={onCancel}
                        className="w-full px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/30 transition"
                    >
                        Hủy đơn
                    </button>
                )}
            </div>
        </div>
    );
};

export default SalesOrders;
