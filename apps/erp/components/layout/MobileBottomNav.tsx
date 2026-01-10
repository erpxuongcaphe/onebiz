"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
    LayoutDashboard,
    Users,
    ScanQrCode,
    Calendar,
    Menu,
    X,
    UserCog,
    DollarSign,
    Building2,
    Shield,
    FolderOpen,
    LogOut,
    Settings,
    BarChart3,
    Star,
    Bell,
    CalendarCheck,
    FileText,
} from "lucide-react";
import { useRouter } from "next/navigation";

// Main bottom nav items
const mainNavItems = [
    { name: "Trang chủ", href: "/dashboard", icon: LayoutDashboard },
    { name: "Nhân sự", href: "/dashboard/personnel", icon: Users, roles: ["admin", "branch_manager"] },
    { name: "Chấm công", href: "/attendance", icon: ScanQrCode, isCenter: true },
    { name: "Lịch làm", href: "/dashboard/schedules", icon: Calendar, roles: ["admin", "branch_manager"] },
    { name: "Menu", href: "#menu", icon: Menu, isMenu: true },
];

// All menu items for the drawer - different for each role
const allMenuItems = [
    // Personal items for all users
    { name: "Tổng quan", href: "/dashboard", icon: LayoutDashboard, roles: ["admin", "accountant", "branch_manager", "member"] },
    { name: "Hồ sơ tôi", href: "/dashboard/my-profile", icon: Users, roles: ["admin", "accountant", "branch_manager", "member"] },
    { name: "Chấm công tôi", href: "/dashboard/my-attendance", icon: ScanQrCode, roles: ["member"] },
    { name: "Lịch của tôi", href: "/dashboard/my-schedule", icon: Calendar, roles: ["member"] },
    { name: "Lương của tôi", href: "/dashboard/my-salary", icon: DollarSign, roles: ["member"] },
    { name: "Đăng ký ca", href: "/dashboard/shift-registration", icon: Calendar, roles: ["member"] },
    { name: "Nghỉ phép tôi", href: "/dashboard/my-leaves", icon: CalendarCheck, roles: ["member"] },
    { name: "Thông báo", href: "/dashboard/notifications", icon: Bell, roles: ["admin", "accountant", "branch_manager", "member"] },

    // Manager items
    { name: "Nhân sự", href: "/dashboard/personnel", icon: Users, roles: ["admin", "branch_manager"] },
    { name: "Lịch làm việc", href: "/dashboard/schedules", icon: Calendar, roles: ["admin", "branch_manager"] },
    { name: "Chấm công", href: "/dashboard/timekeeping", icon: ScanQrCode, roles: ["admin", "accountant", "branch_manager"] },
    { name: "Duyệt công", href: "/dashboard/approval", icon: Shield, roles: ["admin", "accountant", "branch_manager"] },
    { name: "Duyệt đăng ký ca", href: "/dashboard/shift-approval", icon: Calendar, roles: ["admin", "branch_manager"] },
    { name: "Duyệt nghỉ phép", href: "/dashboard/leaves", icon: CalendarCheck, roles: ["admin", "branch_manager"] },
    { name: "Tính Lương", href: "/dashboard/salary", icon: DollarSign, roles: ["admin", "accountant"] },
    { name: "Báo cáo", href: "/dashboard/reports", icon: BarChart3, roles: ["admin", "accountant", "branch_manager"] },
    { name: "Đánh giá", href: "/dashboard/performance", icon: Star, roles: ["admin", "branch_manager"] },

    // Admin config items
    { name: "Chi nhánh", href: "/dashboard/branches", icon: Building2, roles: ["admin"] },
    { name: "Danh mục", href: "/dashboard/categories", icon: FolderOpen, roles: ["admin"] },
    { name: "Loại nghỉ phép", href: "/dashboard/leave-types", icon: CalendarCheck, roles: ["admin"] },
    { name: "Phân quyền", href: "/dashboard/permissions", icon: Shield, roles: ["admin"] },
    { name: "Mẫu phiếu lương", href: "/dashboard/payslip-template", icon: FileText, roles: ["admin", "accountant"] },
    { name: "Quản lý Users", href: "/dashboard/users", icon: UserCog, roles: ["admin"] },
    { name: "Cài đặt", href: "/dashboard/settings", icon: Settings, roles: ["admin"] },
];

export function MobileBottomNav() {
    const pathname = usePathname();
    const router = useRouter();
    const { user, logout } = useAuth();
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Filter items based on user role
    const visibleMainItems = mainNavItems.filter(item => {
        if (!item.roles) return true;
        return user && item.roles.includes(user.role);
    });

    const visibleMenuItems = allMenuItems.filter(item => {
        return user && item.roles.includes(user.role);
    });

    const handleLogout = () => {
        logout();
        router.push("/login");
        setIsMenuOpen(false);
    };

    return (
        <>
            {/* Menu Drawer Overlay */}
            {isMenuOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
                    onClick={() => setIsMenuOpen(false)}
                />
            )}

            {/* Menu Drawer */}
            <div className={cn(
                "fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white dark:bg-slate-900 rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out",
                isMenuOpen ? "translate-y-0" : "translate-y-full"
            )}>
                {/* Drawer Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Menu</h3>
                    <button
                        onClick={() => setIsMenuOpen(false)}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Drawer Content */}
                <div className="px-4 py-4 max-h-[60vh] overflow-y-auto">
                    <div className="grid grid-cols-3 gap-3">
                        {visibleMenuItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = pathname === item.href;

                            return (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    onClick={() => setIsMenuOpen(false)}
                                    className={cn(
                                        "flex flex-col items-center gap-2 p-4 rounded-2xl transition-all",
                                        isActive
                                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                            : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                                    )}
                                >
                                    <Icon className="w-6 h-6" />
                                    <span className="text-xs font-medium text-center">{item.name}</span>
                                </Link>
                            );
                        })}
                    </div>

                    {/* Logout button */}
                    <button
                        onClick={handleLogout}
                        className="mt-4 w-full flex items-center justify-center gap-2 py-3 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 font-medium rounded-xl hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <LogOut className="w-5 h-5" />
                        Đăng xuất
                    </button>
                </div>

                {/* Safe area padding */}
                <div className="h-6" />
            </div>

            {/* Bottom Navigation Bar */}
            <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden">
                {/* Floating QR Button */}
                <div className="absolute left-1/2 -translate-x-1/2 -top-6 z-10">
                    <Link
                        href="/attendance"
                        className="relative flex flex-col items-center group"
                    >
                        {/* Badge */}
                        <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full shadow-lg animate-pulse z-20">
                            QR
                        </span>

                        {/* Main Button */}
                        <div className={cn(
                            "w-16 h-16 rounded-2xl flex items-center justify-center shadow-xl transition-all duration-300",
                            "bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600",
                            "group-hover:scale-110 group-hover:shadow-2xl group-hover:shadow-blue-500/40",
                            "border-4 border-white",
                            pathname === "/attendance" && "ring-4 ring-blue-300 ring-offset-2"
                        )}>
                            <ScanQrCode className="w-7 h-7 text-white" />
                        </div>

                        {/* Label */}
                        <span className="mt-1 text-[10px] font-semibold text-blue-600">Chấm công</span>
                    </Link>
                </div>

                {/* Navigation Bar */}
                <nav className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 shadow-lg">
                    <div className="flex items-end justify-around px-2 pt-2 pb-6 safe-area-bottom">
                        {visibleMainItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = pathname === item.href;

                            // Skip center item as it's the floating button
                            if (item.isCenter) {
                                return (
                                    <div key={item.name} className="w-16" /> // Spacer for center button
                                );
                            }

                            // Menu button
                            if (item.isMenu) {
                                return (
                                    <button
                                        key={item.name}
                                        onClick={() => setIsMenuOpen(true)}
                                        className={cn(
                                            "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 min-w-[60px]",
                                            isMenuOpen
                                                ? "text-blue-600"
                                                : "text-slate-400 hover:text-slate-600"
                                        )}
                                    >
                                        <div className={cn(
                                            "p-2 rounded-xl transition-all duration-200",
                                            isMenuOpen && "bg-blue-50"
                                        )}>
                                            <Icon className={cn(
                                                "w-5 h-5 transition-all",
                                                isMenuOpen && "scale-110"
                                            )} />
                                        </div>
                                        <span className={cn(
                                            "text-[10px] font-medium",
                                            isMenuOpen && "font-semibold"
                                        )}>
                                            {item.name}
                                        </span>
                                    </button>
                                );
                            }

                            return (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    className={cn(
                                        "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 min-w-[60px]",
                                        isActive
                                            ? "text-blue-600 dark:text-blue-400"
                                            : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
                                    )}
                                >
                                    <div className={cn(
                                        "p-2 rounded-xl transition-all duration-200",
                                        isActive && "bg-blue-50 dark:bg-blue-900/20"
                                    )}>
                                        <Icon className={cn(
                                            "w-5 h-5 transition-all",
                                            isActive && "scale-110"
                                        )} />
                                    </div>
                                    <span className={cn(
                                        "text-[10px] font-medium",
                                        isActive && "font-semibold"
                                    )}>
                                        {item.name}
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </nav>
            </div>
        </>
    );
}

