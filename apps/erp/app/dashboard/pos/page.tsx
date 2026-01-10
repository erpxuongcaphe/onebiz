"use client";

import { useState, useEffect } from "react";
import { useBranch } from "@/contexts/BranchContext";
import { getTables, getZones } from "@/lib/api/tables";
import { getTodaySummary } from "@/lib/api/pos";
import { POSTable, FloorZone } from "@/lib/types/pos";
import {
    Plus,
    Users,
    ShoppingCart,
    TrendingUp,
    Coffee
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function POSFloorPlanPage() {
    const { currentBranch } = useBranch();
    const [tables, setTables] = useState<POSTable[]>([]);
    const [zones, setZones] = useState<FloorZone[]>([]);
    const [selectedZone, setSelectedZone] = useState<string>("all");
    const [isLoading, setIsLoading] = useState(true);
    const [summary, setSummary] = useState({
        totalOrders: 0,
        completedOrders: 0,
        totalRevenue: 0,
        avgOrderValue: 0
    });

    useEffect(() => {
        if (!currentBranch) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const [tablesData, zonesData, summaryData] = await Promise.all([
                    getTables(currentBranch.id),
                    getZones(currentBranch.id),
                    getTodaySummary(currentBranch.id)
                ]);
                setTables(tablesData);
                setZones(zonesData);
                setSummary(summaryData);
            } catch (error) {
                console.error("Failed to fetch POS data:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
        // Refresh every 30 seconds
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [currentBranch]);

    const filteredTables = selectedZone === "all"
        ? tables
        : tables.filter(t => t.zone_id === selectedZone);

    const occupiedTables = tables.filter(t => t.current_order_id).length;
    const availableTables = tables.length - occupiedTables;

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
    };

    if (!currentBranch) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-slate-500 dark:text-slate-400">Vui lòng chọn chi nhánh</p>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Bàn trống</p>
                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{availableTables}</p>
                        </div>
                        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
                            <Coffee className="w-6 h-6 text-green-600 dark:text-green-400" />
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Đang phục vụ</p>
                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{occupiedTables}</p>
                        </div>
                        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
                            <Users className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Đơn hôm nay</p>
                            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{summary.completedOrders}</p>
                        </div>
                        <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl">
                            <ShoppingCart className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                        </div>
                    </div>
                </div>
                <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Doanh thu</p>
                            <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{formatCurrency(summary.totalRevenue)}</p>
                        </div>
                        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                            <TrendingUp className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Zone Filter */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
                <button
                    onClick={() => setSelectedZone("all")}
                    className={cn(
                        "px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-colors",
                        selectedZone === "all"
                            ? "bg-blue-600 text-white"
                            : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}
                >
                    Tất cả ({tables.length})
                </button>
                {zones.map((zone) => {
                    const count = tables.filter(t => t.zone_id === zone.id).length;
                    return (
                        <button
                            key={zone.id}
                            onClick={() => setSelectedZone(zone.id)}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-colors",
                                selectedZone === zone.id
                                    ? "bg-blue-600 text-white"
                                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                            )}
                        >
                            {zone.name} ({count})
                        </button>
                    );
                })}
            </div>

            {/* Tables Grid */}
            {isLoading ? (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="aspect-square bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                    ))}
                </div>
            ) : filteredTables.length === 0 ? (
                <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                    <Coffee className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white">Chưa có bàn nào</h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Thêm bàn trong phần Cài đặt → Chi nhánh</p>
                </div>
            ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    {filteredTables.map((table) => {
                        const isOccupied = !!table.current_order_id;
                        return (
                            <Link
                                key={table.id}
                                href={`/dashboard/pos/order/${table.id}`}
                                className={cn(
                                    "aspect-square rounded-xl border-2 p-4 flex flex-col items-center justify-center gap-2 transition-all hover:scale-105 hover:shadow-lg",
                                    isOccupied
                                        ? "bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-600"
                                        : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-green-400 dark:hover:border-green-600"
                                )}
                            >
                                <div className={cn(
                                    "w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold",
                                    isOccupied
                                        ? "bg-blue-500 text-white"
                                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                )}>
                                    {table.table_number}
                                </div>
                                <span className={cn(
                                    "text-xs font-medium",
                                    isOccupied
                                        ? "text-blue-600 dark:text-blue-400"
                                        : "text-slate-500 dark:text-slate-400"
                                )}>
                                    {isOccupied ? "Có khách" : "Trống"}
                                </span>
                                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                                    <Users className="w-3 h-3" />
                                    <span>{table.seat_count}</span>
                                </div>
                            </Link>
                        );
                    })}

                    {/* Add Takeaway button */}
                    <Link
                        href="/dashboard/pos/order/takeaway"
                        className="aspect-square rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-4 flex flex-col items-center justify-center gap-2 transition-all hover:border-green-400 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-900/10"
                    >
                        <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                            <Plus className="w-6 h-6 text-green-600 dark:text-green-400" />
                        </div>
                        <span className="text-xs font-medium text-green-600 dark:text-green-400">Mang đi</span>
                    </Link>
                </div>
            )}
        </div>
    );
}
