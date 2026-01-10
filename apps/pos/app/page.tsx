"use client";

import Link from "next/link";
import { Coffee, ShoppingCart, Users, TrendingUp, Settings } from "lucide-react";

export default function POSHomePage() {
    return (
        <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-12">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-xl">
                        <Coffee className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold">OneBiz POS</h1>
                        <p className="text-slate-400">Hệ thống bán hàng</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums">
                        {new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                    <p className="text-slate-400">
                        {new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" })}
                    </p>
                </div>
            </div>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-4xl mx-auto">
                <Link
                    href="/floor"
                    className="aspect-square bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10 p-8 flex flex-col items-center justify-center gap-4 hover:bg-white/10 hover:scale-105 transition-all"
                >
                    <div className="w-20 h-20 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                        <ShoppingCart className="w-10 h-10 text-blue-400" />
                    </div>
                    <span className="text-xl font-semibold">Bán hàng</span>
                </Link>

                <Link
                    href="/orders"
                    className="aspect-square bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10 p-8 flex flex-col items-center justify-center gap-4 hover:bg-white/10 hover:scale-105 transition-all"
                >
                    <div className="w-20 h-20 rounded-2xl bg-green-500/20 flex items-center justify-center">
                        <Users className="w-10 h-10 text-green-400" />
                    </div>
                    <span className="text-xl font-semibold">Đơn hàng</span>
                </Link>

                <Link
                    href="/reports"
                    className="aspect-square bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10 p-8 flex flex-col items-center justify-center gap-4 hover:bg-white/10 hover:scale-105 transition-all"
                >
                    <div className="w-20 h-20 rounded-2xl bg-purple-500/20 flex items-center justify-center">
                        <TrendingUp className="w-10 h-10 text-purple-400" />
                    </div>
                    <span className="text-xl font-semibold">Báo cáo</span>
                </Link>

                <Link
                    href="/settings"
                    className="aspect-square bg-white/5 backdrop-blur-sm rounded-3xl border border-white/10 p-8 flex flex-col items-center justify-center gap-4 hover:bg-white/10 hover:scale-105 transition-all"
                >
                    <div className="w-20 h-20 rounded-2xl bg-orange-500/20 flex items-center justify-center">
                        <Settings className="w-10 h-10 text-orange-400" />
                    </div>
                    <span className="text-xl font-semibold">Cài đặt</span>
                </Link>
            </div>

            {/* Footer */}
            <div className="fixed bottom-6 inset-x-0 text-center">
                <p className="text-sm text-slate-500">© 2026 OneBiz. Powered by Xưởng Cà Phê</p>
            </div>
        </main>
    );
}
