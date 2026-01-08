"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    Clock,
    Calendar,
    Wallet,
    FileText,
    TrendingUp,
    ChevronRight,
    Loader2,
    CalendarDays,
    User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getAttendanceRecords, AttendanceRecord } from "@/lib/api/timekeeping";
import { getLeaveBalances, LeaveBalance } from "@/lib/api/leave-management";
import { getEmployeePayslipHistory, MonthlyPayslip } from "@/lib/api/payslips";
import { getEmployeeById, Employee } from "@/lib/api/employees";

// Stat Card Component
function StatCard({
    title,
    value,
    subtitle,
    icon: Icon,
    color,
    href,
}: {
    title: string;
    value: string | number;
    subtitle?: string;
    icon: React.ElementType;
    color: string;
    href?: string;
}) {
    const content = (
        <div className={cn(
            "bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all duration-200",
            href && "cursor-pointer hover:border-blue-200"
        )}>
            <div className="flex items-start justify-between">
                <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", color)}>
                    <Icon className="w-6 h-6 text-white" />
                </div>
                {href && <ChevronRight className="w-5 h-5 text-slate-300" />}
            </div>
            <div className="mt-4">
                <p className="text-2xl font-bold text-slate-900">{value}</p>
                <p className="text-sm font-medium text-slate-600 mt-1">{title}</p>
                {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
            </div>
        </div>
    );

    if (href) {
        return <Link href={href}>{content}</Link>;
    }
    return content;
}

// Quick Action Link
function QuickAction({
    title,
    description,
    href,
    icon: Icon,
}: {
    title: string;
    description: string;
    href: string;
    icon: React.ElementType;
}) {
    return (
        <Link
            href={href}
            className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl hover:bg-blue-50 hover:border-blue-200 border border-transparent transition-all group"
        >
            <div className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <Icon className="w-5 h-5 text-slate-600 group-hover:text-blue-600" />
            </div>
            <div className="flex-1">
                <p className="text-sm font-medium text-slate-900 group-hover:text-blue-700">{title}</p>
                <p className="text-xs text-slate-500">{description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400" />
        </Link>
    );
}

export default function MyDashboardPage() {
    const { user, isLoading: authLoading } = useAuth();

    const [loading, setLoading] = useState(true);
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [leaveBalance, setLeaveBalance] = useState<LeaveBalance[]>([]);
    const [recentPayslip, setRecentPayslip] = useState<MonthlyPayslip | null>(null);

    // Get current month info
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const monthStart = `${currentMonth}-01`;
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthEnd = `${currentMonth}-${lastDay.toString().padStart(2, '0')}`;

    useEffect(() => {
        if (!authLoading && user) {
            loadData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user]);

    async function loadData() {
        if (!user?.employeeId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            const [empData, attData, leaveData, payslips] = await Promise.all([
                getEmployeeById(user.employeeId),
                getAttendanceRecords({
                    employeeId: user.employeeId,
                    startDate: monthStart,
                    endDate: monthEnd
                }),
                getLeaveBalances(user.employeeId),
                getEmployeePayslipHistory(user.employeeId)
            ]);

            setEmployee(empData);
            setAttendance(attData);
            setLeaveBalance(leaveData);
            setRecentPayslip(payslips[0] || null);

        } catch (error) {
            console.error("Failed to load dashboard data:", error);
        } finally {
            setLoading(false);
        }
    }

    // Calculate stats
    const workDaysThisMonth = new Set(attendance.map(a => a.date)).size;
    const totalHoursThisMonth = attendance.reduce((sum, a) => sum + (a.hours_worked || 0), 0);
    const totalOTHours = attendance.reduce((sum, a) => sum + (a.overtime_hours || 0), 0);

    // Calculate remaining leave days (total - used - pending)
    const totalLeaveRemaining = leaveBalance.reduce((sum, b) => {
        const remaining = (b.total_days || 0) - (b.used_days || 0) - (b.pending_days || 0);
        return sum + Math.max(0, remaining);
    }, 0);

    // Format salary
    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
    };

    if (authLoading || loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!user?.employeeId) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <User className="w-16 h-16 text-slate-300 mb-4" />
                <h2 className="text-xl font-semibold text-slate-900 mb-2">Chưa liên kết nhân viên</h2>
                <p className="text-slate-500">Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.</p>
                <p className="text-sm text-slate-400 mt-1">Vui lòng liên hệ quản trị viên.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                        Xin chào, {employee?.name || user.fullName}! 👋
                    </h1>
                    <p className="text-slate-500 mt-1">
                        {employee?.position} - {employee?.department}
                    </p>
                </div>
                <div className="text-right hidden sm:block">
                    <p className="text-sm text-slate-500">Hôm nay</p>
                    <p className="text-lg font-semibold text-slate-900">
                        {new Date().toLocaleDateString('vi-VN', {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric'
                        })}
                    </p>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Ngày công tháng này"
                    value={workDaysThisMonth}
                    subtitle={`${Math.round(totalHoursThisMonth)} giờ làm việc`}
                    icon={Clock}
                    color="bg-gradient-to-br from-blue-500 to-cyan-500"
                    href="/dashboard/my-attendance"
                />
                <StatCard
                    title="Giờ tăng ca (OT)"
                    value={`${totalOTHours.toFixed(1)}h`}
                    subtitle="Tháng này"
                    icon={TrendingUp}
                    color="bg-gradient-to-br from-amber-500 to-orange-500"
                    href="/dashboard/my-attendance"
                />
                <StatCard
                    title="Ngày phép còn lại"
                    value={totalLeaveRemaining}
                    subtitle="Tất cả loại phép"
                    icon={Calendar}
                    color="bg-gradient-to-br from-green-500 to-emerald-500"
                    href="/dashboard/my-leaves"
                />
                <StatCard
                    title="Lương gần nhất"
                    value={recentPayslip ? formatCurrency(recentPayslip.net_salary || 0) : "---"}
                    subtitle={recentPayslip ? `Tháng ${recentPayslip.month.split('-')[1]}/${recentPayslip.month.split('-')[0]}` : "Chưa có dữ liệu"}
                    icon={Wallet}
                    color="bg-gradient-to-br from-purple-500 to-pink-500"
                    href="/dashboard/my-salary"
                />
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Thao tác nhanh</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <QuickAction
                        title="Xem chấm công"
                        description="Chi tiết chấm công tháng này"
                        href="/dashboard/my-attendance"
                        icon={Clock}
                    />
                    <QuickAction
                        title="Lịch làm việc"
                        description="Xem lịch làm việc chi nhánh"
                        href="/dashboard/my-schedule"
                        icon={Calendar}
                    />
                    <QuickAction
                        title="Xin nghỉ phép"
                        description="Tạo đơn xin nghỉ mới"
                        href="/dashboard/my-leaves"
                        icon={CalendarDays}
                    />
                    <QuickAction
                        title="Phiếu lương"
                        description="Xem và tải phiếu lương"
                        href="/dashboard/my-salary"
                        icon={FileText}
                    />
                    <QuickAction
                        title="Thông tin cá nhân"
                        description="Cập nhật hồ sơ của bạn"
                        href="/dashboard/my-profile"
                        icon={User}
                    />
                </div>
            </div>

            {/* Leave Balance Summary */}
            {leaveBalance.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-slate-900 mb-4">Chi tiết ngày phép</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {leaveBalance.map((balance) => {
                            const remaining = Math.max(0, (balance.total_days || 0) - (balance.used_days || 0) - (balance.pending_days || 0));
                            return (
                                <div
                                    key={balance.leave_type_id}
                                    className="flex items-center justify-between p-4 bg-slate-50 rounded-xl"
                                >
                                    <div>
                                        <p className="text-sm font-medium text-slate-900">
                                            {balance.leave_type?.name || 'Không xác định'}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            Đã dùng: {balance.used_days || 0} ngày
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xl font-bold text-green-600">
                                            {remaining}
                                        </p>
                                        <p className="text-xs text-slate-400">còn lại</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
