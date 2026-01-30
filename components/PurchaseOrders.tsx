import React, { useEffect, useState } from 'react';
import { Search, Plus, FileText, Building2, Calendar, Trash2, Edit, Package } from 'lucide-react';
import Drawer from './Drawer';
import {
    fetchPurchaseOrders,
    createPurchaseOrder,
    updatePurchaseOrder,
    type PurchaseOrder,
    type CreatePurchaseOrderInput,
    type PurchaseOrderItem,
} from '../lib/purchaseOrders';
import { fetchSuppliers, type Supplier } from '../lib/suppliers';
import { fetchInventoryProducts } from '../lib/inventory';
import { type Product } from '../types';
import { useAuth } from '../lib/auth';
import { formatCurrency } from '../constants';

const PurchaseOrders: React.FC = () => {
    const { can } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const [formBusy, setFormBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const reload = async () => {
        const [o, s, p] = await Promise.all([
            fetchPurchaseOrders({ status: statusFilter === 'all' ? undefined : statusFilter }),
            fetchSuppliers({ includeInactive: false }),
            fetchInventoryProducts({ includeInactive: false }),
        ]);
        setOrders(o);
        setSuppliers(s);
        setProducts(p);
    };

    useEffect(() => {
        reload();
    }, [statusFilter]);

    const filteredOrders = (orders ?? []).filter(
        (o) =>
            o.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (o.supplier && o.supplier.name.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleCreate = async (data: CreatePurchaseOrderInput) => {
        setFormBusy(true);
        setFormError(null);
        const result = await createPurchaseOrder(data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsCreateOpen(false);
        reload();
    };

    const handleUpdate = async (id: string, data: Partial<CreatePurchaseOrderInput>) => {
        setFormBusy(true);
        setFormError(null);
        const result = await updatePurchaseOrder(id, data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsEditOpen(false);
        reload();
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, string> = {
            draft: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
            sent: 'bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
            confirmed: 'bg-indigo-100 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400',
            partial_received: 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
            received: 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
            closed: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
            cancelled: 'bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400',
        };

        const labels: Record<string, string> = {
            draft: 'Nháp',
            sent: 'Đã gửi',
            confirmed: 'Đã xác nhận',
            partial_received: 'Nhận một phần',
            received: 'Đã nhận đủ',
            closed: 'Đóng',
            cancelled: 'Hủy',
        };

        return (
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles[status] || ''}`}>
                {labels[status] || status}
            </span>
        );
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                        <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
                        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Đơn đặt hàng</h1>
                    </div>
                    {can('purchase_orders.create') && (
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
                            placeholder="Tìm theo số đơn, nhà cung cấp..."
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
                        <option value="sent">Đã gửi</option>
                        <option value="confirmed">Đã xác nhận</option>
                        <option value="partial_received">Nhận một phần</option>
                        <option value="received">Đã nhận đủ</option>
                        <option value="closed">Đóng</option>
                        <option value="cancelled">Hủy</option>
                    </select>
                </div>
            </div>

            {/* Order List */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {orders === null ? (
                    <div className="text-center py-8 text-sm text-slate-500">Đang tải...</div>
                ) : filteredOrders.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-500">
                        {searchTerm ? 'Không tìm thấy đơn đặt hàng' : 'Chưa có đơn đặt hàng nào'}
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
                                    {order.supplier && (
                                        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-600 dark:text-slate-300">
                                            <Building2 className="w-3 h-3" strokeWidth={1.5} />
                                            <span>{order.supplier.name}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        <div className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3" strokeWidth={1.5} />
                                            <span>{new Date(order.order_date).toLocaleDateString('vi-VN')}</span>
                                        </div>
                                        <span>{order.items?.length || 0} sản phẩm</span>
                                    </div>
                                    <div className="mt-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                                        {formatCurrency(order.total)}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Drawer */}
            <Drawer isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Tạo đơn đặt hàng">
                <PurchaseOrderForm
                    suppliers={suppliers}
                    products={products}
                    onSubmit={handleCreate}
                    onCancel={() => setIsCreateOpen(false)}
                    busy={formBusy}
                    error={formError}
                />
            </Drawer>

            {/* Edit Drawer */}
            <Drawer isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Sửa đơn đặt hàng">
                {selectedOrder && (
                    <PurchaseOrderForm
                        order={selectedOrder}
                        suppliers={suppliers}
                        products={products}
                        onSubmit={(data) => handleUpdate(selectedOrder.id, data)}
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
                    <PurchaseOrderDetails
                        order={selectedOrder}
                        onEdit={() => {
                            setIsDetailsOpen(false);
                            setIsEditOpen(true);
                        }}
                        canEdit={can('purchase_orders.update')}
                    />
                )}
            </Drawer>
        </div>
    );
};

// Purchase Order Form Component
interface PurchaseOrderFormProps {
    order?: PurchaseOrder;
    suppliers: Supplier[];
    products: Product[];
    onSubmit: (data: CreatePurchaseOrderInput) => void;
    onCancel: () => void;
    busy: boolean;
    error: string | null;
}

const PurchaseOrderForm: React.FC<PurchaseOrderFormProps> = ({
    order,
    suppliers,
    products,
    onSubmit,
    onCancel,
    busy,
    error,
}) => {
    const [supplierId, setSupplierId] = useState(order?.supplier_id || '');
    const [orderDate, setOrderDate] = useState(
        order?.order_date || new Date().toISOString().split('T')[0]
    );
    const [expectedDate, setExpectedDate] = useState(order?.expected_date || '');
    const [notes, setNotes] = useState(order?.notes || '');
    const [items, setItems] = useState<PurchaseOrderItem[]>(order?.items || []);

    const addItem = () => {
        setItems([
            ...items,
            {
                id: crypto.randomUUID(),
                product_id: '',
                quantity: 1,
                unit_price: 0,
                discount_percent: 0,
                tax_percent: 10,
                received_quantity: 0,
            } as PurchaseOrderItem,
        ]);
    };

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index));
    };

    const updateItem = (index: number, field: keyof PurchaseOrderItem, value: any) => {
        const updated = [...items];
        (updated[index] as any)[field] = value;
        setItems(updated);
    };

    const calculateTotals = () => {
        let subtotal = 0;
        let totalDiscount = 0;
        let totalTax = 0;

        items.forEach((item) => {
            const lineSubtotal = item.quantity * item.unit_price;
            const lineDiscount = lineSubtotal * (item.discount_percent / 100);
            const afterDiscount = lineSubtotal - lineDiscount;
            const lineTax = afterDiscount * (item.tax_percent / 100);

            subtotal += lineSubtotal;
            totalDiscount += lineDiscount;
            totalTax += lineTax;
        });

        const total = subtotal - totalDiscount + totalTax;

        return { subtotal, discount: totalDiscount, tax: totalTax, total };
    };

    const totals = calculateTotals();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!supplierId) {
            alert('Vui lòng chọn nhà cung cấp');
            return;
        }
        if (items.length === 0) {
            alert('Vui lòng thêm ít nhất 1 sản phẩm');
            return;
        }

        onSubmit({
            supplier_id: supplierId,
            order_date: orderDate,
            expected_date: expectedDate || null,
            notes: notes || null,
            items: items.map((item) => ({
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                discount_percent: item.discount_percent,
                tax_percent: item.tax_percent,
            })),
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
                            Nhà cung cấp <span className="text-rose-500">*</span>
                        </label>
                        <select
                            required
                            value={supplierId}
                            onChange={(e) => setSupplierId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Chọn nhà cung cấp --</option>
                            {suppliers.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.code})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Ngày đặt <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="date"
                                required
                                value={orderDate}
                                onChange={(e) => setOrderDate(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Ngày dự kiến nhận
                            </label>
                            <input
                                type="date"
                                value={expectedDate}
                                onChange={(e) => setExpectedDate(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Line Items */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Sản phẩm</h3>
                        <button
                            type="button"
                            onClick={addItem}
                            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            + Thêm sản phẩm
                        </button>
                    </div>
                    <div className="space-y-2">
                        {items.map((item, index) => (
                            <div
                                key={item.id}
                                className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700 space-y-2"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 space-y-2">
                                        <select
                                            required
                                            value={item.product_id}
                                            onChange={(e) => updateItem(index, 'product_id', e.target.value)}
                                            className="w-full px-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="">-- Chọn sản phẩm --</option>
                                            {products.map((p) => (
                                                <option key={p.id} value={p.id}>
                                                    {p.name} ({p.sku})
                                                </option>
                                            ))}
                                        </select>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                                    Số lượng
                                                </label>
                                                <input
                                                    type="number"
                                                    required
                                                    min="0.001"
                                                    step="0.001"
                                                    value={item.quantity}
                                                    onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                                                    className="w-full px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                                    Đơn giá
                                                </label>
                                                <input
                                                    type="number"
                                                    required
                                                    min="0"
                                                    step="0.01"
                                                    value={item.unit_price}
                                                    onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                                                    className="w-full px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <div>
                                                <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                                    Chiết khấu (%)
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={item.discount_percent}
                                                    onChange={(e) => updateItem(index, 'discount_percent', parseFloat(e.target.value) || 0)}
                                                    className="w-full px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] text-slate-600 dark:text-slate-400 mb-0.5">
                                                    Thuế (%)
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={item.tax_percent}
                                                    onChange={(e) => updateItem(index, 'tax_percent', parseFloat(e.target.value) || 0)}
                                                    className="w-full px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeItem(index)}
                                        className="mt-1 p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition"
                                    >
                                        <Trash2 className="w-4 h-4" strokeWidth={1.5} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Totals */}
                {items.length > 0 && (
                    <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400">Tạm tính</span>
                            <span className="font-medium tabular-nums">{formatCurrency(totals.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400">Chiết khấu</span>
                            <span className="font-medium text-rose-600 dark:text-rose-400 tabular-nums">
                                -{formatCurrency(totals.discount)}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-600 dark:text-slate-400">Thuế</span>
                            <span className="font-medium tabular-nums">{formatCurrency(totals.tax)}</span>
                        </div>
                        <div className="flex justify-between text-sm font-semibold pt-1 border-t border-slate-200 dark:border-slate-700">
                            <span className="text-slate-900 dark:text-white">Tổng cộng</span>
                            <span className="text-indigo-600 dark:text-indigo-400 tabular-nums">
                                {formatCurrency(totals.total)}
                            </span>
                        </div>
                    </div>
                )}

                {/* Notes */}
                <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Ghi chú</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={3}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        placeholder="Ghi chú thêm về đơn hàng..."
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
                    {busy ? 'Đang lưu...' : order ? 'Cập nhật' : 'Tạo đơn'}
                </button>
            </div>
        </form>
    );
};

// Purchase Order Details Component
interface PurchaseOrderDetailsProps {
    order: PurchaseOrder;
    onEdit: () => void;
    canEdit: boolean;
}

const PurchaseOrderDetails: React.FC<PurchaseOrderDetailsProps> = ({ order, onEdit, canEdit }) => {
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* Status & Basic Info */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Trạng thái</h3>
                        {order.status === 'draft' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                Nháp
                            </span>
                        )}
                        {order.status === 'sent' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                                Đã gửi
                            </span>
                        )}
                        {order.status === 'confirmed' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-indigo-100 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">
                                Đã xác nhận
                            </span>
                        )}
                        {order.status === 'partial_received' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                                Nhận một phần
                            </span>
                        )}
                        {order.status === 'received' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                                Đã nhận đủ
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-slate-500 dark:text-slate-400">Ngày đặt</div>
                            <div className="font-medium text-slate-900 dark:text-white">
                                {new Date(order.order_date).toLocaleDateString('vi-VN')}
                            </div>
                        </div>
                        {order.expected_date && (
                            <div>
                                <div className="text-slate-500 dark:text-slate-400">Ngày dự kiến</div>
                                <div className="font-medium text-slate-900 dark:text-white">
                                    {new Date(order.expected_date).toLocaleDateString('vi-VN')}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Supplier */}
                {order.supplier && (
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Building2 className="w-4 h-4" strokeWidth={1.5} />
                            Nhà cung cấp
                        </h3>
                        <div className="text-sm text-slate-900 dark:text-white">{order.supplier.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{order.supplier.code}</div>
                    </div>
                )}

                {/* Line Items */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Package className="w-4 h-4" strokeWidth={1.5} />
                        Sản phẩm ({order.items?.length || 0})
                    </h3>
                    <div className="space-y-2">
                        {order.items?.map((item) => {
                            const lineSubtotal = item.quantity * item.unit_price;
                            const lineDiscount = lineSubtotal * (item.discount_percent / 100);
                            const afterDiscount = lineSubtotal - lineDiscount;
                            const lineTax = afterDiscount * (item.tax_percent / 100);
                            const lineTotal = afterDiscount + lineTax;

                            return (
                                <div
                                    key={item.id}
                                    className="p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700"
                                >
                                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                                        {item.product?.name || 'N/A'}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                        {item.product?.sku || ''}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 mt-1.5 text-xs">
                                        <div>
                                            <span className="text-slate-500 dark:text-slate-400">Số lượng:</span>{' '}
                                            <span className="font-medium tabular-nums">{item.quantity}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-500 dark:text-slate-400">Đơn giá:</span>{' '}
                                            <span className="font-medium tabular-nums">{formatCurrency(item.unit_price)}</span>
                                        </div>
                                    </div>
                                    {(item.discount_percent > 0 || item.tax_percent > 0) && (
                                        <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
                                            {item.discount_percent > 0 && (
                                                <div>
                                                    <span className="text-slate-500 dark:text-slate-400">CK:</span>{' '}
                                                    <span className="font-medium">{item.discount_percent}%</span>
                                                </div>
                                            )}
                                            {item.tax_percent > 0 && (
                                                <div>
                                                    <span className="text-slate-500 dark:text-slate-400">Thuế:</span>{' '}
                                                    <span className="font-medium">{item.tax_percent}%</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    <div className="mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-700 text-xs font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                                        Thành tiền: {formatCurrency(lineTotal)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Totals */}
                <div className="space-y-1 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">Tạm tính</span>
                        <span className="font-medium tabular-nums">{formatCurrency(order.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">Chiết khấu</span>
                        <span className="font-medium text-rose-600 dark:text-rose-400 tabular-nums">
                            -{formatCurrency(order.discount)}
                        </span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-400">Thuế</span>
                        <span className="font-medium tabular-nums">{formatCurrency(order.tax)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold pt-1 border-t border-slate-200 dark:border-slate-700">
                        <span className="text-slate-900 dark:text-white">Tổng cộng</span>
                        <span className="text-indigo-600 dark:text-indigo-400 tabular-nums">
                            {formatCurrency(order.total)}
                        </span>
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
            {canEdit && order.status === 'draft' && (
                <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3">
                    <button
                        onClick={onEdit}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition"
                    >
                        <Edit className="w-4 h-4" strokeWidth={1.5} />
                        <span>Sửa đơn</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default PurchaseOrders;
