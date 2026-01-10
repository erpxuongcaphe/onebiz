"use client";

import { useState, useEffect } from "react";
import {
    Bell,
    Check,
    Trash2,
    Filter,
    ChevronDown,
    RefreshCw,
    Gift,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
    getNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    getNotificationIcon,
    getNotificationColor,
    formatNotificationTime,
    type Notification,
    type NotificationType,
} from "@/lib/api/notifications";
import { getUpcomingBirthdays, BirthdayForecast } from "@/lib/api/forecast";

const typeLabels: Record<NotificationType, string> = {
    birthday: "Sinh nhật",
    contract_expiry: "Hợp đồng",
    leave_request: "Yêu cầu nghỉ phép",
    leave_approved: "Duyệt nghỉ phép",
    leave_rejected: "Từ chối nghỉ phép",
    attendance_reminder: "Chấm công",
    salary_ready: "Lương",
    system: "Hệ thống",
};

export default function NotificationsPage() {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState<NotificationType | "all">("all");
    const [filterRead, setFilterRead] = useState<"all" | "unread" | "read">("all");
    const [showFilters, setShowFilters] = useState(false);
    const [birthdays, setBirthdays] = useState<BirthdayForecast[]>([]);
    const [forecastMonths, setForecastMonths] = useState<1 | 3>(1);

    useEffect(() => {
        if (user) {
            loadNotifications();
        }
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    async function loadNotifications() {
        if (!user) return;
        try {
            setLoading(true);
            const data = await getNotifications(user.id);
            setNotifications(data);
        } catch (error) {
            console.error("Failed to load notifications:", error);
        } finally {
            setLoading(false);
        }
    }

    async function loadBirthdays() {
        try {
            const data = await getUpcomingBirthdays(forecastMonths);
            setBirthdays(data);
        } catch (error) {
            console.error("Failed to load birthdays:", error);
        }
    }

    useEffect(() => {
        loadBirthdays();
    }, [forecastMonths]); // eslint-disable-line react-hooks/exhaustive-deps

    const filteredNotifications = notifications.filter((n) => {
        if (filterType !== "all" && n.type !== filterType) return false;
        if (filterRead === "unread" && n.is_read) return false;
        if (filterRead === "read" && !n.is_read) return false;
        return true;
    });

    const unreadCount = notifications.filter((n) => !n.is_read).length;

    async function handleMarkAsRead(notification: Notification) {
        if (notification.is_read) return;
        try {
            await markAsRead(notification.id);
            setNotifications((prev) =>
                prev.map((n) =>
                    n.id === notification.id ? { ...n, is_read: true } : n
                )
            );
        } catch (error) {
            console.error("Failed to mark as read:", error);
        }
    }

    async function handleMarkAllAsRead() {
        if (!user) return;
        try {
            await markAllAsRead(user.id);
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        } catch (error) {
            console.error("Failed to mark all as read:", error);
        }
    }

    async function handleDelete(notification: Notification) {
        try {
            await deleteNotification(notification.id);
            setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
        } catch (error) {
            console.error("Failed to delete notification:", error);
        }
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
                        Thông báo
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Quản lý tất cả thông báo của bạn
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {unreadCount > 0 && (
                        <button
                            onClick={handleMarkAllAsRead}
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
                        >
                            <Check className="w-4 h-4" />
                            Đọc tất cả ({unreadCount})
                        </button>
                    )}
                    <button
                        onClick={loadNotifications}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <Filter className="w-4 h-4" />
                        Bộ lọc
                        {(filterType !== "all" || filterRead !== "all") && (
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                                Đang lọc
                            </span>
                        )}
                    </div>
                    <ChevronDown
                        className={cn(
                            "w-4 h-4 text-slate-400 transition-transform",
                            showFilters && "rotate-180"
                        )}
                    />
                </button>

                {showFilters && (
                    <div className="px-4 pb-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
                        <div className="w-full sm:w-auto">
                            <label className="block text-xs font-medium text-slate-500 mb-1">
                                Loại thông báo
                            </label>
                            <select
                                value={filterType}
                                onChange={(e) =>
                                    setFilterType(e.target.value as NotificationType | "all")
                                }
                                className="w-full sm:w-40 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="all">Tất cả</option>
                                {Object.entries(typeLabels).map(([key, label]) => (
                                    <option key={key} value={key}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="w-full sm:w-auto">
                            <label className="block text-xs font-medium text-slate-500 mb-1">
                                Trạng thái
                            </label>
                            <select
                                value={filterRead}
                                onChange={(e) =>
                                    setFilterRead(e.target.value as "all" | "unread" | "read")
                                }
                                className="w-full sm:w-36 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="all">Tất cả</option>
                                <option value="unread">Chưa đọc</option>
                                <option value="read">Đã đọc</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Birthday Forecast Section */}
            <div className="bg-gradient-to-r from-pink-50 to-orange-50 rounded-xl border border-pink-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-pink-100 rounded-lg">
                            <Gift className="w-5 h-5 text-pink-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-slate-900">Sinh nhật sắp tới</h3>
                            <p className="text-xs text-slate-500">Dự báo trong {forecastMonths} tháng</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            value={forecastMonths}
                            onChange={(e) => setForecastMonths(parseInt(e.target.value) as 1 | 3)}
                            className="px-3 py-1.5 text-sm border border-pink-200 rounded-lg bg-white focus:ring-2 focus:ring-pink-500"
                        >
                            <option value={1}>1 tháng</option>
                            <option value={3}>3 tháng</option>
                        </select>
                    </div>
                </div>

                {birthdays.length === 0 ? (
                    <div className="text-center py-4 text-slate-500 text-sm">
                        Không có sinh nhật nào trong {forecastMonths} tháng tới
                    </div>
                ) : (
                    <div className="space-y-2">
                        {birthdays.slice(0, 5).map((b) => (
                            <div
                                key={b.employee.id}
                                className="flex items-center justify-between p-3 bg-white rounded-lg border border-pink-100"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center text-white font-bold text-sm">
                                        {b.employee.name?.slice(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900">{b.employee.name}</p>
                                        <p className="text-xs text-slate-500">{b.employee.department}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-medium text-pink-600">
                                        {b.daysUntil === 0 ? "🎉 Hôm nay!" : `${b.daysUntil} ngày nữa`}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                        {new Date(b.birthdayDate).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} • {b.age} tuổi
                                    </p>
                                </div>
                            </div>
                        ))}
                        {birthdays.length > 5 && (
                            <div className="text-center pt-2">
                                <span className="text-sm text-pink-600 font-medium">
                                    + {birthdays.length - 5} sinh nhật khác
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Notification List */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {filteredNotifications.length === 0 ? (
                    <div className="py-12 text-center">
                        <Bell className="w-12 h-12 mx-auto text-slate-300 mb-3" />
                        <p className="text-slate-500">Không có thông báo nào</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {filteredNotifications.map((notification) => (
                            <div
                                key={notification.id}
                                className={cn(
                                    "p-4 hover:bg-slate-50 transition-colors",
                                    !notification.is_read && "bg-blue-50/50"
                                )}
                            >
                                <div className="flex gap-3 sm:gap-4">
                                    {/* Icon */}
                                    <div
                                        className={cn(
                                            "w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-lg sm:text-xl shrink-0",
                                            getNotificationColor(notification.type)
                                        )}
                                    >
                                        {getNotificationIcon(notification.type)}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-slate-900">
                                                        {notification.title}
                                                    </p>
                                                    {!notification.is_read && (
                                                        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                                                    )}
                                                </div>
                                                <p className="text-sm text-slate-600 mt-1">
                                                    {notification.message}
                                                </p>
                                                <div className="flex items-center gap-3 mt-2">
                                                    <span className="text-xs text-slate-400">
                                                        {formatNotificationTime(notification.created_at)}
                                                    </span>
                                                    <span
                                                        className={cn(
                                                            "px-2 py-0.5 rounded-full text-xs font-medium",
                                                            getNotificationColor(notification.type)
                                                        )}
                                                    >
                                                        {typeLabels[notification.type]}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Actions */}
                                            <div className="flex items-center gap-1">
                                                {!notification.is_read && (
                                                    <button
                                                        onClick={() => handleMarkAsRead(notification)}
                                                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                        title="Đánh dấu đã đọc"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDelete(notification)}
                                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Xóa"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
