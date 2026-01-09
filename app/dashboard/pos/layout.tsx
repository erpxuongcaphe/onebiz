"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useBranch } from "@/contexts/BranchContext";
import {
    LayoutGrid,
    ShoppingCart,
    Clock,
    Receipt,
    ArrowLeft
} from "lucide-react";

const posNavigation = [
    { name: "Sơ đồ bàn", href: "/dashboard/pos", icon: LayoutGrid },
    { name: "Đơn đang xử lý", href: "/dashboard/pos/orders", icon: ShoppingCart },
    { name: "Lịch sử", href: "/dashboard/pos/history", icon: Clock },
];

export default function POSLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const { currentBranch } = useBranch();

    return (
        <div className="flex flex-col h-[calc(100vh-80px)] -m-6 bg-slate-50 dark:bg-slate-900">
            {/* Top Bar */}
            <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
                {/* Left: Back & Title */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/dashboard"
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-lg font-bold text-slate-900 dark:text-white">Bán hàng (POS)</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            {currentBranch?.name || "Chọn chi nhánh"}
                        </p>
                    </div>
                </div>

                {/* Center: Navigation */}
                <nav className="hidden md:flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-700 rounded-xl">
                    {posNavigation.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all",
                                    isActive
                                        ? "bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm"
                                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                )}
                            >
                                <item.icon className="w-4 h-4" />
                                <span>{item.name}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Right: Receipt Icon */}
                <div className="flex items-center gap-2">
                    <button className="p-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                        <Receipt className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto">
                {children}
            </div>

            {/* Mobile Bottom Nav */}
            <div className="md:hidden flex items-center justify-around py-2 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
                {posNavigation.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={cn(
                                "flex flex-col items-center gap-1 p-2 rounded-lg transition-colors",
                                isActive
                                    ? "text-blue-600 dark:text-blue-400"
                                    : "text-slate-500 dark:text-slate-400"
                            )}
                        >
                            <item.icon className="w-5 h-5" />
                            <span className="text-[10px] font-medium">{item.name}</span>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
