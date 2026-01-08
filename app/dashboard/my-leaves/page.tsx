"use client";

import { useState, useEffect } from "react";
import {
    Calendar,
    Plus,
    Clock,
    CheckCircle,
    XCircle,
    CalendarDays,
    ChevronRight,
    X,
    AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
    getLeaveRequests,
    getLeaveTypes,
    getLeaveBalances,
    createLeaveRequest,
    cancelLeaveRequest,
    calculateLeaveDays,
    getStatusLabel,
    getStatusColor,
    type LeaveRequest,
    type LeaveType,
    type LeaveBalance,
} from "@/lib/api/leave-management";

export default function MyLeavesPage() {
    const { user } = useAuth();
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [processing, setProcessing] = useState(false);

    // Form state
    const [form, setForm] = useState({
        leaveTypeId: "",
        startDate: "",
        endDate: "",
        isHalfDay: false,
        halfDayPeriod: "morning" as "morning" | "afternoon",
        reason: "",
    });
    const [formErrors, setFormErrors] = useState<Record<string, string>>({});
    const [confirmCancelLeave, setConfirmCancelLeave] = useState<{ open: boolean; request: LeaveRequest | null }>({ open: false, request: null });

    const currentYear = new Date().getFullYear();

    useEffect(() => {
        if (user?.employeeId) {
            loadData();
        }
    }, [user?.employeeId]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadData() {
        if (!user?.employeeId) return;
        try {
            setLoading(true);
            const [requestsData, typesData, balancesData] = await Promise.all([
                getLeaveRequests({ employeeId: user.employeeId }),
                getLeaveTypes(),
                getLeaveBalances(user.employeeId, currentYear),
            ]);
            setRequests(requestsData);
            setLeaveTypes(typesData);
            setBalances(balancesData);
        } catch (error) {
            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
        }
    }

    function validateForm() {
        const errors: Record<string, string> = {};
        if (!form.leaveTypeId) errors.leaveTypeId = "Vui lòng chọn loại nghỉ phép";
        if (!form.startDate) errors.startDate = "Vui lòng chọn ngày bắt đầu";
        if (!form.endDate) errors.endDate = "Vui lòng chọn ngày kết thúc";
        if (form.startDate && form.endDate && form.startDate > form.endDate) {
            errors.endDate = "Ngày kết thúc phải sau ngày bắt đầu";
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }

    async function handleSubmit() {
        if (!user?.employeeId || !validateForm()) return;

        try {
            setProcessing(true);
            const totalDays = calculateLeaveDays(form.startDate, form.endDate, form.isHalfDay);

            await createLeaveRequest({
                employee_id: user.employeeId,
                leave_type_id: form.leaveTypeId,
                start_date: form.startDate,
                end_date: form.endDate,
                total_days: totalDays,
                is_half_day: form.isHalfDay,
                half_day_period: form.isHalfDay ? form.halfDayPeriod : undefined,
                reason: form.reason || undefined,
            });

            await loadData();
            setShowCreateModal(false);
            resetForm();
        } catch (error) {
            console.error("Failed to create request:", error);
        } finally {
            setProcessing(false);
        }
    }

    async function handleCancel(request: LeaveRequest) {
        setConfirmCancelLeave({ open: true, request });
    }

    async function confirmCancelLeaveAction() {
        if (!confirmCancelLeave.request) return;
        try {
            await cancelLeaveRequest(confirmCancelLeave.request.id);
            toast.success('Đã hủy đơn nghỉ phép');
            await loadData();
            setConfirmCancelLeave({ open: false, request: null });
        } catch (error) {
            console.error("Failed to cancel:", error);
            toast.error('Lỗi khi hủy đơn');
        }
    }

    function resetForm() {
        setForm({
            leaveTypeId: "",
            startDate: "",
            endDate: "",
            isHalfDay: false,
            halfDayPeriod: "morning",
            reason: "",
        });
        setFormErrors({});
    }

    function formatDate(dateStr: string) {
        return new Date(dateStr).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }

    // Calculate days preview
    const previewDays =
        form.startDate && form.endDate
            ? calculateLeaveDays(form.startDate, form.endDate, form.isHalfDay)
            : 0;

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    if (!user?.employeeId) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
                <AlertCircle className="w-16 h-16 text-amber-500 mb-4" />
                <h2 className="text-xl font-semibold text-slate-900 mb-2">
                    Chưa liên kết nhân viên
                </h2>
                <p className="text-slate-500">
                    Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.
                    Vui lòng liên hệ quản trị viên.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                        Nghỉ phép của tôi
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Quản lý đơn xin nghỉ phép cá nhân
                    </p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/25"
                >
                    <Plus className="w-4 h-4" />
                    Tạo đơn nghỉ phép
                </button>
            </div>

            {/* Balance Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {balances.length > 0 ? (
                    balances.slice(0, 4).map((balance) => {
                        const remaining = balance.total_days - balance.used_days - balance.pending_days;
                        const percentage = (balance.used_days / balance.total_days) * 100;
                        return (
                            <div
                                key={balance.id}
                                className="bg-white rounded-xl border border-slate-200 p-3 md:p-4 shadow-sm"
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <div
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: balance.leave_type?.color || "#3B82F6" }}
                                    />
                                    <span className="text-xs font-medium text-slate-600 truncate">
                                        {balance.leave_type?.name}
                                    </span>
                                </div>
                                <div className="text-2xl font-bold text-slate-900 mb-1">
                                    {remaining}
                                    <span className="text-sm font-normal text-slate-400 ml-1">
                                        / {balance.total_days}
                                    </span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full transition-all"
                                        style={{
                                            width: `${Math.min(percentage, 100)}%`,
                                            backgroundColor: balance.leave_type?.color || "#3B82F6",
                                        }}
                                    />
                                </div>
                                {balance.pending_days > 0 && (
                                    <p className="text-xs text-amber-600 mt-1">
                                        {balance.pending_days} ngày chờ duyệt
                                    </p>
                                )}
                            </div>
                        );
                    })
                ) : (
                    <div className="col-span-full bg-white rounded-xl border border-slate-200 p-6 text-center">
                        <p className="text-slate-500">Chưa có dữ liệu ngày phép</p>
                    </div>
                )}
            </div>

            {/* Requests List */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-900">Lịch sử nghỉ phép</h3>
                </div>

                {requests.length === 0 ? (
                    <div className="p-8 text-center">
                        <CalendarDays className="w-12 h-12 mx-auto text-slate-300 mb-2" />
                        <p className="text-slate-500">Bạn chưa có đơn nghỉ phép nào</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {requests.map((request) => (
                            <div
                                key={request.id}
                                className="p-4 hover:bg-slate-50 transition-colors"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        {/* Leave Type Badge */}
                                        <span
                                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium mb-2"
                                            style={{
                                                backgroundColor: `${request.leave_type?.color}20`,
                                                color: request.leave_type?.color,
                                            }}
                                        >
                                            <span
                                                className="w-2 h-2 rounded-full"
                                                style={{ backgroundColor: request.leave_type?.color }}
                                            />
                                            {request.leave_type?.name}
                                        </span>

                                        {/* Date Range */}
                                        <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
                                            <Calendar className="w-4 h-4 text-slate-400" />
                                            <span>
                                                {formatDate(request.start_date)}
                                                {request.start_date !== request.end_date && (
                                                    <> - {formatDate(request.end_date)}</>
                                                )}
                                            </span>
                                            <span className="text-slate-400">•</span>
                                            <span className="font-medium">{request.total_days} ngày</span>
                                        </div>

                                        {/* Reason */}
                                        {request.reason && (
                                            <p className="text-sm text-slate-500 truncate">
                                                {request.reason}
                                            </p>
                                        )}

                                        {/* Review Note */}
                                        {request.review_note && request.status !== "pending" && (
                                            <p className="text-xs text-slate-400 mt-1 italic">
                                                Ghi chú: {request.review_note}
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex flex-col items-end gap-2">
                                        <span
                                            className={cn(
                                                "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                                                getStatusColor(request.status)
                                            )}
                                        >
                                            {request.status === "approved" && (
                                                <CheckCircle className="w-3 h-3" />
                                            )}
                                            {request.status === "rejected" && (
                                                <XCircle className="w-3 h-3" />
                                            )}
                                            {request.status === "pending" && (
                                                <Clock className="w-3 h-3" />
                                            )}
                                            {getStatusLabel(request.status)}
                                        </span>

                                        {request.status === "pending" && (
                                            <button
                                                onClick={() => handleCancel(request)}
                                                className="text-xs text-red-600 hover:text-red-700"
                                            >
                                                Hủy đơn
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
                    <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-auto">
                        {/* Header */}
                        <div className="sticky top-0 bg-white px-4 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-slate-900">
                                Tạo đơn nghỉ phép
                            </h3>
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    resetForm();
                                }}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        {/* Form */}
                        <div className="p-4 sm:p-6 space-y-4">
                            {/* Leave Type */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Loại nghỉ phép <span className="text-red-500">*</span>
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {leaveTypes.map((type) => (
                                        <button
                                            key={type.id}
                                            type="button"
                                            onClick={() =>
                                                setForm({ ...form, leaveTypeId: type.id })
                                            }
                                            className={cn(
                                                "flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-left",
                                                form.leaveTypeId === type.id
                                                    ? "border-blue-500 bg-blue-50"
                                                    : "border-slate-200 hover:border-slate-300"
                                            )}
                                        >
                                            <div
                                                className="w-3 h-3 rounded-full shrink-0"
                                                style={{ backgroundColor: type.color }}
                                            />
                                            <span className="text-sm font-medium text-slate-700 truncate">
                                                {type.name}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                                {formErrors.leaveTypeId && (
                                    <p className="text-xs text-red-500 mt-1">{formErrors.leaveTypeId}</p>
                                )}
                            </div>

                            {/* Date Range */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Từ ngày <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={form.startDate}
                                        onChange={(e) =>
                                            setForm({ ...form, startDate: e.target.value })
                                        }
                                        min={new Date().toISOString().split("T")[0]}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    {formErrors.startDate && (
                                        <p className="text-xs text-red-500 mt-1">{formErrors.startDate}</p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Đến ngày <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={form.endDate}
                                        onChange={(e) =>
                                            setForm({ ...form, endDate: e.target.value })
                                        }
                                        min={form.startDate || new Date().toISOString().split("T")[0]}
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    {formErrors.endDate && (
                                        <p className="text-xs text-red-500 mt-1">{formErrors.endDate}</p>
                                    )}
                                </div>
                            </div>

                            {/* Half Day Toggle */}
                            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                                <input
                                    type="checkbox"
                                    id="halfDay"
                                    checked={form.isHalfDay}
                                    onChange={(e) =>
                                        setForm({ ...form, isHalfDay: e.target.checked })
                                    }
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="halfDay" className="text-sm text-slate-700 flex-1">
                                    Nghỉ nửa ngày
                                </label>
                                {form.isHalfDay && (
                                    <select
                                        value={form.halfDayPeriod}
                                        onChange={(e) =>
                                            setForm({
                                                ...form,
                                                halfDayPeriod: e.target.value as "morning" | "afternoon",
                                            })
                                        }
                                        className="px-2 py-1 text-sm border border-slate-200 rounded-lg"
                                    >
                                        <option value="morning">Buổi sáng</option>
                                        <option value="afternoon">Buổi chiều</option>
                                    </select>
                                )}
                            </div>

                            {/* Days Preview */}
                            {previewDays > 0 && (
                                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl">
                                    <span className="text-sm text-blue-700">Số ngày nghỉ:</span>
                                    <span className="text-lg font-bold text-blue-700">
                                        {previewDays} ngày
                                    </span>
                                </div>
                            )}

                            {/* Reason */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    Lý do
                                </label>
                                <textarea
                                    value={form.reason}
                                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                                    placeholder="Nhập lý do nghỉ phép (không bắt buộc)..."
                                    rows={3}
                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="sticky bottom-0 bg-white px-4 sm:px-6 py-4 border-t border-slate-100 flex gap-3">
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    resetForm();
                                }}
                                className="flex-1 px-4 py-2.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl font-medium transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={processing}
                                className="flex-1 px-4 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {processing ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Đang gửi...
                                    </>
                                ) : (
                                    <>
                                        <ChevronRight className="w-4 h-4" />
                                        Gửi đơn
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel Leave Request Confirmation */}
            <ConfirmDialog
                open={confirmCancelLeave.open}
                onOpenChange={(open) => setConfirmCancelLeave({ ...confirmCancelLeave, open })}
                title="Hủy đơn nghỉ phép?"
                description="Bạn có chắc muốn hủy đơn nghỉ phép này? Hành động này không thể hoàn tác."
                confirmText="Hủy đơn"
                cancelText="Quay lại"
                variant="destructive"
                onConfirm={confirmCancelLeaveAction}
            />
        </div>
    );
}
