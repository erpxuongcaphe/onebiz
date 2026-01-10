"use client";

import { useState, useEffect } from "react";
import {
    Calendar,
    Check,
    X,
    Clock,
    Filter,
    ChevronDown,
    Search,
    CalendarDays,
    User,
    FileText,
    RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
    getLeaveRequests,
    getLeaveTypes,
    approveLeaveRequest,
    rejectLeaveRequest,
    getStatusLabel,
    getStatusColor,
    type LeaveRequest,
    type LeaveType,
    type LeaveRequestStatus,
} from "@/lib/api/leave-management";

export default function LeavesPage() {
    const { user } = useAuth();
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<LeaveRequestStatus | "all">("all");
    const [filterType, setFilterType] = useState<string>("all");
    const [searchTerm, setSearchTerm] = useState("");
    const [showFilters, setShowFilters] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<LeaveRequest | null>(null);
    const [rejectNote, setRejectNote] = useState("");
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [requestsData, typesData] = await Promise.all([
                getLeaveRequests(),
                getLeaveTypes(),
            ]);
            setRequests(requestsData);
            setLeaveTypes(typesData);
        } catch (error) {
            console.error("Failed to load data:", error);
        } finally {
            setLoading(false);
        }
    }

    const filteredRequests = requests.filter((req) => {
        if (filterStatus !== "all" && req.status !== filterStatus) return false;
        if (filterType !== "all" && req.leave_type_id !== filterType) return false;
        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            if (
                !req.employee?.name.toLowerCase().includes(search) &&
                !req.employee?.department?.toLowerCase().includes(search)
            ) {
                return false;
            }
        }
        return true;
    });

    const pendingCount = requests.filter((r) => r.status === "pending").length;

    async function handleApprove(request: LeaveRequest) {
        if (!user) return;
        try {
            setProcessing(true);
            await approveLeaveRequest(request.id, user.id);
            await loadData();
            setSelectedRequest(null);
        } catch (error) {
            console.error("Failed to approve:", error);
        } finally {
            setProcessing(false);
        }
    }

    async function handleReject(request: LeaveRequest) {
        if (!user || !rejectNote.trim()) return;
        try {
            setProcessing(true);
            await rejectLeaveRequest(request.id, user.id, rejectNote);
            await loadData();
            setSelectedRequest(null);
            setRejectNote("");
        } catch (error) {
            console.error("Failed to reject:", error);
        } finally {
            setProcessing(false);
        }
    }

    function formatDate(dateStr: string) {
        return new Date(dateStr).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                        Quản lý nghỉ phép
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Duyệt và quản lý đơn xin nghỉ phép của nhân viên
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {pendingCount > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-800 text-sm font-medium rounded-full">
                            <Clock className="w-4 h-4" />
                            {pendingCount} chờ duyệt
                        </span>
                    )}
                    <button
                        onClick={loadData}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Filters - Mobile toggle */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Search & Filter Toggle */}
                <div className="p-3 sm:p-4 flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Tìm theo tên nhân viên..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={cn(
                            "inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border transition-colors sm:w-auto",
                            showFilters
                                ? "bg-blue-50 border-blue-200 text-blue-700"
                                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                        )}
                    >
                        <Filter className="w-4 h-4" />
                        Bộ lọc
                        <ChevronDown
                            className={cn(
                                "w-4 h-4 transition-transform",
                                showFilters && "rotate-180"
                            )}
                        />
                    </button>
                </div>

                {/* Expandable Filters */}
                {showFilters && (
                    <div className="px-3 sm:px-4 pb-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
                        <div className="w-full sm:w-auto">
                            <label className="block text-xs font-medium text-slate-500 mb-1">
                                Trạng thái
                            </label>
                            <select
                                value={filterStatus}
                                onChange={(e) =>
                                    setFilterStatus(e.target.value as LeaveRequestStatus | "all")
                                }
                                className="w-full sm:w-40 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="all">Tất cả</option>
                                <option value="pending">Chờ duyệt</option>
                                <option value="approved">Đã duyệt</option>
                                <option value="rejected">Từ chối</option>
                                <option value="cancelled">Đã hủy</option>
                            </select>
                        </div>
                        <div className="w-full sm:w-auto">
                            <label className="block text-xs font-medium text-slate-500 mb-1">
                                Loại nghỉ phép
                            </label>
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="w-full sm:w-48 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="all">Tất cả</option>
                                {leaveTypes.map((type) => (
                                    <option key={type.id} value={type.id}>
                                        {type.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Nhân viên
                            </th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Loại nghỉ
                            </th>
                            <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Thời gian
                            </th>
                            <th className="text-center px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Số ngày
                            </th>
                            <th className="text-center px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Trạng thái
                            </th>
                            <th className="text-center px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                Thao tác
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredRequests.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                                    <CalendarDays className="w-12 h-12 mx-auto text-slate-300 mb-2" />
                                    <p>Không có đơn nghỉ phép nào</p>
                                </td>
                            </tr>
                        ) : (
                            filteredRequests.map((request) => (
                                <tr key={request.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold">
                                                {request.employee?.name
                                                    ?.split(" ")
                                                    .map((n) => n[0])
                                                    .slice(-2)
                                                    .join("")}
                                            </div>
                                            <div>
                                                <p className="font-medium text-slate-900">
                                                    {request.employee?.name}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    {request.employee?.department}
                                                </p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span
                                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
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
                                    </td>
                                    <td className="px-4 py-3">
                                        <p className="text-sm text-slate-900">
                                            {formatDate(request.start_date)} - {formatDate(request.end_date)}
                                        </p>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
                                            {request.total_days}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span
                                            className={cn(
                                                "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
                                                getStatusColor(request.status)
                                            )}
                                        >
                                            {getStatusLabel(request.status)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-center gap-1">
                                            {request.status === "pending" && (
                                                <>
                                                    <button
                                                        onClick={() => handleApprove(request)}
                                                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                                        title="Duyệt"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => setSelectedRequest(request)}
                                                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                        title="Từ chối"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                onClick={() => setSelectedRequest(request)}
                                                className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                                title="Chi tiết"
                                            >
                                                <FileText className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
                {filteredRequests.length === 0 ? (
                    <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                        <CalendarDays className="w-12 h-12 mx-auto text-slate-300 mb-2" />
                        <p className="text-slate-500">Không có đơn nghỉ phép nào</p>
                    </div>
                ) : (
                    filteredRequests.map((request) => (
                        <div
                            key={request.id}
                            className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"
                        >
                            {/* Header */}
                            <div className="flex items-start justify-between gap-3 mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white text-sm font-bold">
                                        {request.employee?.name
                                            ?.split(" ")
                                            .map((n) => n[0])
                                            .slice(-2)
                                            .join("")}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-slate-900">
                                            {request.employee?.name}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {request.employee?.department}
                                        </p>
                                    </div>
                                </div>
                                <span
                                    className={cn(
                                        "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                                        getStatusColor(request.status)
                                    )}
                                >
                                    {getStatusLabel(request.status)}
                                </span>
                            </div>

                            {/* Leave Type & Days */}
                            <div className="flex items-center gap-2 mb-3">
                                <span
                                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
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
                                <span className="text-xs text-slate-500">•</span>
                                <span className="text-sm font-medium text-slate-700">
                                    {request.total_days} ngày
                                </span>
                            </div>

                            {/* Date Range */}
                            <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                                <Calendar className="w-4 h-4 text-slate-400" />
                                <span>
                                    {formatDate(request.start_date)} - {formatDate(request.end_date)}
                                </span>
                            </div>

                            {/* Reason */}
                            {request.reason && (
                                <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-2 mb-3">
                                    {request.reason}
                                </p>
                            )}

                            {/* Actions */}
                            {request.status === "pending" && (
                                <div className="flex gap-2 pt-2 border-t border-slate-100">
                                    <button
                                        onClick={() => handleApprove(request)}
                                        disabled={processing}
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500 text-white text-sm font-medium rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50"
                                    >
                                        <Check className="w-4 h-4" />
                                        Duyệt
                                    </button>
                                    <button
                                        onClick={() => setSelectedRequest(request)}
                                        disabled={processing}
                                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                                    >
                                        <X className="w-4 h-4" />
                                        Từ chối
                                    </button>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Reject Modal */}
            {selectedRequest && selectedRequest.status === "pending" && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                        <h3 className="text-lg font-semibold text-slate-900 mb-4">
                            Từ chối đơn nghỉ phép
                        </h3>
                        <div className="mb-4">
                            <p className="text-sm text-slate-600 mb-2">
                                Đơn nghỉ phép của <strong>{selectedRequest.employee?.name}</strong>
                            </p>
                            <p className="text-sm text-slate-500">
                                {selectedRequest.leave_type?.name} • {selectedRequest.total_days} ngày
                            </p>
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                Lý do từ chối <span className="text-red-500">*</span>
                            </label>
                            <textarea
                                value={rejectNote}
                                onChange={(e) => setRejectNote(e.target.value)}
                                placeholder="Nhập lý do từ chối..."
                                rows={3}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setSelectedRequest(null);
                                    setRejectNote("");
                                }}
                                className="flex-1 px-4 py-2.5 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={() => handleReject(selectedRequest)}
                                disabled={!rejectNote.trim() || processing}
                                className="flex-1 px-4 py-2.5 text-white bg-red-500 hover:bg-red-600 rounded-lg font-medium transition-colors disabled:opacity-50"
                            >
                                {processing ? "Đang xử lý..." : "Từ chối"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Detail Modal */}
            {selectedRequest && selectedRequest.status !== "pending" && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-slate-900">
                                Chi tiết đơn nghỉ phép
                            </h3>
                            <button
                                onClick={() => setSelectedRequest(null)}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <User className="w-5 h-5 text-slate-400" />
                                <div>
                                    <p className="font-medium text-slate-900">
                                        {selectedRequest.employee?.name}
                                    </p>
                                    <p className="text-sm text-slate-500">
                                        {selectedRequest.employee?.department}
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-slate-500">Loại nghỉ</p>
                                    <p className="font-medium">{selectedRequest.leave_type?.name}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Số ngày</p>
                                    <p className="font-medium">{selectedRequest.total_days} ngày</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Từ ngày</p>
                                    <p className="font-medium">{formatDate(selectedRequest.start_date)}</p>
                                </div>
                                <div>
                                    <p className="text-slate-500">Đến ngày</p>
                                    <p className="font-medium">{formatDate(selectedRequest.end_date)}</p>
                                </div>
                            </div>

                            {selectedRequest.reason && (
                                <div>
                                    <p className="text-sm text-slate-500 mb-1">Lý do</p>
                                    <p className="text-sm bg-slate-50 rounded-lg p-3">
                                        {selectedRequest.reason}
                                    </p>
                                </div>
                            )}

                            <div className="pt-3 border-t border-slate-100">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-500">Trạng thái</span>
                                    <span
                                        className={cn(
                                            "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium",
                                            getStatusColor(selectedRequest.status)
                                        )}
                                    >
                                        {getStatusLabel(selectedRequest.status)}
                                    </span>
                                </div>
                                {selectedRequest.review_note && (
                                    <div className="mt-2">
                                        <p className="text-sm text-slate-500 mb-1">Ghi chú duyệt</p>
                                        <p className="text-sm bg-slate-50 rounded-lg p-3">
                                            {selectedRequest.review_note}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
