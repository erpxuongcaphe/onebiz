"use client";

import { useState, useEffect, useCallback } from "react";
import { History, ChevronRight, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
    getActivityLogs,
    getActivityLogsPaginated,
    formatEntityType,
    formatAction,
    ActivityLog
} from "@/lib/api/activity-logs";

// Format relative time
function formatRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;
    if (diffHours < 24) return `${diffHours} giờ trước`;
    if (diffDays < 7) return `${diffDays} ngày trước`;

    return date.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Format full datetime
function formatFullDateTime(dateString: string): string {
    return new Date(dateString).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Role display names
const roleNames: Record<string, string> = {
    admin: 'Quản trị viên',
    accountant: 'Kế toán',
    branch_manager: 'Quản lý',
    member: 'Nhân viên'
};

interface ActivityLogWidgetProps {
    compact?: boolean;
}

export default function ActivityLogWidget({ compact = false }: ActivityLogWidgetProps) {
    const { user } = useAuth();
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [allLogs, setAllLogs] = useState<ActivityLog[]>([]);
    const [allLogsLoading, setAllLogsLoading] = useState(false);
    const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalLogs, setTotalLogs] = useState(0);
    const pageSize = 20;
    const displayLimit = compact ? 3 : 5;

    // Check if should render
    const shouldRender = user && user.role !== 'member';

    // Fetch recent logs for widget
    const fetchRecentLogs = useCallback(async () => {
        if (!user || user.role === 'member') return;
        try {
            setLoading(true);
            const data = await getActivityLogs(user.role, displayLimit);
            setLogs(data);
        } catch (error) {
            console.error('Error fetching activity logs:', error);
        } finally {
            setLoading(false);
        }
    }, [user, displayLimit]);

    // Fetch all logs for modal
    const fetchAllLogs = useCallback(async (page: number = 1) => {
        if (!user || user.role === 'member') return;
        try {
            setAllLogsLoading(true);
            const { logs: data, total } = await getActivityLogsPaginated(user.role, page, pageSize);
            setAllLogs(data);
            setTotalLogs(total);
            setCurrentPage(page);
        } catch (error) {
            console.error('Error fetching all activity logs:', error);
        } finally {
            setAllLogsLoading(false);
        }
    }, [user]);

    useEffect(() => {
        if (shouldRender) {
            fetchRecentLogs();
        }
    }, [fetchRecentLogs, shouldRender]);

    useEffect(() => {
        if (showModal && shouldRender) {
            fetchAllLogs(1);
        }
    }, [showModal, fetchAllLogs, shouldRender]);

    const totalPages = Math.ceil(totalLogs / pageSize);

    // Don't render for members
    if (!shouldRender) {
        return null;
    }

    return (
        <>
            {/* Widget Card */}
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
                <div className={cn(
                    "flex items-center justify-between",
                    compact ? "p-4 border-b border-slate-100 dark:border-slate-700" : "p-5 border-b border-slate-100 dark:border-slate-700"
                )}>
                    <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-amber-500" />
                        <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Lịch sử thao tác</h3>
                    </div>
                    <button
                        onClick={() => setShowModal(true)}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1"
                    >
                        Xem tất cả
                        <ChevronRight className="w-3 h-3" />
                    </button>
                </div>

                {loading ? (
                    <div className={cn("flex items-center justify-center", compact ? "py-6" : "py-8")}>
                        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    </div>
                ) : logs.length === 0 ? (
                    <div className={cn("text-center text-slate-500 dark:text-slate-400 text-sm", compact ? "py-4 px-4" : "py-6")}>
                        Chưa có hoạt động nào
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50 dark:divide-slate-700">
                        {logs.map((log) => {
                            const actionInfo = formatAction(log.action);
                            return (
                                <div
                                    key={log.id}
                                    className="flex items-start gap-2 p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                    onClick={() => {
                                        setSelectedLog(log);
                                        setShowModal(true);
                                    }}
                                >
                                    <span className="text-sm flex-shrink-0">{actionInfo.icon}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-slate-700 dark:text-slate-300 truncate">
                                            <span className="font-medium">{log.user_name || 'User'}</span>
                                            <span className={cn("ml-1", actionInfo.color)}>{actionInfo.label.toLowerCase()}</span>
                                            {log.entity_name && (
                                                <span className="ml-1 font-medium">&quot;{log.entity_name}&quot;</span>
                                            )}
                                        </p>
                                        <p className="text-[10px] text-slate-400 mt-0.5">
                                            {formatRelativeTime(log.created_at)}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Modal */}
            {showModal && (
                <>
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
                        onClick={() => { setShowModal(false); setSelectedLog(null); }}
                    />
                    <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl bg-white dark:bg-slate-800 rounded-2xl shadow-2xl z-50 max-h-[80vh] overflow-hidden flex flex-col">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-700">
                            <div>
                                <h2 className="font-semibold text-slate-900 dark:text-white">Lịch sử thao tác</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{totalLogs} hoạt động</p>
                            </div>
                            <button
                                onClick={() => { setShowModal(false); setSelectedLog(null); }}
                                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto">
                            {selectedLog ? (
                                <div className="p-4 space-y-4">
                                    <button
                                        onClick={() => setSelectedLog(null)}
                                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1"
                                    >
                                        ← Quay lại
                                    </button>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">{formatAction(selectedLog.action).icon}</span>
                                            <div>
                                                <p className="font-medium text-slate-900 dark:text-white">{selectedLog.user_name || selectedLog.user_id}</p>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">{selectedLog.user_role ? (roleNames[selectedLog.user_role] || selectedLog.user_role) : 'Unknown'}</p>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                <p className="text-slate-500 dark:text-slate-400 text-xs">Hành động</p>
                                                <p className={cn("font-medium", formatAction(selectedLog.action).color)}>
                                                    {formatAction(selectedLog.action).label}
                                                </p>
                                            </div>
                                            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                <p className="text-slate-500 dark:text-slate-400 text-xs">Đối tượng</p>
                                                <p className="font-medium text-slate-900 dark:text-white">{formatEntityType(selectedLog.entity_type)}</p>
                                            </div>
                                            {selectedLog.entity_name && (
                                                <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg col-span-2">
                                                    <p className="text-slate-500 dark:text-slate-400 text-xs">Tên</p>
                                                    <p className="font-medium text-slate-900 dark:text-white">{selectedLog.entity_name}</p>
                                                </div>
                                            )}
                                            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg col-span-2">
                                                <p className="text-slate-500 dark:text-slate-400 text-xs">Thời gian</p>
                                                <p className="font-medium text-slate-900 dark:text-white">{formatFullDateTime(selectedLog.created_at)}</p>
                                            </div>
                                        </div>
                                        {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                                            <div className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                                                <p className="text-slate-500 dark:text-slate-400 text-xs mb-2">Chi tiết</p>
                                                <div className="space-y-2 max-h-64 overflow-auto">
                                                    {Object.entries(selectedLog.details).map(([key, value]) => {
                                                        // Translate common keys to Vietnamese
                                                        const keyLabels: Record<string, string> = {
                                                            date: 'Ngày',
                                                            action: 'Hành động',
                                                            reason: 'Lý do',
                                                            status: 'Trạng thái',
                                                            old_value: 'Giá trị cũ',
                                                            new_value: 'Giá trị mới',
                                                            employee_id: 'Mã nhân viên',
                                                            employee_name: 'Tên nhân viên',
                                                            department: 'Phòng ban',
                                                            branch: 'Chi nhánh',
                                                            amount: 'Số tiền',
                                                            hours: 'Số giờ',
                                                            type: 'Loại',
                                                            note: 'Ghi chú',
                                                            notes: 'Ghi chú',
                                                            from_date: 'Từ ngày',
                                                            to_date: 'Đến ngày',
                                                            start_time: 'Giờ bắt đầu',
                                                            end_time: 'Giờ kết thúc',
                                                            approved_by: 'Người duyệt',
                                                            rejected_by: 'Người từ chối',
                                                            created_by: 'Người tạo',
                                                            updated_by: 'Người cập nhật',
                                                        };
                                                        // Translate common values to Vietnamese
                                                        const valueLabels: Record<string, string> = {
                                                            approve: 'Duyệt',
                                                            approved: 'Đã duyệt',
                                                            reject: 'Từ chối',
                                                            rejected: 'Đã từ chối',
                                                            pending: 'Đang chờ',
                                                            active: 'Hoạt động',
                                                            inactive: 'Không hoạt động',
                                                            create: 'Tạo mới',
                                                            update: 'Cập nhật',
                                                            delete: 'Xóa',
                                                        };
                                                        const displayKey = keyLabels[key] || key;
                                                        let displayValue = value;
                                                        if (typeof value === 'string') {
                                                            displayValue = valueLabels[value] || value;
                                                        } else if (typeof value === 'object' && value !== null) {
                                                            displayValue = JSON.stringify(value);
                                                        }
                                                        return (
                                                            <div key={key} className="flex items-start gap-2 text-sm">
                                                                <span className="text-slate-500 dark:text-slate-400 min-w-[100px]">{displayKey}:</span>
                                                                <span className="text-slate-900 dark:text-white font-medium">{String(displayValue)}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : allLogsLoading ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                                </div>
                            ) : allLogs.length === 0 ? (
                                <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                                    Chưa có hoạt động nào
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {allLogs.map((log) => {
                                        const actionInfo = formatAction(log.action);
                                        return (
                                            <div
                                                key={log.id}
                                                className="flex items-start gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                                onClick={() => setSelectedLog(log)}
                                            >
                                                <span className="text-lg flex-shrink-0">{actionInfo.icon}</span>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm text-slate-800 dark:text-slate-200">
                                                        <span className="font-medium">{log.user_name || log.user_id}</span>
                                                        <span className={cn("ml-1", actionInfo.color)}>{actionInfo.label.toLowerCase()}</span>
                                                        <span className="ml-1">{formatEntityType(log.entity_type).toLowerCase()}</span>
                                                        {log.entity_name && (
                                                            <span className="ml-1 font-medium">&quot;{log.entity_name}&quot;</span>
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-slate-400 mt-0.5">
                                                        {formatRelativeTime(log.created_at)}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Pagination */}
                        {!selectedLog && totalPages > 1 && (
                            <div className="flex items-center justify-between p-4 border-t border-slate-100 dark:border-slate-700">
                                <button
                                    onClick={() => fetchAllLogs(currentPage - 1)}
                                    disabled={currentPage === 1 || allLogsLoading}
                                    className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50"
                                >
                                    Trước
                                </button>
                                <span className="text-sm text-slate-500 dark:text-slate-400">
                                    Trang {currentPage} / {totalPages}
                                </span>
                                <button
                                    onClick={() => fetchAllLogs(currentPage + 1)}
                                    disabled={currentPage === totalPages || allLogsLoading}
                                    className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50"
                                >
                                    Sau
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </>
    );
}
