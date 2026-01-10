"use client";

import { useState, useEffect } from "react";
import {
    Calendar,
    Plus,
    Clock,
    CalendarDays,
    ChevronRight,
    X,
    AlertCircle,
    Loader2,
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

// Component for My Leaves - can be used as tab or standalone
export function MyLeavesContent() {
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
        setLoading(true);
        try {
            const [requestsData, typesData, balancesData] = await Promise.all([
                getLeaveRequests({ employeeId: user.employeeId }),
                getLeaveTypes(),
                getLeaveBalances(user.employeeId, currentYear),
            ]);
            setRequests(requestsData);
            setLeaveTypes(typesData);
            setBalances(balancesData);
        } catch (error) {
            console.error("Error loading leave data:", error);
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
        if (!form.reason.trim()) errors.reason = "Vui lòng nhập lý do";
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    }

    async function handleSubmit() {
        if (!validateForm() || !user?.employeeId) return;
        setProcessing(true);
        try {
            await createLeaveRequest({
                employee_id: user.employeeId,
                leave_type_id: form.leaveTypeId,
                start_date: form.startDate,
                end_date: form.endDate,
                total_days: calculateLeaveDays(form.startDate, form.endDate, form.isHalfDay),
                is_half_day: form.isHalfDay,
                half_day_period: form.isHalfDay ? form.halfDayPeriod : undefined,
                reason: form.reason,
            });
            setShowCreateModal(false);
            resetForm();
            loadData();
        } catch (error) {
            console.error("Error creating leave request:", error);
            alert("Có lỗi xảy ra khi tạo đơn nghỉ phép");
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
            loadData();
            setConfirmCancelLeave({ open: false, request: null });
        } catch (error) {
            console.error("Error cancelling request:", error);
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

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Leave Balances */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {leaveTypes.map((type) => {
                    const balance = balances.find((b) => b.leave_type_id === type.id);
                    const used = balance?.used_days || 0;
                    const total = balance?.total_days || type.default_days_per_year;
                    const remaining = total - used;
                    const percentage = total > 0 ? (used / total) * 100 : 0;

                    return (
                        <div
                            key={type.id}
                            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
                        >
                            <div className="flex items-center gap-2 mb-2">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: type.color || "#3b82f6" }}
                                />
                                <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                                    {type.name}
                                </span>
                            </div>
                            <div className="text-2xl font-bold text-slate-900 dark:text-white">
                                {remaining}{" "}
                                <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                                    / {total} ngày
                                </span>
                            </div>
                            <div className="mt-2 h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: `${percentage}%`,
                                        backgroundColor: type.color || "#3b82f6",
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Action Button */}
            <div className="flex justify-between items-center">
                <h3 className="font-semibold text-slate-900 dark:text-white">Lịch sử nghỉ phép</h3>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition"
                >
                    <Plus className="w-4 h-4" />
                    Tạo đơn nghỉ phép
                </button>
            </div>

            {/* Requests List */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {requests.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                        <Calendar className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                        <p>Chưa có đơn nghỉ phép nào</p>
                    </div>
                ) : (
                    requests.map((request) => {
                        const leaveType = leaveTypes.find(
                            (t) => t.id === request.leave_type_id
                        );
                        const days = calculateLeaveDays(
                            request.start_date,
                            request.end_date,
                            request.is_half_day
                        );

                        return (
                            <div
                                key={request.id}
                                className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                            >
                                <div className="flex items-center gap-4">
                                    <div
                                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                                        style={{
                                            backgroundColor: `${leaveType?.color || "#3b82f6"}20`,
                                        }}
                                    >
                                        <CalendarDays
                                            className="w-5 h-5"
                                            style={{ color: leaveType?.color || "#3b82f6" }}
                                        />
                                    </div>
                                    <div>
                                        <div className="font-medium text-slate-900 dark:text-white">
                                            {leaveType?.name || "Nghỉ phép"}
                                        </div>
                                        <div className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                            <span>{formatDate(request.start_date)}</span>
                                            {request.start_date !== request.end_date && (
                                                <>
                                                    <ChevronRight className="w-4 h-4" />
                                                    <span>{formatDate(request.end_date)}</span>
                                                </>
                                            )}
                                            <span className="text-slate-400">•</span>
                                            <span>{days} ngày</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span
                                        className={cn(
                                            "px-3 py-1 text-xs font-medium rounded-full",
                                            getStatusColor(request.status)
                                        )}
                                    >
                                        {getStatusLabel(request.status)}
                                    </span>
                                    {request.status === "pending" && (
                                        <button
                                            onClick={() => handleCancel(request)}
                                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                                Tạo đơn nghỉ phép
                            </h2>
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    resetForm();
                                }}
                                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* Leave Type */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Loại nghỉ phép <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={form.leaveTypeId}
                                    onChange={(e) =>
                                        setForm({ ...form, leaveTypeId: e.target.value })
                                    }
                                    className={cn(
                                        "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white",
                                        formErrors.leaveTypeId
                                            ? "border-red-300 dark:border-red-500/50"
                                            : "border-slate-200 dark:border-slate-600"
                                    )}
                                >
                                    <option value="">Chọn loại nghỉ phép</option>
                                    {leaveTypes.map((type) => (
                                        <option key={type.id} value={type.id}>
                                            {type.name}
                                        </option>
                                    ))}
                                </select>
                                {formErrors.leaveTypeId && (
                                    <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        {formErrors.leaveTypeId}
                                    </p>
                                )}
                            </div>

                            {/* Dates */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Từ ngày <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={form.startDate}
                                        onChange={(e) =>
                                            setForm({ ...form, startDate: e.target.value })
                                        }
                                        className={cn(
                                            "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white",
                                            formErrors.startDate
                                                ? "border-red-300 dark:border-red-500/50"
                                                : "border-slate-200 dark:border-slate-600"
                                        )}
                                    />
                                    {formErrors.startDate && (
                                        <p className="mt-1 text-xs text-red-500">
                                            {formErrors.startDate}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                        Đến ngày <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={form.endDate}
                                        onChange={(e) =>
                                            setForm({ ...form, endDate: e.target.value })
                                        }
                                        className={cn(
                                            "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white dark:bg-slate-700 dark:text-white",
                                            formErrors.endDate
                                                ? "border-red-300 dark:border-red-500/50"
                                                : "border-slate-200 dark:border-slate-600"
                                        )}
                                    />
                                    {formErrors.endDate && (
                                        <p className="mt-1 text-xs text-red-500">
                                            {formErrors.endDate}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Half Day */}
                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="isHalfDay"
                                    checked={form.isHalfDay}
                                    onChange={(e) =>
                                        setForm({ ...form, isHalfDay: e.target.checked })
                                    }
                                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-500 focus:ring-blue-500 dark:bg-slate-700"
                                />
                                <label
                                    htmlFor="isHalfDay"
                                    className="text-sm text-slate-700 dark:text-slate-300"
                                >
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
                                        className="ml-auto px-3 py-1 border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-white rounded-lg text-sm"
                                    >
                                        <option value="morning">Buổi sáng</option>
                                        <option value="afternoon">Buổi chiều</option>
                                    </select>
                                )}
                            </div>

                            {/* Reason */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                                    Lý do <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={form.reason}
                                    onChange={(e) =>
                                        setForm({ ...form, reason: e.target.value })
                                    }
                                    rows={3}
                                    placeholder="Nhập lý do nghỉ phép..."
                                    className={cn(
                                        "w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none bg-white dark:bg-slate-700 dark:text-white",
                                        formErrors.reason
                                            ? "border-red-300 dark:border-red-500/50"
                                            : "border-slate-200 dark:border-slate-600"
                                    )}
                                />
                                {formErrors.reason && (
                                    <p className="mt-1 text-xs text-red-500">
                                        {formErrors.reason}
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowCreateModal(false);
                                    resetForm();
                                }}
                                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={processing}
                                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {processing && <Clock className="w-4 h-4 animate-spin" />}
                                Gửi đơn
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
