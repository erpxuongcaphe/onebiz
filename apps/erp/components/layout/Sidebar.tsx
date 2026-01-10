"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn, roleLabels } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getPendingCounts, PendingCounts } from "@/lib/api/pending-counts";
import { BranchSelector } from "@/components/layout/BranchSelector";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import {
    LayoutDashboard,
    Users,
    Calendar,
    Clock,
    Wallet,
    Building2,
    FolderTree,
    Shield,
    UserCog,
    LogOut,
    Sparkles,
    ChevronDown,
    Settings,
    FileText,
    CalendarCheck,
    Bell,
    BarChart3,
    Star,
    Package,
    ArrowRightLeft,
    AlertTriangle,
    ShoppingCart,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

// Menu item type definitions
type MenuItem = {
    name: string;
    href?: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    roles: string[];
    children?: MenuItem[];
    badgeKey?: 'leaveRequests' | 'attendance' | 'shiftRegistrations' | 'total'; // Key for pending badge
};

// Grouped navigation structure - Optimized for clarity
// Separated "My Account" from "HR Management" for cleaner UX
const baseNavigation: MenuItem[] = [
    // === 🏠 TỔNG QUAN ===
    {
        name: "Tổng quan",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Dashboard tổng hợp",
        roles: ["admin", "accountant", "branch_manager", "member"]
    },

    // === 🛒 BÁN HÀNG (POS) ===
    {
        name: "Bán hàng (POS)",
        href: "/dashboard/pos",
        icon: ShoppingCart,
        description: "Bán hàng tại quầy",
        roles: ["admin", "branch_manager", "accountant"]
    },

    // === 📦 KHO HÀNG ===
    {
        name: "Kho hàng",
        icon: Package,
        description: "Quản lý kho & tồn kho",
        roles: ["admin", "branch_manager", "accountant"],
        children: [
            { name: "Sản phẩm", href: "/dashboard/inventory/products", icon: Package, description: "Danh sách sản phẩm", roles: ["admin", "branch_manager", "accountant"] },
            { name: "Nhập/Xuất kho", href: "/dashboard/inventory/movements", icon: ArrowRightLeft, description: "Tạo phiếu nhập xuất", roles: ["admin", "branch_manager", "accountant"] },
            { name: "Cảnh báo", href: "/dashboard/inventory/alerts", icon: AlertTriangle, description: "SP sắp hết hàng", roles: ["admin", "branch_manager"] },
        ]
    },

    // === 👤 TÀI KHOẢN CỦA TÔI (ALL ROLES) ===
    {
        name: "Tài khoản",
        icon: Users,
        description: "Thông tin cá nhân",
        roles: ["admin", "accountant", "branch_manager", "member"],
        children: [
            { name: "Hồ sơ", href: "/dashboard/my-profile", icon: Users, description: "Thông tin cá nhân", roles: ["admin", "accountant", "branch_manager", "member"] },
            { name: "Lịch làm việc", href: "/dashboard/my-schedule", icon: Calendar, description: "Xem lịch của tôi", roles: ["admin", "accountant", "branch_manager", "member"] },
            { name: "Chấm công", href: "/dashboard/my-attendance", icon: Clock, description: "Xem chấm công", roles: ["admin", "accountant", "branch_manager", "member"] },
            { name: "Nghỉ phép", href: "/dashboard/my-leaves", icon: CalendarCheck, description: "Đơn nghỉ của tôi", roles: ["admin", "accountant", "branch_manager", "member"] },
            { name: "Phiếu lương", href: "/dashboard/my-salary", icon: Wallet, description: "Xem lương cá nhân", roles: ["admin", "accountant", "branch_manager", "member"] },
        ]
    },

    // === 👥 QUẢN LÝ HR (Admin/Manager only) ===
    {
        name: "Quản lý HR",
        icon: Users,
        description: "Quản lý nhân sự",
        roles: ["admin", "branch_manager", "accountant"],
        badgeKey: "total",
        children: [
            { name: "Nhân viên", href: "/dashboard/personnel", icon: Users, description: "Danh sách NV", roles: ["admin", "branch_manager"] },
            { name: "Lịch làm việc", href: "/dashboard/schedules", icon: Calendar, description: "Xếp ca làm", roles: ["admin", "branch_manager"] },
            { name: "Bảng chấm công", href: "/dashboard/timekeeping", icon: Clock, description: "Chấm công toàn bộ", roles: ["admin", "accountant", "branch_manager"] },
            { name: "Duyệt công", href: "/dashboard/approval", icon: Shield, description: "Duyệt chấm công", roles: ["admin", "accountant", "branch_manager"], badgeKey: "attendance" },
            { name: "Duyệt nghỉ phép", href: "/dashboard/leaves", icon: CalendarCheck, description: "Duyệt đơn nghỉ", roles: ["admin", "branch_manager"], badgeKey: "leaveRequests" },
            { name: "Bảng lương", href: "/dashboard/salary", icon: Wallet, description: "Tính lương", roles: ["admin", "accountant"] },
            { name: "Đánh giá KPI", href: "/dashboard/performance", icon: Star, description: "Hiệu suất NV", roles: ["admin", "branch_manager"] },
        ]
    },

    // === 📊 BÁO CÁO ===
    {
        name: "Báo cáo",
        href: "/dashboard/reports",
        icon: BarChart3,
        description: "Báo cáo & Thống kê",
        roles: ["admin", "accountant", "branch_manager"]
    },

    // === 🔔 THÔNG BÁO ===
    {
        name: "Thông báo",
        href: "/dashboard/notifications",
        icon: Bell,
        description: "Xem thông báo",
        roles: ["admin", "accountant", "branch_manager", "member"]
    },

    // === ⚙️ CÀI ĐẶT (Admin only) ===
    {
        name: "Cài đặt",
        icon: Settings,
        description: "Cấu hình hệ thống",
        roles: ["admin"],
        children: [
            { name: "Giờ làm việc", href: "/dashboard/settings", icon: Clock, description: "Cấu hình giờ", roles: ["admin"] },
            { name: "Chi nhánh", href: "/dashboard/branches", icon: Building2, description: "Quản lý CN", roles: ["admin"] },
            { name: "Phòng ban", href: "/dashboard/categories", icon: FolderTree, description: "Phòng & Chức vụ", roles: ["admin"] },
            { name: "Loại nghỉ phép", href: "/dashboard/leave-types", icon: CalendarCheck, description: "Cấu hình nghỉ", roles: ["admin"] },
            { name: "Mẫu phiếu lương", href: "/dashboard/payslip-template", icon: FileText, description: "Template lương", roles: ["admin", "accountant"] },
            { name: "Phân quyền", href: "/dashboard/permissions", icon: Shield, description: "Quản lý quyền", roles: ["admin"] },
            { name: "Users", href: "/dashboard/users", icon: UserCog, description: "Tài khoản", roles: ["admin"] },
        ]
    },
];

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { user, logout } = useAuth();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [hoveredItem, setHoveredItem] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
    const [pendingCounts, setPendingCounts] = useState<PendingCounts>({
        leaveRequests: 0,
        attendance: 0,
        shiftRegistrations: 0,
        total: 0
    });

    // Fetch pending counts
    const fetchPendingCounts = useCallback(async () => {
        if (!user || user.role === 'member') return;
        try {
            const counts = await getPendingCounts(user.role);
            setPendingCounts(counts);
        } catch (error) {
            console.error('Error fetching pending counts:', error);
        }
    }, [user]);

    // Fetch on mount and every 30 seconds
    useEffect(() => {
        fetchPendingCounts();
        const interval = setInterval(fetchPendingCounts, 30000);
        return () => clearInterval(interval);
    }, [fetchPendingCounts]);

    // Filter navigation based on user role, including children
    const filterByRole = (items: MenuItem[]): MenuItem[] => {
        return items
            .filter(item => user && item.roles.includes(user.role))
            .map(item => ({
                ...item,
                children: item.children ? filterByRole(item.children) : undefined
            }))
            .filter(item => !item.children || item.children.length > 0); // Remove empty groups
    };

    const navigation = filterByRole(baseNavigation);

    // Auto-expand group if any child is active
    useEffect(() => {
        navigation.forEach(item => {
            if (item.children) {
                const hasActiveChild = item.children.some(child => pathname === child.href);
                if (hasActiveChild && !expandedGroups.includes(item.name)) {
                    setExpandedGroups(prev => [...prev, item.name]);
                }
            }
        });
    }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    const toggleGroup = (groupName: string) => {
        setExpandedGroups(prev =>
            prev.includes(groupName)
                ? prev.filter(g => g !== groupName)
                : [...prev, groupName]
        );
    };

    const handleLogout = () => {
        logout();
        router.push("/login");
    };

    // Generate initials from user name
    const getInitials = (name: string) => {
        const words = name.split(' ');
        if (words.length >= 2) {
            return words[0][0] + words[words.length - 1][0];
        }
        return name.substring(0, 2).toUpperCase();
    };

    // Render a single menu item (for both parent and child)
    const renderMenuItem = (item: MenuItem, isChild: boolean = false, index: number = 0) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        const isHovered = hoveredItem === item.name;
        const hasChildren = item.children && item.children.length > 0;
        const isExpanded = expandedGroups.includes(item.name);

        // Get badge count for this item
        const badgeCount = item.badgeKey ? pendingCounts[item.badgeKey] : 0;

        // For parent with children - render as expandable button
        if (hasChildren) {
            return (
                <div key={item.name} className="relative">
                    <button
                        type="button"
                        onClick={() => toggleGroup(item.name)}
                        onMouseEnter={() => setHoveredItem(item.name)}
                        onMouseLeave={() => setHoveredItem(null)}
                        className={cn(
                            "w-full group flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-xl transition-all duration-200 relative overflow-hidden",
                            isExpanded
                                ? "bg-white/5 text-white"
                                : "text-slate-400 hover:bg-white/5 hover:text-white"
                        )}
                    >
                        <div className={cn(
                            "p-1.5 rounded-lg transition-all duration-200",
                            isExpanded ? "bg-blue-500/20" : "bg-white/5 group-hover:bg-white/10"
                        )}>
                            <Icon className={cn(
                                "w-4 h-4 transition-all duration-200",
                                isExpanded ? "text-blue-400" : "text-slate-400 group-hover:text-white"
                            )} />
                        </div>
                        <span className="flex-1 text-left">{item.name}</span>
                        {badgeCount > 0 && (
                            <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full animate-pulse">
                                {badgeCount > 99 ? '99+' : badgeCount}
                            </span>
                        )}
                        <ChevronDown className={cn(
                            "w-4 h-4 transition-transform duration-200",
                            isExpanded && "rotate-180"
                        )} />
                    </button>

                    {/* Children */}
                    <div className={cn(
                        "overflow-hidden transition-all duration-300 ease-in-out",
                        isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                    )}>
                        <div className="mt-1 ml-4 pl-4 border-l border-slate-700 space-y-1">
                            {item.children!.map((child, childIndex) => renderMenuItem(child, true, childIndex))}
                        </div>
                    </div>
                </div>
            );
        }

        // For regular items (no children) - render as Link
        return (
            <div key={item.name} className="relative">
                <Link
                    href={item.href!}
                    className={cn(
                        "group flex items-center gap-3 text-sm font-medium rounded-xl transition-all duration-200 relative overflow-hidden",
                        isChild ? "px-2.5 py-1.5" : "px-3 py-2",
                        isActive
                            ? "bg-gradient-to-r from-blue-600/20 to-cyan-600/10 text-blue-400 shadow-lg shadow-blue-900/10"
                            : "text-slate-400 hover:bg-white/5 hover:text-white"
                    )}
                    onClick={() => setIsMobileOpen(false)}
                    onMouseEnter={() => setHoveredItem(item.name)}
                    onMouseLeave={() => setHoveredItem(null)}
                    style={{ animationDelay: `${index * 50}ms` }}
                >
                    {/* Active indicator */}
                    {isActive && !isChild && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r-full" />
                    )}

                    <div className={cn(
                        "p-1.5 rounded-lg transition-all duration-200",
                        isChild ? "p-1" : "p-1.5",
                        isActive
                            ? "bg-blue-500/20"
                            : "bg-white/5 group-hover:bg-white/10"
                    )}>
                        <Icon className={cn(
                            "transition-all duration-200",
                            isChild ? "w-4 h-4" : "w-5 h-5",
                            isActive ? "text-blue-400" : "text-slate-400 group-hover:text-white",
                            isHovered && !isActive && "scale-110"
                        )} />
                    </div>

                    <span className="flex-1">{item.name}</span>

                    {/* Badge for pending items */}
                    {badgeCount > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
                            {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                    )}

                    {/* Hover glow effect */}
                    {isHovered && !isActive && (
                        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent rounded-xl" />
                    )}
                </Link>

                {/* Tooltip - only for non-child items */}
                {isHovered && !isChild && (
                    <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg shadow-xl z-50 whitespace-nowrap hidden lg:block animate-fade-in">
                        {item.description}
                        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-800" />
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            {/* No mobile header - using bottom nav only for app-like experience */}

            {/* Sidebar Container */}
            <div
                className={cn(
                    "fixed inset-y-0 left-0 z-40 w-72 bg-slate-900/95 backdrop-blur-2xl border-r border-white/5 text-slate-100 transform transition-all duration-300 ease-out md:translate-x-0 shadow-2xl",
                    isMobileOpen ? "translate-x-0" : "-translate-x-full"
                )}
            >
                <div className="flex h-full flex-col relative overflow-hidden">
                    {/* Decorative gradient orbs */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl" />
                    <div className="absolute bottom-20 left-0 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl" />

                    {/* Logo / Header */}
                    <div className="flex h-20 items-center justify-between px-6 relative">
                        <div className="flex items-center gap-3 group">
                            <div className="relative">
                                <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-blue-900/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                                    <span className="font-bold text-white text-lg">X</span>
                                </div>
                                <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-slate-900 animate-pulse-soft" />
                            </div>
                            <div>
                                <span className="font-bold text-lg tracking-tight text-white">Xưởng Cà Phê</span>
                                <div className="flex items-center gap-1 text-xs text-slate-400">
                                    <Sparkles className="w-3 h-3" />
                                    <span>ERP v1.0</span>
                                </div>
                            </div>
                        </div>
                        <ThemeToggle size="sm" />
                    </div>

                    {/* Branch Selector */}
                    <div className="px-4 pb-2">
                        <BranchSelector />
                    </div>

                    {/* Navigation */}
                    <nav className="flex-1 px-4 py-6 space-y-1.5 relative overflow-y-auto">
                        <div className="px-3 mb-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                            Menu Chính
                        </div>

                        {navigation.map((item, index) => renderMenuItem(item, false, index))}
                    </nav>

                    {/* User Profile / Footer */}
                    <div className="mt-auto p-4 border-t border-slate-700 bg-slate-900">
                        {/* User Info Card */}
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800 mb-3">
                            {/* Avatar with default male/female options */}
                            <div className="relative shrink-0">
                                <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg ring-2 ring-white/20">
                                    {/* Default Avatar - using initials with gradient */}
                                    <span className="text-white font-bold text-sm">
                                        {user ? getInitials(user.fullName) : "?"}
                                    </span>
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-slate-900" />
                            </div>

                            {/* User Details */}
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-white truncate">
                                    {user?.fullName || "Khách"}
                                </div>
                                <div className="text-[11px] text-slate-400 truncate">
                                    {user?.email || "Chưa đăng nhập"}
                                </div>
                            </div>

                            {/* Role Badge */}
                            {user && (
                                <span className={cn(
                                    "shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg",
                                    roleLabels[user.role].class
                                )}>
                                    {roleLabels[user.role].label}
                                </span>
                            )}
                        </div>

                        {/* Logout Button - Always Visible */}
                        <button
                            onClick={handleLogout}
                            className="flex items-center justify-center gap-2 w-full px-4 py-3 text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 rounded-xl transition-all duration-200 border border-red-500/20"
                        >
                            <LogOut className="w-4 h-4" />
                            <span>Đăng xuất</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Overlay for mobile */}
            {isMobileOpen && (
                <div
                    className="fixed inset-0 z-30 bg-slate-900/60 backdrop-blur-sm md:hidden animate-fade-in"
                    onClick={() => setIsMobileOpen(false)}
                />
            )}
        </>
    );
}
