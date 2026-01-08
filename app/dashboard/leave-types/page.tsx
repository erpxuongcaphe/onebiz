"use client";

import { useState, useEffect } from "react";
import {
    Calendar,
    Plus,
    Pencil,
    Trash2,
    X,
    Loader2,
    Check,
    AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
    getAllLeaveTypes,
    createLeaveType,
    updateLeaveType,
    deleteLeaveType,
    type LeaveType,
} from "@/lib/api/leave-management";

// Color options for leave types
const colorOptions = [
    "#3b82f6", // blue
    "#10b981", // green
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#14b8a6", // teal
    "#6366f1", // indigo
    "#f97316", // orange
    "#84cc16", // lime
];

export default function LeaveTypesPage() {
    const { user } = useAuth();
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingType, setEditingType] = useState<LeaveType | null>(null);
    const [processing, setProcessing] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; leaveType: LeaveType | null }>({ open: false, leaveType: null });

    const [form, setForm] = useState({
        name: "",
        description: "",
        color: "#3b82f6",
        default_days_per_year: 12,
        is_paid: true,
        requires_approval: true,
        is_active: true,
    });

    const isAdmin = user?.role === "admin";

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const data = await getAllLeaveTypes();
            setLeaveTypes(data);
        } catch (error) {
            console.error("Error loading leave types:", error);
        } finally {
            setLoading(false);
        }
    }

    function openCreateModal() {
        setEditingType(null);
        setForm({
            name: "",
            description: "",
            color: "#3b82f6",
            default_days_per_year: 12,
            is_paid: true,
            requires_approval: true,
            is_active: true,
        });
        setShowModal(true);
    }

    function openEditModal(leaveType: LeaveType) {
        setEditingType(leaveType);
        setForm({
            name: leaveType.name,
            description: leaveType.description || "",
            color: leaveType.color || "#3b82f6",
            default_days_per_year: leaveType.default_days_per_year,
            is_paid: leaveType.is_paid,
            requires_approval: leaveType.requires_approval,
            is_active: leaveType.is_active,
        });
        setShowModal(true);
    }

    async function handleSubmit() {
        if (!form.name.trim()) {
            toast.error("Vui lòng nhập tên loại nghỉ phép");
            return;
        }

        setProcessing(true);
        try {
            if (editingType) {
                await updateLeaveType(editingType.id, form);
            } else {
                await createLeaveType(form);
            }
            setShowModal(false);
            toast.success(editingType ? "Đã cập nhật loại nghỉ phép" : "Đã thêm loại nghỉ phép mới");
            loadData();
        } catch (error) {
            console.error("Error saving leave type:", error);
            toast.error("Có lỗi xảy ra khi lưu");
        } finally {
            setProcessing(false);
        }
    }

    function handleDelete(leaveType: LeaveType) {
        setConfirmDelete({ open: true, leaveType });
    }

    async function confirmDeleteAction() {
        if (!confirmDelete.leaveType) return;
        try {
            await deleteLeaveType(confirmDelete.leaveType.id);
            toast.success("Đã xóa loại nghỉ phép");
            loadData();
            setConfirmDelete({ open: false, leaveType: null });
        } catch (error) {
            console.error("Error deleting leave type:", error);
            toast.error("Không thể xóa", {
                description: "Loại nghỉ phép này có thể đang được sử dụng."
            });
        }
    }

    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-64 text-slate-500">
                <AlertCircle className="w-6 h-6 mr-2" />
                Bạn không có quyền truy cập trang này
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                        Quản lý loại nghỉ phép
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Cấu hình các loại nghỉ phép và số ngày mặc định
                    </p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/25"
                >
                    <Plus className="w-4 h-4" />
                    Thêm loại mới
                </button>
            </div>

            {/* Leave Types Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {leaveTypes.map((type) => (
                    <div
                        key={type.id}
                        className={cn(
                            "bg-white rounded-xl border border-slate-200 p-4 shadow-sm transition-all hover:shadow-md",
                            !type.is_active && "opacity-60"
                        )}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <div
                                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                                    style={{ backgroundColor: `${type.color}20` }}
                                >
                                    <Calendar
                                        className="w-5 h-5"
                                        style={{ color: type.color }}
                                    />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">
                                        {type.name}
                                    </h3>
                                    {!type.is_active && (
                                        <span className="text-xs text-red-500">
                                            (Không hoạt động)
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => openEditModal(type)}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                    <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(type)}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {type.description && (
                            <p className="text-sm text-slate-500 mb-3 line-clamp-2">
                                {type.description}
                            </p>
                        )}

                        <div className="flex flex-wrap gap-2 text-xs">
                            <span
                                className="px-2 py-1 rounded-full font-medium"
                                style={{
                                    backgroundColor: `${type.color}15`,
                                    color: type.color,
                                }}
                            >
                                {type.default_days_per_year} ngày/năm
                            </span>
                            <span
                                className={cn(
                                    "px-2 py-1 rounded-full",
                                    type.is_paid
                                        ? "bg-green-100 text-green-700"
                                        : "bg-slate-100 text-slate-600"
                                )}
                            >
                                {type.is_paid ? "Có lương" : "Không lương"}
                            </span>
                            {type.requires_approval && (
                                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                                    Cần duyệt
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {leaveTypes.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                    <Calendar className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p>Chưa có loại nghỉ phép nào</p>
                </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-slate-900">
                                {editingType ? "Sửa loại nghỉ phép" : "Thêm loại nghỉ phép"}
                            </h2>
                            <button
                                onClick={() => setShowModal(false)}
                                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Tên loại nghỉ phép <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) =>
                                        setForm({ ...form, name: e.target.value })
                                    }
                                    placeholder="VD: Nghỉ phép năm"
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                />
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Mô tả
                                </label>
                                <textarea
                                    value={form.description}
                                    onChange={(e) =>
                                        setForm({ ...form, description: e.target.value })
                                    }
                                    rows={2}
                                    placeholder="Mô tả ngắn về loại nghỉ phép..."
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                                />
                            </div>

                            {/* Default Days */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Số ngày mặc định/năm <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    max={365}
                                    value={form.default_days_per_year}
                                    onChange={(e) =>
                                        setForm({
                                            ...form,
                                            default_days_per_year: parseInt(e.target.value) || 0,
                                        })
                                    }
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Số ngày nghỉ phép tối đa cho nhân viên mỗi năm
                                </p>
                            </div>

                            {/* Color */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Màu hiển thị
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {colorOptions.map((color) => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => setForm({ ...form, color })}
                                            className={cn(
                                                "w-8 h-8 rounded-lg transition-all",
                                                form.color === color
                                                    ? "ring-2 ring-offset-2 ring-blue-500 scale-110"
                                                    : "hover:scale-105"
                                            )}
                                            style={{ backgroundColor: color }}
                                        >
                                            {form.color === color && (
                                                <Check className="w-4 h-4 text-white mx-auto" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Options */}
                            <div className="space-y-3">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.is_paid}
                                        onChange={(e) =>
                                            setForm({ ...form, is_paid: e.target.checked })
                                        }
                                        className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">
                                        Nghỉ có lương
                                    </span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.requires_approval}
                                        onChange={(e) =>
                                            setForm({ ...form, requires_approval: e.target.checked })
                                        }
                                        className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">
                                        Yêu cầu phê duyệt
                                    </span>
                                </label>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={form.is_active}
                                        onChange={(e) =>
                                            setForm({ ...form, is_active: e.target.checked })
                                        }
                                        className="w-4 h-4 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">
                                        Đang hoạt động
                                    </span>
                                </label>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={processing}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {processing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Đang lưu...
                                    </>
                                ) : (
                                    <>
                                        <Check className="w-4 h-4" />
                                        {editingType ? "Cập nhật" : "Thêm mới"}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                open={confirmDelete.open}
                onOpenChange={(open) => setConfirmDelete({ ...confirmDelete, open })}
                title="Xóa loại nghỉ phép?"
                description={'Bạn sẽ xóa loại nghỉ phép "' + (confirmDelete.leaveType?.name || '') + '". Hành động này không thể hoàn tác.'}
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteAction}
            />
        </div>
    );
}
