"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, CheckCheck, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import {
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead,
    getNotificationIcon,
    getNotificationColor,
    formatNotificationTime,
    type Notification,
} from "@/lib/api/notifications";

export function NotificationBell() {
    const { user } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Load notifications when dropdown opens
    useEffect(() => {
        if (user && isOpen) {
            loadNotifications();
        }
    }, [user, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

    // Load unread count periodically
    useEffect(() => {
        if (!user) return;

        loadUnreadCount();
        const interval = setInterval(loadUnreadCount, 60000); // Every minute

        return () => clearInterval(interval);
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    async function loadUnreadCount() {
        if (!user) return;
        try {
            const count = await getUnreadCount(user.id);
            setUnreadCount(count);
        } catch (error) {
            console.error("Failed to load unread count:", error);
        }
    }

    async function loadNotifications() {
        if (!user) return;
        try {
            setLoading(true);
            const data = await getNotifications(user.id, { limit: 10 });
            setNotifications(data);
        } catch (error) {
            console.error("Failed to load notifications:", error);
        } finally {
            setLoading(false);
        }
    }

    async function handleMarkAsRead(notification: Notification) {
        if (notification.is_read) return;
        try {
            await markAsRead(notification.id);
            setNotifications((prev) =>
                prev.map((n) =>
                    n.id === notification.id ? { ...n, is_read: true } : n
                )
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch (error) {
            console.error("Failed to mark as read:", error);
        }
    }

    async function handleMarkAllAsRead() {
        if (!user) return;
        try {
            await markAllAsRead(user.id);
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
            setUnreadCount(0);
        } catch (error) {
            console.error("Failed to mark all as read:", error);
        }
    }

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "relative p-2 rounded-xl transition-all duration-200",
                    isOpen
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                        : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                )}
            >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-5 h-5 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full border-2 border-white animate-pulse">
                        {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                        <h3 className="font-semibold text-slate-900 dark:text-white">Thông báo</h3>
                        <div className="flex items-center gap-1">
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAllAsRead}
                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors text-xs font-medium flex items-center gap-1"
                                >
                                    <CheckCheck className="w-4 h-4" />
                                    <span className="hidden sm:inline">Đọc tất cả</span>
                                </button>
                            )}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="max-h-96 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="py-12 text-center">
                                <Bell className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                                <p className="text-slate-500 text-sm">Không có thông báo nào</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {notifications.map((notification) => (
                                    <div
                                        key={notification.id}
                                        onClick={() => handleMarkAsRead(notification)}
                                        className={cn(
                                            "p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer",
                                            !notification.is_read && "bg-blue-50/50 dark:bg-blue-900/10"
                                        )}
                                    >
                                        <div className="flex gap-3">
                                            {/* Icon */}
                                            <div
                                                className={cn(
                                                    "w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0",
                                                    getNotificationColor(notification.type)
                                                )}
                                            >
                                                {getNotificationIcon(notification.type)}
                                            </div>

                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <p className="font-medium text-slate-900 dark:text-white text-sm">
                                                        {notification.title}
                                                    </p>
                                                    {!notification.is_read && (
                                                        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                                                    )}
                                                </div>
                                                <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mt-0.5">
                                                    {notification.message}
                                                </p>
                                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                                    {formatNotificationTime(notification.created_at)}
                                                </p>
                                            </div>
                                        </div>

                                        {/* Link */}
                                        {notification.link && (
                                            <Link
                                                href={notification.link}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleMarkAsRead(notification);
                                                    setIsOpen(false);
                                                }}
                                                className="mt-2 ml-13 inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                                            >
                                                Xem chi tiết
                                                <ExternalLink className="w-3 h-3" />
                                            </Link>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                        <Link
                            href="/dashboard/notifications"
                            onClick={() => setIsOpen(false)}
                            className="block w-full text-center text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        >
                            Xem tất cả thông báo
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
