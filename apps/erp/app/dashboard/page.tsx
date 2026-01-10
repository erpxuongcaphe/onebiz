"use client";

import { useState, useEffect } from "react";
import { Users, UserCheck, Wallet, Clock, TrendingUp, TrendingDown, Activity, Plus, FileText, Calendar, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import ActivityLogWidget from "@/components/dashboard/ActivityLogWidget";

const stats = [
    {
        name: "Tổng Nhân viên",
        value: "150",
        icon: Users,
        change: "+2.5%",
        changeType: "positive",
        subtext: "so với tháng trước",
        color: "from-blue-500 to-cyan-400",
        bgColor: "bg-blue-50",
        textColor: "text-blue-600",
    },
    {
        name: "Đang làm việc",
        value: "142",
        icon: UserCheck,
        change: "95%",
        changeType: "neutral",
        subtext: "tỷ lệ đi làm",
        color: "from-green-500 to-emerald-400",
        bgColor: "bg-green-50",
        textColor: "text-green-600",
    },
    {
        name: "Quỹ lương (Tháng)",
        value: "1.2 Tỷ",
        icon: Wallet,
        change: "+4.1%",
        changeType: "negative",
        subtext: "so với dự kiến",
        color: "from-amber-500 to-orange-400",
        bgColor: "bg-amber-50",
        textColor: "text-amber-600",
    },
    {
        name: "Giờ làm trung bình",
        value: "8.2h",
        icon: Clock,
        change: "+0.1h",
        changeType: "positive",
        subtext: "trong tuần này",
        color: "from-purple-500 to-pink-400",
        bgColor: "bg-purple-50",
        textColor: "text-purple-600",
    },
];

// Recent activities data - reserved for future use

const quickActions = [
    { label: "Thêm nhân viên", icon: Plus, href: "/dashboard/personnel", color: "gradient-primary" },
    { label: "Tạo mã QR", icon: Calendar, href: "/dashboard/timekeeping", color: "gradient-success" },
    { label: "Xem báo cáo", icon: FileText, href: "/dashboard/reports", color: "gradient-purple" },
];



// Real-time Clock - Desktop version
function RealTimeClock() {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="text-right">
            <p className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">
                {time.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
                {time.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
        </div>
    );
}

// Real-time Clock - Mobile compact version
function MobileRealTimeClock() {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="flex items-center gap-2 text-sm bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
            <span className="font-bold text-slate-900 dark:text-white tabular-nums">
                {time.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-600 dark:text-slate-300">
                {time.toLocaleDateString("vi-VN", { weekday: "short", day: "numeric", month: "numeric" })}
            </span>
        </div>
    );
}

export default function DashboardPage() {
    const { user } = useAuth();
    const [statsData, setStatsData] = useState(stats);
    const [recentEmployees, setRecentEmployees] = useState<{ id: string, name: string, position: string, joinDate: string, avatar: string }[]>([]);

    // Check if user is member (hide admin features)
    const isMember = user?.role === 'member';
    const isAdmin = user?.role === 'admin' || user?.role === 'branch_manager';

    useEffect(() => {
        async function fetchDashboardData() {
            try {
                // Fetch employees for stats
                const employees = await import('@/lib/api/employees').then(mod => mod.getEmployees());

                // Update Total Employees Stat
                const totalEmployees = employees.length;
                const activeEmployees = employees.filter(e => e.status === 'active').length;

                // Calculate monthly payroll from monthly_salaries table
                const now = new Date();
                const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const { getMonthlySalaries } = await import('@/lib/api/monthly-salaries');
                const monthlySalaries = await getMonthlySalaries(currentMonth);

                // Sum up net_salary for total payroll
                const totalPayroll = monthlySalaries.reduce((sum, s) => sum + (s.net_salary || 0), 0);

                // Format payroll for display
                let payrollDisplay = "0";
                const payrollChange = "0%";
                if (totalPayroll >= 1000000000) {
                    payrollDisplay = `${(totalPayroll / 1000000000).toFixed(1)} Tỷ`;
                } else if (totalPayroll >= 1000000) {
                    payrollDisplay = `${(totalPayroll / 1000000).toFixed(0)} Tr`;
                } else if (totalPayroll > 0) {
                    payrollDisplay = `${totalPayroll.toLocaleString('vi-VN')}`;
                }

                // Calculate average working hours this week
                const { getAttendanceRecords } = await import('@/lib/api/timekeeping');

                // Get start of current week (Monday)
                const weekStart = new Date(now);
                const dayOfWeek = weekStart.getDay();
                const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Adjust for Monday start
                weekStart.setDate(weekStart.getDate() - diff);
                weekStart.setHours(0, 0, 0, 0);

                const attendanceRecords = await getAttendanceRecords({
                    startDate: weekStart.toISOString().split('T')[0],
                    endDate: now.toISOString().split('T')[0]
                });

                // Calculate average hours worked
                const recordsWithHours = attendanceRecords.filter(r => r.hours_worked && r.hours_worked > 0);
                let avgHoursWorked = 0;
                let hoursChange = "+0h";

                if (recordsWithHours.length > 0) {
                    const totalHours = recordsWithHours.reduce((sum, r) => sum + (r.hours_worked || 0), 0);
                    avgHoursWorked = totalHours / recordsWithHours.length;
                    // Compare with standard 8 hour day
                    const hoursDiff = avgHoursWorked - 8;
                    hoursChange = hoursDiff >= 0 ? `+${hoursDiff.toFixed(1)}h` : `${hoursDiff.toFixed(1)}h`;
                }

                setStatsData(prev => [
                    {
                        ...prev[0], // Tổng Nhân viên
                        value: totalEmployees.toString(),
                        subtext: "nhân sự hiện tại"
                    },
                    {
                        ...prev[1], // Đang làm việc (Active)
                        value: activeEmployees.toString(),
                        change: `${totalEmployees > 0 ? Math.round((activeEmployees / totalEmployees) * 100) : 0}%`,
                        subtext: "đang hoạt động"
                    },
                    {
                        ...prev[2], // Quỹ lương - Now with real data
                        value: payrollDisplay,
                        change: payrollChange,
                        subtext: monthlySalaries.length > 0 ? `${monthlySalaries.length} nhân viên` : "chưa có dữ liệu"
                    },
                    {
                        ...prev[3], // Giờ làm trung bình - Now with real data
                        value: avgHoursWorked > 0 ? `${avgHoursWorked.toFixed(1)}h` : "0h",
                        change: hoursChange,
                        changeType: avgHoursWorked >= 8 ? "positive" : avgHoursWorked > 0 ? "negative" : "neutral",
                        subtext: recordsWithHours.length > 0 ? `${recordsWithHours.length} lượt chấm công` : "chưa có dữ liệu"
                    }
                ]);

                // Update Recent Activities (New Employees)
                // Sort by ID or joinDate if available to get "newest"
                // Assuming newer employees are at the end or we can sort. 
                // Let's just take the last 4 for now or mock "Activity" based on new employees.
                const recent = [...employees].reverse().slice(0, 5).map(emp => ({
                    id: emp.id,
                    name: emp.name,
                    position: emp.position,
                    joinDate: emp.join_date,
                    avatar: emp.name.split(' ').length > 1
                        ? `${emp.name.split(' ')[0][0]}${emp.name.split(' ')[emp.name.split(' ').length - 1][0]}`
                        : emp.name.substring(0, 2).toUpperCase()
                }));
                setRecentEmployees(recent);

            } catch (error) {
                console.error("Failed to fetch dashboard data", error);
            } finally {
                // Data fetching complete
            }
        }

        fetchDashboardData();
    }, []);

    const chartData = [30, 45, 35, 55, 48, 62, 40, 52, 58, 45, 60, 55];

    // Remove "Tạo mã QR" from quickActions
    const filteredQuickActions = quickActions.filter(action => action.label !== "Tạo mã QR");

    // Get greeting - always use user's full name
    const greeting = user?.fullName || "Người dùng";

    return (
        <div className="space-y-4 md:space-y-8">
            {/* Header - Compact on mobile */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 animate-fade-in">
                <div className="flex items-center justify-between sm:block">
                    <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Xin chào, <span className="text-blue-600 dark:text-blue-400">{greeting}</span> 👋
                    </h1>
                    {/* Mobile Clock - inline with greeting */}
                    <div className="sm:hidden">
                        <MobileRealTimeClock />
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm md:text-base hidden sm:block">
                        {isMember ? "Chúc bạn ngày làm việc hiệu quả!" : "Đây là báo cáo nhân sự hôm nay của bạn."}
                    </p>
                </div>
                {/* Desktop Clock */}
                <div className="hidden sm:block">
                    <RealTimeClock />
                </div>
            </div>

            {/* Quick Actions - Only show for admin/manager */}
            {isAdmin && (
                <div className="flex flex-wrap gap-3 animate-slide-up stagger-1">
                    {filteredQuickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                            <a
                                key={action.label}
                                href={action.href}
                                className={cn(
                                    "inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-medium rounded-xl shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl btn-glow",
                                    action.color
                                )}
                            >
                                <Icon className="w-4 h-4" />
                                {action.label}
                            </a>
                        );
                    })}
                </div>
            )}

            {/* Stats Grid - Only for managers - Compact on mobile */}
            {!isMember && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5">
                    {statsData.map((stat, index) => {
                        const Icon = stat.icon;
                        return (
                            <div
                                key={stat.name}
                                className="bg-white dark:bg-slate-800 p-3 md:p-6 rounded-xl md:rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm hover-lift opacity-0 animate-slide-up"
                                style={{ animationDelay: `${index * 100}ms`, animationFillMode: "forwards" }}
                            >
                                {/* Mobile: Compact inline layout */}
                                <div className="flex items-start justify-between gap-2 mb-2 md:mb-4">
                                    <div className={cn("p-2 md:p-3 rounded-lg md:rounded-xl transition-transform duration-200 hover:scale-110", stat.bgColor, "dark:bg-opacity-20")}>
                                        <Icon className={cn("w-4 h-4 md:w-6 md:h-6", stat.textColor)} />
                                    </div>
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-0.5 text-[10px] md:text-xs font-medium px-1.5 md:px-2.5 py-0.5 md:py-1 rounded-full",
                                            stat.changeType === "positive"
                                                ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                                : stat.changeType === "negative"
                                                    ? "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                                                    : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                        )}
                                    >
                                        {stat.changeType === "positive" && <TrendingUp className="w-2.5 h-2.5 md:w-3 md:h-3" />}
                                        {stat.changeType === "negative" && <TrendingDown className="w-2.5 h-2.5 md:w-3 md:h-3" />}
                                        <span className="hidden sm:inline">{stat.change}</span>
                                    </span>
                                </div>
                                <h3 className="text-xs md:text-sm font-medium text-slate-500 dark:text-slate-400 truncate">{stat.name}</h3>
                                <p className="text-lg md:text-2xl font-bold text-slate-900 dark:text-white mt-0.5 md:mt-1">{stat.value}</p>
                                <p className="text-[10px] md:text-xs text-slate-400 mt-0.5 md:mt-1 truncate hidden sm:block">{stat.subtext}</p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Charts and Activity - Only for managers */}
            {!isMember && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Main Chart */}
                    <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-6 opacity-0 animate-slide-up stagger-4" style={{ animationFillMode: "forwards" }}>
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="font-semibold text-slate-900 dark:text-white">Biến động nhân sự</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">12 tháng gần đây</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                                    Nhân viên mới
                                </span>
                                <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                                    Nghỉ việc
                                </span>
                            </div>
                        </div>

                        {/* Chart */}
                        <div className="h-56 flex items-end justify-between gap-2 px-2">
                            {chartData.map((value, index) => (
                                <div key={index} className="flex-1 flex flex-col items-center gap-2">
                                    <div className="w-full flex flex-col items-center gap-1">
                                        <div
                                            className="w-full bg-blue-500 rounded-t-md transition-all duration-700 opacity-0 animate-slide-up"
                                            style={{
                                                height: `${(value / 70) * 100}%`,
                                                minHeight: "20px",
                                                animationDelay: `${500 + index * 50}ms`,
                                                animationFillMode: "forwards"
                                            }}
                                        />
                                        <div
                                            className="w-full bg-slate-200 dark:bg-slate-600 rounded-t-md transition-all duration-700 opacity-0 animate-slide-up"
                                            style={{
                                                height: `${((70 - value) / 70) * 60}%`,
                                                minHeight: "8px",
                                                animationDelay: `${600 + index * 50}ms`,
                                                animationFillMode: "forwards"
                                            }}
                                        />
                                    </div>
                                    <span className="text-[10px] text-slate-400">T{index + 1}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Recent Activity (Replaced with Recent Employees) */}
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden opacity-0 animate-slide-up stagger-5" style={{ animationFillMode: "forwards" }}>
                        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-700">
                            <h3 className="font-semibold text-slate-900 dark:text-white">Nhân viên mới</h3>
                            <Activity className="w-5 h-5 text-slate-400" />
                        </div>
                        <div className="divide-y divide-slate-50 dark:divide-slate-700">
                            {recentEmployees.length > 0 ? recentEmployees.map((emp, index) => (
                                <div
                                    key={emp.id}
                                    className="flex items-center gap-3 p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer opacity-0 animate-slide-in"
                                    style={{ animationDelay: `${700 + index * 100}ms`, animationFillMode: "forwards" }}
                                >
                                    <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-white text-xs font-bold shadow-md">
                                        {emp.avatar}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-slate-900 dark:text-white truncate">
                                            <span className="font-medium">{emp.name}</span>
                                        </p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{emp.position} · {new Date(emp.joinDate).toLocaleDateString('vi-VN')}</p>
                                    </div>
                                </div>
                            )) : (
                                <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">Chưa có nhân viên nào</div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-100 dark:border-slate-700">
                            <a href="/dashboard/personnel" className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors group">
                                Xem tất cả nhân sự
                                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                            </a>
                        </div>
                    </div>

                    {/* Activity Log - Compact, right side only for non-members */}
                    {!isMember && (
                        <div className="opacity-0 animate-slide-up stagger-6" style={{ animationFillMode: "forwards" }}>
                            <ActivityLogWidget compact />
                        </div>
                    )}
                </div>
            )}

            {/* Member View - Simple welcome message */}
            {isMember && (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm p-8 text-center">
                    <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Users className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">Chào mừng bạn đến với Xưởng Cà Phê</h2>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-md mx-auto">
                        Sử dụng menu bên trái để chấm công, xem lịch làm việc và cập nhật thông tin cá nhân.
                    </p>
                    <div className="flex flex-wrap justify-center gap-3">
                        <a href="/dashboard/timekeeping" className="inline-flex items-center gap-2 px-5 py-2.5 gradient-primary text-white text-sm font-medium rounded-xl shadow-lg hover:shadow-xl transition-all">
                            <Clock className="w-4 h-4" />
                            Chấm công
                        </a>
                        <a href="/dashboard/my-profile" className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all">
                            <FileText className="w-4 h-4" />
                            Thông tin cá nhân
                        </a>
                    </div>
                </div>
            )}

            {/* Notifications Banner - Keep as placeholder but maybe hide if no data logic yet */}
            {/* 
            <div className="bg-gradient-to-r from-blue-600 to-cyan-500 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/20 opacity-0 animate-slide-up" style={{ animationDelay: "800ms", animationFillMode: "forwards" }}>
                ...
            </div> 
            */}
        </div>
    );
}

