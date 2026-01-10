"use client";

import { useState, useEffect } from "react";
import { Users, Plus, ArrowLeft, Receipt } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Mock data for now - will connect to Supabase later
const mockTables = [
    { id: "1", number: 1, zone: "Tầng 1", seats: 4, isOccupied: false },
    { id: "2", number: 2, zone: "Tầng 1", seats: 2, isOccupied: true, currentOrder: 45000 },
    { id: "3", number: 3, zone: "Tầng 1", seats: 4, isOccupied: false },
    { id: "4", number: 4, zone: "Tầng 1", seats: 6, isOccupied: true, currentOrder: 125000 },
    { id: "5", number: 5, zone: "Tầng 2", seats: 4, isOccupied: false },
    { id: "6", number: 6, zone: "Tầng 2", seats: 4, isOccupied: false },
    { id: "7", number: 7, zone: "Sân vườn", seats: 8, isOccupied: true, currentOrder: 280000 },
    { id: "8", number: 8, zone: "Sân vườn", seats: 4, isOccupied: false },
];

const zones = ["Tất cả", "Tầng 1", "Tầng 2", "Sân vườn"];

export default function FloorPlanPage() {
    const [selectedZone, setSelectedZone] = useState("Tất cả");
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const filteredTables = selectedZone === "Tất cả"
        ? mockTables
        : mockTables.filter(t => t.zone === selectedZone);

    const occupiedCount = mockTables.filter(t => t.isOccupied).length;
    const availableCount = mockTables.length - occupiedCount;
    const totalRevenue = mockTables.reduce((sum, t) => sum + (t.currentOrder || 0), 0);

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('vi-VN').format(value) + 'đ';
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-slate-900/80 backdrop-blur-xl border-b border-white/10">
                <div className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-4">
                        <Link href="/" className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                            <ArrowLeft className="w-6 h-6" />
                        </Link>
                        <div>
                            <h1 className="text-xl font-bold">Sơ đồ bàn</h1>
                            <p className="text-sm text-slate-400">Chọn bàn để gọi món</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-6">
                        {/* Quick Stats */}
                        <div className="hidden md:flex items-center gap-4 bg-white/5 rounded-2xl p-3">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-green-400"></div>
                                <span className="text-sm">{availableCount} trống</span>
                            </div>
                            <div className="h-4 w-px bg-white/20"></div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-blue-400"></div>
                                <span className="text-sm">{occupiedCount} đang phục vụ</span>
                            </div>
                            <div className="h-4 w-px bg-white/20"></div>
                            <div className="flex items-center gap-2">
                                <Receipt className="w-4 h-4 text-amber-400" />
                                <span className="text-sm font-bold text-amber-400">{formatCurrency(totalRevenue)}</span>
                            </div>
                        </div>
                        {/* Clock */}
                        <div className="text-right">
                            <p className="text-xl font-bold tabular-nums">
                                {time.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                            <p className="text-xs text-slate-400">
                                {time.toLocaleDateString("vi-VN", { weekday: "short", day: "numeric", month: "numeric" })}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Zone Tabs */}
                <div className="flex items-center gap-2 px-6 pb-4 overflow-x-auto">
                    {zones.map((zone) => (
                        <button
                            key={zone}
                            onClick={() => setSelectedZone(zone)}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-all",
                                selectedZone === zone
                                    ? "bg-blue-500 text-white"
                                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                            )}
                        >
                            {zone}
                        </button>
                    ))}
                </div>
            </header>

            {/* Tables Grid */}
            <main className="pt-40 pb-8 px-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {filteredTables.map((table) => (
                        <Link
                            key={table.id}
                            href={`/floor/order/${table.id}`}
                            className={cn(
                                "aspect-square rounded-2xl p-4 flex flex-col items-center justify-center gap-3 transition-all hover:scale-105 hover:shadow-xl border-2",
                                table.isOccupied
                                    ? "bg-blue-500/20 border-blue-400 hover:bg-blue-500/30"
                                    : "bg-white/5 border-white/10 hover:border-green-400 hover:bg-green-500/10"
                            )}
                        >
                            {/* Table Number */}
                            <div className={cn(
                                "w-16 h-16 rounded-xl flex items-center justify-center text-2xl font-bold",
                                table.isOccupied
                                    ? "bg-blue-500 text-white"
                                    : "bg-slate-700 text-slate-300"
                            )}>
                                {table.number}
                            </div>

                            {/* Status */}
                            <span className={cn(
                                "text-sm font-medium",
                                table.isOccupied ? "text-blue-400" : "text-slate-400"
                            )}>
                                {table.isOccupied ? "Có khách" : "Trống"}
                            </span>

                            {/* Order amount or seats */}
                            {table.isOccupied ? (
                                <span className="text-xs font-bold text-amber-400">
                                    {formatCurrency(table.currentOrder || 0)}
                                </span>
                            ) : (
                                <div className="flex items-center gap-1 text-xs text-slate-500">
                                    <Users className="w-3 h-3" />
                                    <span>{table.seats} chỗ</span>
                                </div>
                            )}
                        </Link>
                    ))}

                    {/* Takeaway Button */}
                    <Link
                        href="/floor/order/takeaway"
                        className="aspect-square rounded-2xl border-2 border-dashed border-slate-600 p-4 flex flex-col items-center justify-center gap-3 transition-all hover:border-green-400 hover:bg-green-500/10"
                    >
                        <div className="w-16 h-16 rounded-xl bg-green-500/20 flex items-center justify-center">
                            <Plus className="w-8 h-8 text-green-400" />
                        </div>
                        <span className="text-sm font-medium text-green-400">Mang đi</span>
                    </Link>
                </div>
            </main>
        </div>
    );
}
