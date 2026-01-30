import React, { useEffect, useState } from 'react';
import { Search, Plus, Package, FileText, CheckCircle, Calendar, Building2 } from 'lucide-react';
import Drawer from './Drawer';
import {
    fetchGoodsReceipts,
    createGoodsReceipt,
    completeGoodsReceipt,
    voidGoodsReceipt,
    type GoodsReceipt,
    type CreateGoodsReceiptInput,
} from '../lib/goodsReceipts';
import { fetchPurchaseOrders, type PurchaseOrder } from '../lib/purchaseOrders';
import { fetchInventoryWarehouses, type InventoryWarehouse } from '../lib/inventory';
import { useAuth } from '../lib/auth';
import { formatCurrency } from '../constants';

const GoodsReceipts: React.FC = () => {
    const { can } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [receipts, setReceipts] = useState<GoodsReceipt[] | null>(null);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [warehouses, setWarehouses] = useState<InventoryWarehouse[]>([]);
    const [selectedReceipt, setSelectedReceipt] = useState<GoodsReceipt | null>(null);
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const [formBusy, setFormBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const reload = async () => {
        const [r, po, w] = await Promise.all([
            fetchGoodsReceipts({ status: statusFilter === 'all' ? undefined : statusFilter }),
            fetchPurchaseOrders({ status: 'confirmed' }), // Only confirmed POs can be received
            fetchInventoryWarehouses(),
        ]);
        setReceipts(r);
        setPurchaseOrders(po);
        setWarehouses(w);
    };

    useEffect(() => {
        reload();
    }, [statusFilter]);

    const filteredReceipts = (receipts ?? []).filter(
        (r) =>
            r.receipt_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (r.purchase_order && r.purchase_order.order_number.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleCreate = async (data: CreateGoodsReceiptInput) => {
        setFormBusy(true);
        setFormError(null);
        const result = await createGoodsReceipt(data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsCreateOpen(false);
        reload();
    };

    const handleComplete = async (id: string) => {
        if (!confirm('Hoàn tất nhập kho? Tồn kho sẽ được cập nhật.')) return;
        const result = await completeGoodsReceipt(id);
        if (result.error) {
            alert(result.error);
            return;
        }
        setIsDetailsOpen(false);
        reload();
    };

    const handleVoid = async (id: string) => {
        if (!confirm('Hủy phiếu nhập? Hành động này không thể hoàn tác.')) return;
        const result = await voidGoodsReceipt(id);
        if (result.error) {
            alert(result.error);
            return;
        }
        setIsDetailsOpen(false);
        reload();
    };

    const getStatusBadge = (status: string) => {
        if (status === 'draft') {
            return (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                    Nháp
                </span>
            );
        }
        if (status === 'completed') {
            return (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                    Đã hoàn tất
                </span>
            );
        }
        if (status === 'void') {
            return (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
                    Đã hủy
                </span>
            );
        }
        return null;
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                        <Package className="w-5 h-5 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
                        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Phiếu nhập kho</h1>
                    </div>
                    {can('goods_receipts.create') && (
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
                        <option value="completed">Đã hoàn tất</option>
                        <option value="void">Đã hủy</option>
                    </select>
                </div>
            </div>

            {/* Receipt List */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {receipts === null ? (
                    <div className="text-center py-8 text-sm text-slate-500">Đang tải...</div>
                ) : filteredReceipts.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-500">
                        {searchTerm ? 'Không tìm thấy phiếu nhập kho' : 'Chưa có phiếu nhập kho nào'}
                    </div>
                ) : (
                    filteredReceipts.map((receipt) => (
                        <div
                            key={receipt.id}
                            onClick={() => {
                                setSelectedReceipt(receipt);
                                setIsDetailsOpen(true);
                            }}
                            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                                            {receipt.receipt_number}
                                        </h3>
                                        {getStatusBadge(receipt.status)}
                                    </div>
                                    {receipt.purchase_order && (
                                        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-600 dark:text-slate-300">
                                            <FileText className="w-3 h-3" strokeWidth={1.5} />
                                            <span>Đơn: {receipt.purchase_order.order_number}</span>
                                        </div>
                                    )}
                                    {receipt.warehouse && (
                                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                            <Building2 className="w-3 h-3" strokeWidth={1.5} />
                                            <span>{receipt.warehouse.name}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        <div className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3" strokeWidth={1.5} />
                                            <span>{new Date(receipt.receipt_date).toLocaleDateString('vi-VN')}</span>
                                        </div>
                                        <span>{receipt.items?.length || 0} sản phẩm</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Drawer */}
            <Drawer isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Tạo phiếu nhập kho">
                <GoodsReceiptForm
                    purchaseOrders={purchaseOrders}
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
                title={selectedReceipt?.receipt_number || ''}
            >
                {selectedReceipt && (
                    <GoodsReceiptDetails
                        receipt={selectedReceipt}
                        onComplete={() => handleComplete(selectedReceipt.id)}
                        onVoid={() => handleVoid(selectedReceipt.id)}
                        canComplete={can('goods_receipts.complete')}
                    />
                )}
            </Drawer>
        </div>
    );
};

// Goods Receipt Form Component
interface GoodsReceiptFormProps {
    purchaseOrders: PurchaseOrder[];
    warehouses: InventoryWarehouse[];
    onSubmit: (data: CreateGoodsReceiptInput) => void;
    onCancel: () => void;
    busy: boolean;
    error: string | null;
}

const GoodsReceiptForm: React.FC<GoodsReceiptFormProps> = ({
    purchaseOrders,
    warehouses,
    onSubmit,
    onCancel,
    busy,
    error,
}) => {
    const [purchaseOrderId, setPurchaseOrderId] = useState<string>('');
    const [warehouseId, setWarehouseId] = useState('');
    const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');

    const selectedPO = purchaseOrders.find((po) => po.id === purchaseOrderId);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!warehouseId) {
            alert('Vui lòng chọn kho');
            return;
        }

        onSubmit({
            purchase_order_id: purchaseOrderId || null,
            warehouse_id: warehouseId,
            receipt_date: receiptDate,
            notes: notes || null,
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
                            Đơn đặt hàng <span className="text-slate-400">(tùy chọn)</span>
                        </label>
                        <select
                            value={purchaseOrderId}
                            onChange={(e) => setPurchaseOrderId(e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="">-- Không có (nhập trực tiếp) --</option>
                            {purchaseOrders.map((po) => (
                                <option key={po.id} value={po.id}>
                                    {po.order_number} - {po.supplier_name} ({formatCurrency(po.total)})
                                </option>
                            ))}
                        </select>
                        {selectedPO && (
                            <div className="mt-1 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300">
                                <div className="font-medium">{selectedPO.supplier_name}</div>
                                <div className="mt-0.5">
                                    {selectedPO.items?.length || 0} sản phẩm · {formatCurrency(selectedPO.total)}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Kho nhập <span className="text-rose-500">*</span>
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
                                Ngày nhập <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="date"
                                required
                                value={receiptDate}
                                onChange={(e) => setReceiptDate(e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                </div>

                {/* PO Items Preview */}
                {selectedPO && selectedPO.items && selectedPO.items.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                            Sản phẩm từ đơn hàng ({selectedPO.items.length})
                        </h3>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {selectedPO.items.map((item) => (
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
                                            Đã nhận: <span className="font-medium tabular-nums">{item.received_quantity}</span>
                                        </span>
                                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold tabular-nums">
                                            Còn: {item.quantity - item.received_quantity}
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
                        rows={3}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                        placeholder="Ghi chú về phiếu nhập..."
                    />
                </div>

                {!purchaseOrderId && (
                    <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-xs text-amber-700 dark:text-amber-300">
                        <strong>Lưu ý:</strong> Bạn đang tạo phiếu nhập không liên kết đơn hàng. Sau khi tạo, bạn cần thêm sản
                        phẩm thủ công.
                    </div>
                )}
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

// Goods Receipt Details Component
interface GoodsReceiptDetailsProps {
    receipt: GoodsReceipt;
    onComplete: () => void;
    onVoid: () => void;
    canComplete: boolean;
}

const GoodsReceiptDetails: React.FC<GoodsReceiptDetailsProps> = ({
    receipt,
    onComplete,
    onVoid,
    canComplete,
}) => {
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* Status & Basic Info */}
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Trạng thái</h3>
                        {receipt.status === 'draft' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                Nháp
                            </span>
                        )}
                        {receipt.status === 'completed' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                                Đã hoàn tất
                            </span>
                        )}
                        {receipt.status === 'void' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-rose-100 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400">
                                Đã hủy
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-slate-500 dark:text-slate-400">Ngày nhập</div>
                            <div className="font-medium text-slate-900 dark:text-white">
                                {new Date(receipt.receipt_date).toLocaleDateString('vi-VN')}
                            </div>
                        </div>
                        {receipt.warehouse && (
                            <div>
                                <div className="text-slate-500 dark:text-slate-400">Kho</div>
                                <div className="font-medium text-slate-900 dark:text-white">{receipt.warehouse.name}</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Purchase Order */}
                {receipt.purchase_order && (
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <FileText className="w-4 h-4" strokeWidth={1.5} />
                            Đơn đặt hàng
                        </h3>
                        <div className="text-sm text-slate-900 dark:text-white">{receipt.purchase_order.order_number}</div>
                        {receipt.purchase_order.supplier && (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                {receipt.purchase_order.supplier.name}
                            </div>
                        )}
                    </div>
                )}

                {/* Line Items */}
                {receipt.items && receipt.items.length > 0 && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Package className="w-4 h-4" strokeWidth={1.5} />
                            Sản phẩm ({receipt.items.length})
                        </h3>
                        <div className="space-y-2">
                            {receipt.items.map((item) => (
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
                                        <span className="text-slate-600 dark:text-slate-400">Số lượng nhập:</span>{' '}
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
                {receipt.notes && (
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ghi chú</h3>
                        <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{receipt.notes}</div>
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            {canComplete && receipt.status === 'draft' && (
                <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 space-y-2">
                    <button
                        onClick={onComplete}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition"
                    >
                        <CheckCircle className="w-4 h-4" strokeWidth={1.5} />
                        <span>Hoàn tất nhập kho</span>
                    </button>
                    <button
                        onClick={onVoid}
                        className="w-full px-3 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/30 transition"
                    >
                        Hủy phiếu
                    </button>
                </div>
            )}
        </div>
    );
};

export default GoodsReceipts;
