"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Package, ArrowRightLeft, AlertCircle, Settings } from "lucide-react";

const navigation = [
    { name: "Danh sách sản phẩm", href: "/dashboard/inventory/products", icon: Package },
    { name: "Nhập / Xuất kho", href: "/dashboard/inventory/movements", icon: ArrowRightLeft },
    { name: "Cảnh báo tồn kho", href: "/dashboard/inventory/alerts", icon: AlertCircle },
    { name: "Cấu hình", href: "/dashboard/inventory/settings", icon: Settings },
];

export default function InventoryLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <div className="flex flex-col h-full space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                        Quản lý Kho hàng
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400">
                        Quản lý sản phẩm, tồn kho và các giao dịch nhập xuất
                    </p>
                </div>
            </div>

            {/* Sub Navigation */}
            <div className="border-b border-slate-200 dark:border-slate-700">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    {navigation.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={cn(
                                    "group inline-flex items-center py-4 px-1 border-b-2 font-medium text-sm transition-colors",
                                    isActive
                                        ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                        : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:border-slate-600"
                                )}
                            >
                                <item.icon
                                    className={cn(
                                        "-ml-0.5 mr-2 h-5 w-5",
                                        isActive ? "text-blue-500 dark:text-blue-400" : "text-slate-400 group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-400"
                                    )}
                                    aria-hidden="true"
                                />
                                <span>{item.name}</span>
                            </Link>
                        );
                    })}
                </nav>
            </div>

            <div className="flex-1 overflow-auto">
                {children}
            </div>
        </div>
    );
}
