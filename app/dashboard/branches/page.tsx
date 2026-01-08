"use client";

import { useState, useEffect } from "react";
import {
    Plus, Edit, Trash2, X, Check, Loader2, Building2, Store,
    Clock, ChevronDown, ChevronRight, QrCode, RefreshCw
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
    getBranches,
    createBranch,
    updateBranch,
    deleteBranch,
    getShifts,
    createShift,
    updateShift,
    deleteShift,
    generateQRToken,
    Branch,
    Shift
} from "@/lib/api/timekeeping";

export default function BranchesPage() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [shifts, setShifts] = useState<Record<string, Shift[]>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [expandedBranch, setExpandedBranch] = useState<string | null>(null);

    // Branch form state
    const [isAddingBranch, setIsAddingBranch] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
    const [branchForm, setBranchForm] = useState({
        name: '',
        address: '',
        is_office: false,
        latitude: '',
        longitude: '',
        radius: '50'
    });

    // Shift form state
    const [isAddingShift, setIsAddingShift] = useState<string | null>(null);
    const [editingShift, setEditingShift] = useState<Shift | null>(null);
    const [shiftForm, setShiftForm] = useState({ name: '', start_time: '08:00', end_time: '17:00' });

    const [isSaving, setIsSaving] = useState(false);

    // QR Modal state
    const [qrBranch, setQrBranch] = useState<Branch | null>(null);
    const [isGeneratingQR, setIsGeneratingQR] = useState(false);

    // Confirmation dialogs
    const [confirmDeleteBranch, setConfirmDeleteBranch] = useState<{ open: boolean; branchId: string | null; branchName: string }>({
        open: false,
        branchId: null,
        branchName: ''
    });
    const [confirmDeleteShift, setConfirmDeleteShift] = useState<{ open: boolean; shiftId: string | null; branchId: string | null; shiftName: string }>({
        open: false,
        shiftId: null,
        branchId: null,
        shiftName: ''
    });

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const branchData = await getBranches();
            setBranches(branchData);

            // Fetch shifts for each branch
            const shiftsMap: Record<string, Shift[]> = {};
            for (const branch of branchData) {
                const branchShifts = await getShifts(branch.id);
                shiftsMap[branch.id] = branchShifts;
            }
            setShifts(shiftsMap);
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Branch CRUD
    const handleAddBranch = async () => {
        if (!branchForm.name.trim()) return;
        setIsSaving(true);
        try {
            await createBranch({
                name: branchForm.name,
                address: branchForm.address,
                is_office: branchForm.is_office,
                latitude: branchForm.latitude ? parseFloat(branchForm.latitude) : undefined,
                longitude: branchForm.longitude ? parseFloat(branchForm.longitude) : undefined,
                radius: branchForm.radius ? parseInt(branchForm.radius) : 50
            } as Parameters<typeof createBranch>[0]);
            await fetchData();
            setBranchForm({ name: '', address: '', is_office: false, latitude: '', longitude: '', radius: '50' });
            setIsAddingBranch(false);
        } catch (err) {
            console.error('Failed to add branch:', err);
            alert('Lỗi khi thêm chi nhánh.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdateBranch = async () => {
        if (!editingBranch || !branchForm.name.trim()) return;
        setIsSaving(true);
        try {
            await updateBranch(editingBranch.id, {
                name: branchForm.name,
                address: branchForm.address,
                is_office: branchForm.is_office,
                latitude: branchForm.latitude ? parseFloat(branchForm.latitude) : undefined,
                longitude: branchForm.longitude ? parseFloat(branchForm.longitude) : undefined,
                radius: branchForm.radius ? parseInt(branchForm.radius) : 50
            });
            await fetchData();
            setEditingBranch(null);
            setBranchForm({ name: '', address: '', is_office: false, latitude: '', longitude: '', radius: '50' });
        } catch (err) {
            console.error('Failed to update branch:', err);
            alert('Lỗi khi cập nhật chi nhánh.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteBranch = (id: string) => {
        const branch = branches.find(b => b.id === id);
        setConfirmDeleteBranch({
            open: true,
            branchId: id,
            branchName: branch?.name || 'chi nhánh này'
        });
    };

    const confirmDeleteBranchAction = async () => {
        if (!confirmDeleteBranch.branchId) return;
        try {
            await deleteBranch(confirmDeleteBranch.branchId);
            toast.success('Đã xóa chi nhánh');
            await fetchData();
            setConfirmDeleteBranch({ open: false, branchId: null, branchName: '' });
        } catch (err: unknown) {
            console.error('Failed to delete branch:', err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error('Lỗi khi xóa chi nhánh', {
                description: errorMsg
            });
        }
    };

    const startEditBranch = (branch: Branch) => {
        setEditingBranch(branch);
        setBranchForm({
            name: branch.name,
            address: branch.address || '',
            is_office: branch.is_office,
            latitude: branch.latitude?.toString() || '',
            longitude: branch.longitude?.toString() || '',
            radius: branch.radius?.toString() || '50'
        });
    };

    // QR Code functions
    const handleShowQR = (branch: Branch) => {
        setQrBranch(branch);
    };

    const handleGenerateNewQR = async () => {
        if (!qrBranch) return;
        setIsGeneratingQR(true);
        try {
            const updatedBranch = await generateQRToken(qrBranch.id);
            setQrBranch(updatedBranch);
            // Update in list too
            setBranches(prev => prev.map(b => b.id === updatedBranch.id ? updatedBranch : b));
        } catch (err) {
            console.error('Failed to generate QR:', err);
            alert('Lỗi khi tạo mã QR mới.');
        } finally {
            setIsGeneratingQR(false);
        }
    };

    // Shift CRUD
    const handleAddShift = async (branchId: string) => {
        if (!shiftForm.name.trim()) return;
        setIsSaving(true);
        try {
            await createShift({ ...shiftForm, branch_id: branchId });
            const newShifts = await getShifts(branchId);
            setShifts(prev => ({ ...prev, [branchId]: newShifts }));
            setShiftForm({ name: '', start_time: '08:00', end_time: '17:00' });
            setIsAddingShift(null);
        } catch (err) {
            console.error('Failed to add shift:', err);
            alert('Lỗi khi thêm ca làm việc.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleUpdateShift = async (branchId: string) => {
        if (!editingShift || !shiftForm.name.trim()) return;
        setIsSaving(true);
        try {
            await updateShift(editingShift.id, shiftForm);
            const newShifts = await getShifts(branchId);
            setShifts(prev => ({ ...prev, [branchId]: newShifts }));
            setEditingShift(null);
            setShiftForm({ name: '', start_time: '08:00', end_time: '17:00' });
        } catch (err) {
            console.error('Failed to update shift:', err);
            alert('Lỗi khi cập nhật ca làm việc.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteShift = (shiftId: string, branchId: string) => {
        const shift = shifts[branchId]?.find(s => s.id === shiftId);
        setConfirmDeleteShift({
            open: true,
            shiftId,
            branchId,
            shiftName: shift?.name || 'ca làm việc này'
        });
    };

    const confirmDeleteShiftAction = async () => {
        if (!confirmDeleteShift.shiftId || !confirmDeleteShift.branchId) return;
        try {
            await deleteShift(confirmDeleteShift.shiftId);
            const newShifts = await getShifts(confirmDeleteShift.branchId);
            setShifts(prev => ({ ...prev, [confirmDeleteShift.branchId!]: newShifts }));
            toast.success('Đã xóa ca làm việc');
            setConfirmDeleteShift({ open: false, shiftId: null, branchId: null, shiftName: '' });
        } catch (err: unknown) {
            console.error('Failed to delete shift:', err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error('Lỗi khi xóa ca làm việc', {
                description: errorMsg
            });
        }
    };

    const startEditShift = (shift: Shift) => {
        setEditingShift(shift);
        setShiftForm({
            name: shift.name,
            start_time: shift.start_time,
            end_time: shift.end_time
        });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải dữ liệu...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between animate-fade-in">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quản lý Chi nhánh</h1>
                    <p className="text-slate-500 mt-1">Cấu hình chi nhánh và ca làm việc</p>
                </div>
                <button
                    onClick={() => { setIsAddingBranch(true); setBranchForm({ name: '', address: '', is_office: false, latitude: '', longitude: '', radius: '50' }); }}
                    className="inline-flex items-center gap-2 px-5 py-2.5 gradient-primary text-white text-sm font-medium rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-xl hover:scale-105 transition-all duration-200"
                >
                    <Plus className="w-4 h-4" />
                    Thêm chi nhánh
                </button>
            </div>

            {/* Add/Edit Branch Modal */}
            {(isAddingBranch || editingBranch) && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { setIsAddingBranch(false); setEditingBranch(null); }} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
                        <h3 className="text-lg font-bold text-slate-900 mb-4">
                            {editingBranch ? 'Chỉnh sửa chi nhánh' : 'Thêm chi nhánh mới'}
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Tên chi nhánh *</label>
                                <input
                                    type="text"
                                    value={branchForm.name}
                                    onChange={e => setBranchForm({ ...branchForm, name: e.target.value })}
                                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                                    placeholder="VD: Chi nhánh Quận 1"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Địa chỉ</label>
                                <input
                                    type="text"
                                    value={branchForm.address}
                                    onChange={e => setBranchForm({ ...branchForm, address: e.target.value })}
                                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
                                    placeholder="VD: 123 Nguyễn Huệ, Q.1, TP.HCM"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Loại chi nhánh</label>
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            checked={!branchForm.is_office}
                                            onChange={() => setBranchForm({ ...branchForm, is_office: false })}
                                            className="w-4 h-4 text-blue-600"
                                        />
                                        <Store className="w-4 h-4 text-slate-500" />
                                        <span className="text-sm">Cửa hàng (lương giờ)</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            checked={branchForm.is_office}
                                            onChange={() => setBranchForm({ ...branchForm, is_office: true })}
                                            className="w-4 h-4 text-blue-600"
                                        />
                                        <Building2 className="w-4 h-4 text-slate-500" />
                                        <span className="text-sm">Văn phòng (lương tháng)</span>
                                    </label>
                                </div>
                            </div>

                            {/* GPS Location Fields */}
                            <div className="border-t border-slate-100 pt-4 mt-4">
                                <div className="flex items-center justify-between mb-3">
                                    <label className="text-sm font-medium text-slate-700">📍 Vị trí GPS (Bảo mật chấm công)</label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (navigator.geolocation) {
                                                navigator.geolocation.getCurrentPosition(
                                                    (pos) => {
                                                        setBranchForm({
                                                            ...branchForm,
                                                            latitude: pos.coords.latitude.toFixed(6),
                                                            longitude: pos.coords.longitude.toFixed(6)
                                                        });
                                                    },
                                                    (err) => alert('Không thể lấy vị trí: ' + err.message)
                                                );
                                            } else {
                                                alert('Trình duyệt không hỗ trợ GPS');
                                            }
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                    >
                                        Lấy vị trí hiện tại
                                    </button>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Vĩ độ (Latitude)</label>
                                        <input
                                            type="text"
                                            value={branchForm.latitude}
                                            onChange={e => setBranchForm({ ...branchForm, latitude: e.target.value })}
                                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                                            placeholder="10.7769"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Kinh độ (Longitude)</label>
                                        <input
                                            type="text"
                                            value={branchForm.longitude}
                                            onChange={e => setBranchForm({ ...branchForm, longitude: e.target.value })}
                                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                                            placeholder="106.7009"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Bán kính (m)</label>
                                        <input
                                            type="number"
                                            value={branchForm.radius}
                                            onChange={e => setBranchForm({ ...branchForm, radius: e.target.value })}
                                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                                            placeholder="50"
                                        />
                                    </div>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    Nhân viên phải ở trong bán kính {branchForm.radius || 50}m để chấm công
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => { setIsAddingBranch(false); setEditingBranch(null); }}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={editingBranch ? handleUpdateBranch : handleAddBranch}
                                disabled={isSaving || !branchForm.name.trim()}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                {editingBranch ? 'Cập nhật' : 'Thêm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Branch List */}
            <div className="space-y-4">
                {branches.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                        <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500">Chưa có chi nhánh nào. Hãy thêm chi nhánh đầu tiên!</p>
                    </div>
                ) : (
                    branches.map((branch, idx) => (
                        <div
                            key={branch.id}
                            className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up"
                            style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'forwards' }}
                        >
                            {/* Branch Header */}
                            <div
                                className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                                onClick={() => setExpandedBranch(expandedBranch === branch.id ? null : branch.id)}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "p-3 rounded-xl",
                                        branch.is_office ? "bg-blue-50" : "bg-amber-50"
                                    )}>
                                        {branch.is_office ? (
                                            <Building2 className="w-5 h-5 text-blue-600" />
                                        ) : (
                                            <Store className="w-5 h-5 text-amber-600" />
                                        )}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-slate-900">{branch.name}</h3>
                                        <p className="text-sm text-slate-500">{branch.address || 'Chưa có địa chỉ'}</p>
                                    </div>
                                    <span className={cn(
                                        "px-2.5 py-1 text-xs font-medium rounded-full",
                                        branch.is_office
                                            ? "bg-blue-100 text-blue-700"
                                            : "bg-amber-100 text-amber-700"
                                    )}>
                                        {branch.is_office ? 'Văn phòng' : 'Cửa hàng'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-slate-500">
                                        {shifts[branch.id]?.length || 0} ca làm
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleShowQR(branch); }}
                                        className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                        title="Hiển thị mã QR"
                                    >
                                        <QrCode className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); startEditBranch(branch); }}
                                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    >
                                        <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteBranch(branch.id); }}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                    {expandedBranch === branch.id ? (
                                        <ChevronDown className="w-5 h-5 text-slate-400" />
                                    ) : (
                                        <ChevronRight className="w-5 h-5 text-slate-400" />
                                    )}
                                </div>
                            </div>

                            {/* Shifts Section (Expandable) */}
                            {expandedBranch === branch.id && (
                                <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 animate-fade-in">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                            <Clock className="w-4 h-4" />
                                            Ca làm việc
                                        </h4>
                                        <button
                                            onClick={() => { setIsAddingShift(branch.id); setShiftForm({ name: '', start_time: '08:00', end_time: '17:00' }); }}
                                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        >
                                            <Plus className="w-3 h-3" />
                                            Thêm ca
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        {/* Add Shift Form */}
                                        {isAddingShift === branch.id && (
                                            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                                                <div className="grid grid-cols-3 gap-3">
                                                    <input
                                                        type="text"
                                                        value={shiftForm.name}
                                                        onChange={e => setShiftForm({ ...shiftForm, name: e.target.value })}
                                                        placeholder="Tên ca"
                                                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                                                    />
                                                    <input
                                                        type="time"
                                                        value={shiftForm.start_time}
                                                        onChange={e => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                                                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                                                    />
                                                    <input
                                                        type="time"
                                                        value={shiftForm.end_time}
                                                        onChange={e => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                                                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                                                    />
                                                </div>
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => setIsAddingShift(null)}
                                                        className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                                                    >
                                                        Hủy
                                                    </button>
                                                    <button
                                                        onClick={() => handleAddShift(branch.id)}
                                                        disabled={isSaving || !shiftForm.name.trim()}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                                                    >
                                                        {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                                                        Lưu
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Shift List */}
                                        {shifts[branch.id]?.length === 0 ? (
                                            <p className="text-sm text-slate-400 italic">Chưa có ca làm việc.</p>
                                        ) : (
                                            shifts[branch.id]?.map(shift => (
                                                <div
                                                    key={shift.id}
                                                    className="group flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3"
                                                >
                                                    {editingShift?.id === shift.id ? (
                                                        <div className="flex-1 flex items-center gap-3">
                                                            <input
                                                                type="text"
                                                                value={shiftForm.name}
                                                                onChange={e => setShiftForm({ ...shiftForm, name: e.target.value })}
                                                                className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                                                            />
                                                            <input
                                                                type="time"
                                                                value={shiftForm.start_time}
                                                                onChange={e => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                                                                className="w-28 px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                                                            />
                                                            <input
                                                                type="time"
                                                                value={shiftForm.end_time}
                                                                onChange={e => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                                                                className="w-28 px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
                                                            />
                                                            <button
                                                                onClick={() => handleUpdateShift(branch.id)}
                                                                disabled={isSaving}
                                                                className="p-1.5 text-green-600 hover:bg-green-50 rounded-md"
                                                            >
                                                                <Check className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => setEditingShift(null)}
                                                                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-md"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex items-center gap-4">
                                                                <div className="p-2 bg-slate-100 rounded-lg">
                                                                    <Clock className="w-4 h-4 text-slate-500" />
                                                                </div>
                                                                <div>
                                                                    <p className="text-sm font-medium text-slate-900">{shift.name}</p>
                                                                    <p className="text-xs text-slate-500">
                                                                        {shift.start_time} - {shift.end_time}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={() => startEditShift(shift)}
                                                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                                                                >
                                                                    <Edit className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteShift(shift.id, branch.id)}
                                                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* QR Code Modal */}
            {qrBranch && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setQrBranch(null)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
                        <button
                            onClick={() => setQrBranch(null)}
                            className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <h3 className="text-lg font-bold text-slate-900 mb-2 text-center">
                            Mã QR Chấm công
                        </h3>
                        <p className="text-sm text-slate-500 text-center mb-6">
                            {qrBranch.name}
                        </p>

                        <div className="flex justify-center mb-6">
                            {qrBranch.qr_token ? (
                                <div className="p-4 bg-white border-2 border-slate-200 rounded-xl">
                                    <QRCodeSVG
                                        value={qrBranch.qr_token}
                                        size={200}
                                        level="H"
                                        includeMargin={true}
                                    />
                                </div>
                            ) : (
                                <div className="w-[200px] h-[200px] bg-slate-100 rounded-xl flex items-center justify-center">
                                    <p className="text-sm text-slate-400 text-center px-4">
                                        Chưa có mã QR.<br />Nhấn &quot;Tạo mã mới&quot; để tạo.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-center gap-3">
                            <button
                                onClick={handleGenerateNewQR}
                                disabled={isGeneratingQR}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {isGeneratingQR ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="w-4 h-4" />
                                )}
                                Tạo mã mới
                            </button>
                            {qrBranch.qr_token && (
                                <button
                                    onClick={() => window.print()}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                                >
                                    In mã QR
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Branch Confirmation */}
            <ConfirmDialog
                open={confirmDeleteBranch.open}
                onOpenChange={(open) => setConfirmDeleteBranch({ ...confirmDeleteBranch, open })}
                title="Xóa chi nhánh?"
                description={`Bạn sẽ xóa chi nhánh "${confirmDeleteBranch.branchName}". Tất cả ca làm việc sẽ bị xóa theo. Hành động này không thể hoàn tác.`}
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteBranchAction}
            />

            {/* Delete Shift Confirmation */}
            <ConfirmDialog
                open={confirmDeleteShift.open}
                onOpenChange={(open) => setConfirmDeleteShift({ ...confirmDeleteShift, open })}
                title="Xóa ca làm việc?"
                description={`Bạn sẽ xóa ca làm việc "${confirmDeleteShift.shiftName}". Hành động này không thể hoàn tác.`}
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteShiftAction}
            />
        </div>
    );
}
