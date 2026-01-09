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
    ArrowLeft,
    Menu
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
        <div className="flex flex-col h-[calc(100vh-64px)] md:h-[calc(100vh-80px)] -mx-4 -my-4 md:-m-8 relative overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-slate-100 font-sans">

            {/* Ambient Base Lighting (Decoration) */}
            <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-blue-500/10 dark:bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-purple-500/10 dark:bg-purple-600/10 rounded-full blur-[100px] pointer-events-none" />

            {/* Glassmorphism Header */}
            <div className="flex items-center justify-between px-4 md:px-6 py-3 z-50 backdrop-blur-xl bg-white/70 dark:bg-black/40 border-b border-white/20 dark:border-white/5 sticky top-0 shadow-sm">

                {/* Left: Back & Title */}
                <div className="flex items-center gap-4">
                    <Link
                        href="/dashboard"
                        className="group p-2.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/10 rounded-full transition-all duration-300 backdrop-blur-sm"
                    >
                        <ArrowLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                    </Link>
                    <div>
                        <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-400">
                            Bán hàng (POS)
                        </h1>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 mt-0.5 rounded-full bg-slate-100/50 dark:bg-white/5 w-fit">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                {currentBranch?.name || "Chọn chi nhánh"}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Center: Navigation (Floating Island) */}
                <nav className="hidden md:flex items-center gap-1 p-1.5 bg-white/50 dark:bg-white/5 backdrop-blur-md border border-white/20 dark:border-white/5 rounded-full shadow-lg shadow-black/5">
                    {posNavigation.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={cn(
                                    "flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-full transition-all duration-300 relative overflow-hidden",
                                    isActive
                                        ? "text-blue-600 dark:text-white shadow-sm"
                                        : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/40 dark:hover:bg-white/5"
                                )}
                            >
                                {isActive && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-white/80 to-white/40 dark:from-blue-600 dark:to-blue-500 opacity-100 dark:opacity-100 -z-10" />
                                )}
                                <item.icon className={cn("w-4 h-4", isActive && "animate-pulse")} />
                                <span>{item.name}</span>
                            </Link>
                        );
                    })}
                </nav>

                {/* Right: Actions */}
                <div className="flex items-center gap-3">
                    <button className="p-2.5 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 bg-white/50 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 rounded-full border border-transparent hover:border-slate-200 dark:hover:border-white/10 transition-all shadow-sm">
                        <Receipt className="w-5 h-5" />
                    </button>
                    <button className="md:hidden p-2.5 text-slate-500 dark:text-slate-400 bg-white/50 dark:bg-white/5 rounded-full">
                        <Menu className="w-5 h-5" />
                    </button>

                    {/* User Avatar Placeholder */}
                    <div className="hidden md:block w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 p-[2px]">
                        <div className="w-full h-full rounded-full bg-slate-50 dark:bg-slate-900 flex items-center justify-center overflow-hidden">
                            <img src="https://ui-avatars.com/api/?name=Admin&background=random" alt="User" className="w-full h-full object-cover" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto relative z-0">
                {children}
            </div>

            {/* Mobile Bottom Nav */}
            <nav className="md:hidden flex items-center justify-around py-3 px-2 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-t border-slate-200/50 dark:border-white/10 pb-safe">
                {posNavigation.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={cn(
                                "flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-300 min-w-[64px]",
                                isActive
                                    ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-white/10"
                                    : "text-slate-400 dark:text-slate-500"
                            )}
                        >
                            <item.icon className={cn("w-6 h-6", isActive && "fill-current opacity-20")} strokeWidth={isActive ? 2.5 : 2} />
                            <span className="text-[10px] font-medium">{item.name}</span>
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}
