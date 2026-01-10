"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, Lock, User, Sparkles, AlertCircle, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LoginPage() {
    const router = useRouter();
    const { login, isAuthenticated, isLoading } = useAuth();

    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Redirect if already authenticated
    useEffect(() => {
        if (!isLoading && isAuthenticated) {
            router.push("/dashboard");
        }
    }, [isAuthenticated, isLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsSubmitting(true);

        const result = await login(username, password);

        if (result.success) {
            router.push("/dashboard");
        } else {
            setError(result.error || "Đã có lỗi xảy ra");
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-900">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex">
            {/* Left Side - Branding */}
            <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
                {/* Decorative Elements */}
                <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
                <div className="absolute bottom-0 right-0 w-80 h-80 bg-cyan-500/20 rounded-full blur-3xl" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-purple-500/10 rounded-full blur-2xl" />

                {/* Grid Pattern */}
                <div className="absolute inset-0 opacity-10">
                    <div className="absolute inset-0" style={{
                        backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), 
                                          linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
                        backgroundSize: '50px 50px'
                    }} />
                </div>

                {/* Content */}
                <div className="relative z-10 flex flex-col justify-center px-16 text-white">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-xl shadow-amber-500/30">
                            <span className="text-2xl font-bold">X</span>
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold">Xưởng Cà Phê</h1>
                            <div className="flex items-center gap-1.5 text-amber-300 text-sm">
                                <Sparkles className="w-4 h-4" />
                                <span>ERP System</span>
                            </div>
                        </div>
                    </div>

                    <h2 className="text-4xl font-bold leading-tight mb-4">
                        Hệ thống quản lý<br />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-300">
                            doanh nghiệp toàn diện
                        </span>
                    </h2>
                    <p className="text-slate-400 text-lg max-w-md">
                        Quản lý bán hàng, tồn kho, nhân sự và tài chính - Một nền tảng duy nhất cho tất cả.
                    </p>

                    <div className="mt-12 grid grid-cols-3 gap-6">
                        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                            <p className="text-3xl font-bold text-blue-400">500+</p>
                            <p className="text-sm text-slate-400 mt-1">Nhân viên</p>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                            <p className="text-3xl font-bold text-cyan-400">12</p>
                            <p className="text-sm text-slate-400 mt-1">Chi nhánh</p>
                        </div>
                        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10">
                            <p className="text-3xl font-bold text-purple-400">99%</p>
                            <p className="text-sm text-slate-400 mt-1">Uptime</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Side - Login Form */}
            <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-slate-50">
                <div className="w-full max-w-md">
                    {/* Mobile Logo */}
                    <div className="lg:hidden flex items-center gap-3 justify-center mb-10">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
                            <span className="text-xl font-bold text-white">X</span>
                        </div>
                        <span className="text-2xl font-bold text-slate-900">Xưởng Cà Phê</span>
                    </div>

                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100">
                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-slate-900">Đăng nhập</h2>
                            <p className="text-slate-500 mt-2">Vui lòng đăng nhập để tiếp tục</p>
                        </div>

                        {error && (
                            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700 animate-shake">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                <p className="text-sm">{error}</p>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Tên đăng nhập
                                </label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        className="w-full pl-12 pr-4 py-3.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-slate-50 focus:bg-white"
                                        placeholder="Nhập tên đăng nhập"
                                        required
                                        disabled={isSubmitting}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Mật khẩu
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-12 pr-12 py-3.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all bg-slate-50 focus:bg-white"
                                        placeholder="Nhập mật khẩu"
                                        required
                                        disabled={isSubmitting}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="w-5 h-5" />
                                        ) : (
                                            <Eye className="w-5 h-5" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                    <span className="text-sm text-slate-600">Ghi nhớ đăng nhập</span>
                                </label>
                                <a href="#" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                                    Quên mật khẩu?
                                </a>
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className={cn(
                                    "w-full py-3.5 text-white text-sm font-semibold rounded-xl shadow-lg transition-all duration-200",
                                    isSubmitting
                                        ? "bg-blue-400 cursor-not-allowed"
                                        : "bg-gradient-to-r from-blue-600 to-cyan-500 hover:shadow-xl hover:scale-[1.02] shadow-blue-500/30"
                                )}
                            >
                                {isSubmitting ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Đang đăng nhập...
                                    </span>
                                ) : (
                                    "Đăng nhập"
                                )}
                            </button>
                        </form>

                        <div className="mt-8 pt-6 border-t border-slate-100">
                            {/* Demo accounts removed for cleanup */}
                        </div>
                    </div>

                    <p className="text-center text-sm text-slate-400 mt-8">
                        © 2026 Xưởng Cà Phê ERP. All rights reserved.
                    </p>
                </div>
            </div>

            {/* Floating QR Attendance Button - Mobile Optimized */}
            <Link
                href="/attendance"
                className="fixed bottom-6 right-6 z-50 lg:bottom-8 lg:right-8 flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-2xl shadow-2xl shadow-green-500/30 hover:shadow-green-500/50 hover:scale-105 transition-all animate-pulse-subtle group"
            >
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center group-hover:bg-white/30 transition-colors">
                    <QrCode className="w-7 h-7" />
                </div>
                <div className="text-left">
                    <p className="text-sm font-bold">Chấm công nhanh</p>
                    <p className="text-xs text-green-100">Quét mã QR</p>
                </div>
            </Link>
        </div>
    );
}
