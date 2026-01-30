import React, { useEffect, useState } from 'react';
import { Search, Plus, MoreHorizontal, Building2, Phone, Mail, CreditCard, Pencil, Archive, ArchiveRestore } from 'lucide-react';
import Drawer from './Drawer';
import {
    fetchSuppliers,
    createSupplier,
    updateSupplier,
    archiveSupplier,
    restoreSupplier,
    type Supplier,
    type CreateSupplierInput,
} from '../lib/suppliers';
import { useAuth } from '../lib/auth';

const Suppliers: React.FC = () => {
    const { can } = useAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
    const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
    const [includeInactive, setIncludeInactive] = useState(false);

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isDetailsOpen, setIsDetailsOpen] = useState(false);

    const [formBusy, setFormBusy] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

    const reload = async () => {
        const s = await fetchSuppliers({ includeInactive });
        setSuppliers(s);
    };

    useEffect(() => {
        reload();
    }, [includeInactive]);

    const filteredSuppliers = (suppliers ?? []).filter(
        (s) =>
            s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (s.tax_code && s.tax_code.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const handleCreate = async (data: CreateSupplierInput) => {
        setFormBusy(true);
        setFormError(null);
        const result = await createSupplier(data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsCreateOpen(false);
        reload();
    };

    const handleUpdate = async (id: string, data: Partial<CreateSupplierInput>) => {
        setFormBusy(true);
        setFormError(null);
        const result = await updateSupplier(id, data);
        setFormBusy(false);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setIsEditOpen(false);
        reload();
    };

    const handleArchive = async (id: string) => {
        const result = await archiveSupplier(id);
        if (result.error) {
            alert(result.error);
            return;
        }
        setIsDetailsOpen(false);
        reload();
    };

    const handleRestore = async (id: string) => {
        const result = await restoreSupplier(id);
        if (result.error) {
            alert(result.error);
            return;
        }
        reload();
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950">
            {/* Header */}
            <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                        <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-400" strokeWidth={2} />
                        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Nhà cung cấp</h1>
                    </div>
                    {can('suppliers.create') && (
                        <button
                            onClick={() => setIsCreateOpen(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition"
                        >
                            <Plus className="w-4 h-4" strokeWidth={2} />
                            <span className="hidden sm:inline">Thêm mới</span>
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
                            placeholder="Tìm theo tên, mã, mã số thuế..."
                            className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 cursor-pointer whitespace-nowrap">
                        <input
                            type="checkbox"
                            checked={includeInactive}
                            onChange={(e) => setIncludeInactive(e.target.checked)}
                            className="rounded border-slate-300 dark:border-slate-600"
                        />
                        <span>Đã ngưng</span>
                    </label>
                </div>
            </div>

            {/* Supplier List */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
                {suppliers === null ? (
                    <div className="text-center py-8 text-sm text-slate-500">Đang tải...</div>
                ) : filteredSuppliers.length === 0 ? (
                    <div className="text-center py-8 text-sm text-slate-500">
                        {searchTerm ? 'Không tìm thấy nhà cung cấp' : 'Chưa có nhà cung cấp nào'}
                    </div>
                ) : (
                    filteredSuppliers.map((supplier) => (
                        <div
                            key={supplier.id}
                            onClick={() => {
                                setSelectedSupplier(supplier);
                                setIsDetailsOpen(true);
                            }}
                            className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                            {supplier.name}
                                        </h3>
                                        {supplier.status === 'inactive' && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded">
                                                Đã ngưng
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        <span className="font-mono">{supplier.code}</span>
                                        {supplier.tax_code && <span>MST: {supplier.tax_code}</span>}
                                    </div>
                                    {supplier.contact_person && (
                                        <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                            {supplier.contact_person}
                                        </div>
                                    )}
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        {supplier.phone && (
                                            <div className="flex items-center gap-1">
                                                <Phone className="w-3 h-3" strokeWidth={1.5} />
                                                <span>{supplier.phone}</span>
                                            </div>
                                        )}
                                        {supplier.email && (
                                            <div className="flex items-center gap-1">
                                                <Mail className="w-3 h-3" strokeWidth={1.5} />
                                                <span>{supplier.email}</span>
                                            </div>
                                        )}
                                    </div>
                                    {supplier.payment_terms_days > 0 && (
                                        <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                                            Thanh toán: {supplier.payment_terms_days} ngày
                                        </div>
                                    )}
                                </div>
                                <MoreHorizontal className="w-4 h-4 text-slate-400" strokeWidth={1.5} />
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Create Drawer */}
            <Drawer isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Thêm nhà cung cấp">
                <SupplierForm
                    onSubmit={handleCreate}
                    onCancel={() => setIsCreateOpen(false)}
                    busy={formBusy}
                    error={formError}
                />
            </Drawer>

            {/* Edit Drawer */}
            <Drawer isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title="Sửa nhà cung cấp">
                {selectedSupplier && (
                    <SupplierForm
                        supplier={selectedSupplier}
                        onSubmit={(data) => handleUpdate(selectedSupplier.id, data)}
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
                title={selectedSupplier?.name || ''}
            >
                {selectedSupplier && (
                    <SupplierDetails
                        supplier={selectedSupplier}
                        onEdit={() => {
                            setIsDetailsOpen(false);
                            setIsEditOpen(true);
                        }}
                        onArchive={() => handleArchive(selectedSupplier.id)}
                        onRestore={() => handleRestore(selectedSupplier.id)}
                        canEdit={can('suppliers.update')}
                        canDelete={can('suppliers.delete')}
                    />
                )}
            </Drawer>
        </div>
    );
};

// Supplier Form Component
interface SupplierFormProps {
    supplier?: Supplier;
    onSubmit: (data: CreateSupplierInput) => void;
    onCancel: () => void;
    busy: boolean;
    error: string | null;
}

const SupplierForm: React.FC<SupplierFormProps> = ({ supplier, onSubmit, onCancel, busy, error }) => {
    const [formData, setFormData] = useState<CreateSupplierInput>({
        code: supplier?.code || '',
        name: supplier?.name || '',
        tax_code: supplier?.tax_code || null,
        contact_person: supplier?.contact_person || null,
        email: supplier?.email || null,
        phone: supplier?.phone || null,
        address: supplier?.address || null,
        bank_name: supplier?.bank_name || null,
        bank_account_number: supplier?.bank_account_number || null,
        bank_account_name: supplier?.bank_account_name || null,
        bank_branch: supplier?.bank_branch || null,
        payment_terms_days: supplier?.payment_terms_days || 0,
        payment_terms_description: supplier?.payment_terms_description || null,
        credit_limit: supplier?.credit_limit || null,
        currency: supplier?.currency || 'VND',
        default_tax_percent: supplier?.default_tax_percent || 10,
        default_discount_percent: supplier?.default_discount_percent || 0,
        notes: supplier?.notes || null,
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit(formData);
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
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Thông tin cơ bản</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Mã <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.code}
                                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                placeholder="SUP001"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                                Tên <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                placeholder="Công ty ABC"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Mã số thuế</label>
                        <input
                            type="text"
                            value={formData.tax_code || ''}
                            onChange={(e) => setFormData({ ...formData, tax_code: e.target.value || null })}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="0123456789"
                        />
                    </div>
                </div>

                {/* Contact */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Liên hệ</h3>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Người liên hệ</label>
                        <input
                            type="text"
                            value={formData.contact_person || ''}
                            onChange={(e) => setFormData({ ...formData, contact_person: e.target.value || null })}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="Nguyễn Văn A"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                            <input
                                type="email"
                                value={formData.email || ''}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value || null })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                placeholder="example@gmail.com"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Điện thoại</label>
                            <input
                                type="tel"
                                value={formData.phone || ''}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value || null })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                placeholder="0901234567"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Địa chỉ</label>
                        <textarea
                            value={formData.address || ''}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value || null })}
                            rows={2}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="Địa chỉ đầy đủ"
                        />
                    </div>
                </div>

                {/* Bank Info */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Thông tin ngân hàng</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Ngân hàng</label>
                            <input
                                type="text"
                                value={formData.bank_name || ''}
                                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value || null })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                placeholder="Vietcombank"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Chi nhánh</label>
                            <input
                                type="text"
                                value={formData.bank_branch || ''}
                                onChange={(e) => setFormData({ ...formData, bank_branch: e.target.value || null })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                placeholder="Hà Nội"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Số tài khoản</label>
                        <input
                            type="text"
                            value={formData.bank_account_number || ''}
                            onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value || null })}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="1234567890"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Tên tài khoản</label>
                        <input
                            type="text"
                            value={formData.bank_account_name || ''}
                            onChange={(e) => setFormData({ ...formData, bank_account_name: e.target.value || null })}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="CONG TY ABC"
                        />
                    </div>
                </div>

                {/* Payment Terms */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Điều khoản thanh toán</h3>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Số ngày thanh toán</label>
                        <input
                            type="number"
                            value={formData.payment_terms_days}
                            onChange={(e) => setFormData({ ...formData, payment_terms_days: parseInt(e.target.value) || 0 })}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="0 = tiền mặt, 30 = 30 ngày"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Mô tả</label>
                        <textarea
                            value={formData.payment_terms_description || ''}
                            onChange={(e) => setFormData({ ...formData, payment_terms_description: e.target.value || null })}
                            rows={2}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="Ví dụ: 50% đặt cọc, 50% khi giao hàng"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Hạn mức công nợ</label>
                        <input
                            type="number"
                            value={formData.credit_limit || ''}
                            onChange={(e) => setFormData({ ...formData, credit_limit: parseFloat(e.target.value) || null })}
                            className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            placeholder="100000000"
                        />
                    </div>
                </div>

                {/* Defaults */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Mặc định</h3>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Thuế VAT (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.default_tax_percent}
                                onChange={(e) => setFormData({ ...formData, default_tax_percent: parseFloat(e.target.value) || 0 })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Chiết khấu (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.default_discount_percent}
                                onChange={(e) => setFormData({ ...formData, default_discount_percent: parseFloat(e.target.value) || 0 })}
                                className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Notes */}
                <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Ghi chú</label>
                    <textarea
                        value={formData.notes || ''}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value || null })}
                        rows={3}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500"
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
                    {busy ? 'Đang lưu...' : supplier ? 'Cập nhật' : 'Tạo mới'}
                </button>
            </div>
        </form>
    );
};

// Supplier Details Component
interface SupplierDetailsProps {
    supplier: Supplier;
    onEdit: () => void;
    onArchive: () => void;
    onRestore: () => void;
    canEdit: boolean;
    canDelete: boolean;
}

const SupplierDetails: React.FC<SupplierDetailsProps> = ({
    supplier,
    onEdit,
    onArchive,
    onRestore,
    canEdit,
    canDelete,
}) => {
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* Basic Info */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Thông tin cơ bản</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                            <div className="text-slate-500 dark:text-slate-400">Mã</div>
                            <div className="font-mono font-medium text-slate-900 dark:text-white">{supplier.code}</div>
                        </div>
                        {supplier.tax_code && (
                            <div>
                                <div className="text-slate-500 dark:text-slate-400">Mã số thuế</div>
                                <div className="font-medium text-slate-900 dark:text-white">{supplier.tax_code}</div>
                            </div>
                        )}
                    </div>
                    {supplier.address && (
                        <div className="text-xs">
                            <div className="text-slate-500 dark:text-slate-400">Địa chỉ</div>
                            <div className="text-slate-900 dark:text-white">{supplier.address}</div>
                        </div>
                    )}
                </div>

                {/* Contact */}
                {(supplier.contact_person || supplier.email || supplier.phone) && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Liên hệ</h3>
                        {supplier.contact_person && (
                            <div className="text-xs">
                                <div className="text-slate-500 dark:text-slate-400">Người liên hệ</div>
                                <div className="text-slate-900 dark:text-white">{supplier.contact_person}</div>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            {supplier.email && (
                                <div>
                                    <div className="text-slate-500 dark:text-slate-400">Email</div>
                                    <div className="text-slate-900 dark:text-white">{supplier.email}</div>
                                </div>
                            )}
                            {supplier.phone && (
                                <div>
                                    <div className="text-slate-500 dark:text-slate-400">Điện thoại</div>
                                    <div className="text-slate-900 dark:text-white">{supplier.phone}</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Bank Info */}
                {supplier.bank_account_number && (
                    <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <CreditCard className="w-4 h-4" strokeWidth={1.5} />
                            Ngân hàng
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            {supplier.bank_name && (
                                <div>
                                    <div className="text-slate-500 dark:text-slate-400">Ngân hàng</div>
                                    <div className="text-slate-900 dark:text-white">{supplier.bank_name}</div>
                                </div>
                            )}
                            {supplier.bank_branch && (
                                <div>
                                    <div className="text-slate-500 dark:text-slate-400">Chi nhánh</div>
                                    <div className="text-slate-900 dark:text-white">{supplier.bank_branch}</div>
                                </div>
                            )}
                        </div>
                        <div className="text-xs">
                            <div className="text-slate-500 dark:text-slate-400">Số tài khoản</div>
                            <div className="font-mono font-medium text-slate-900 dark:text-white">{supplier.bank_account_number}</div>
                        </div>
                        {supplier.bank_account_name && (
                            <div className="text-xs">
                                <div className="text-slate-500 dark:text-slate-400">Tên tài khoản</div>
                                <div className="font-medium text-slate-900 dark:text-white">{supplier.bank_account_name}</div>
                            </div>
                        )}
                    </div>
                )}

                {/* Payment Terms */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Điều khoản thanh toán</h3>
                    <div className="text-xs">
                        <div className="text-slate-500 dark:text-slate-400">Số ngày</div>
                        <div className="text-slate-900 dark:text-white">
                            {supplier.payment_terms_days === 0 ? 'Tiền mặt' : `${supplier.payment_terms_days} ngày`}
                        </div>
                    </div>
                    {supplier.payment_terms_description && (
                        <div className="text-xs">
                            <div className="text-slate-500 dark:text-slate-400">Mô tả</div>
                            <div className="text-slate-900 dark:text-white">{supplier.payment_terms_description}</div>
                        </div>
                    )}
                    {supplier.credit_limit && (
                        <div className="text-xs">
                            <div className="text-slate-500 dark:text-slate-400">Hạn mức công nợ</div>
                            <div className="font-semibold text-slate-900 dark:text-white tabular-nums">
                                {supplier.credit_limit.toLocaleString('vi-VN')} {supplier.currency}
                            </div>
                        </div>
                    )}
                </div>

                {/* Notes */}
                {supplier.notes && (
                    <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ghi chú</h3>
                        <div className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{supplier.notes}</div>
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 flex gap-2">
                {canEdit && (
                    <button
                        onClick={onEdit}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition"
                    >
                        <Pencil className="w-4 h-4" strokeWidth={1.5} />
                        <span>Sửa</span>
                    </button>
                )}
                {canDelete && (
                    <>
                        {supplier.status === 'active' ? (
                            <button
                                onClick={() => {
                                    if (confirm(`Ngừng hoạt động nhà cung cấp "${supplier.name}"?`)) {
                                        onArchive();
                                    }
                                }}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                            >
                                <Archive className="w-4 h-4" strokeWidth={1.5} />
                                <span>Ngừng</span>
                            </button>
                        ) : (
                            <button
                                onClick={onRestore}
                                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition"
                            >
                                <ArchiveRestore className="w-4 h-4" strokeWidth={1.5} />
                                <span>Kích hoạt</span>
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default Suppliers;
