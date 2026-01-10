"use client";

import Link from "next/link";
import { Settings, Calculator, History, DollarSign, TrendingUp, Users, FileText, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

export default function SalaryLandingPage() {
    const { user, isLoading } = useAuth();

    const hasPermission = user?.role === 'admin' || user?.role === 'accountant';

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    if (!hasPermission) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6">
                    <DollarSign className="w-12 h-12 text-red-500" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Không có quyền truy cập</h1>
                <p className="text-slate-500 max-w-md">
                    Trang tính lương chỉ dành cho Quản trị viên và Kế toán.
                </p>
            </div>
        );
    }

    const modules = [
        {
            title: "Cấu hình lương",
            description: "Thiết lập mức lương cơ bản, phụ cấp, bảo hiểm và các thông số tính lương",
            icon: Settings,
            color: "blue",
            href: "/dashboard/salary/config",
            stats: "Lương tháng & giờ"
        },
        {
            title: "Tính lương",
            description: "Tính toán bảng lương hàng tháng dựa trên chấm công, nghỉ phép và làm thêm giờ",
            icon: Calculator,
            color: "green",
            href: "/dashboard/salary/calculate",
            stats: "Chốt & lưu bảng lương"
        },
        {
            title: "Lịch sử bảng lương",
            description: "Xem lịch sử bảng lương theo tháng, xuất phiếu lương và báo cáo",
            icon: History,
            color: "amber",
            href: "/dashboard/salary/history",
            stats: "Xuất file & so sánh"
        }
    ];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="animate-fade-in">
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">Quản lý lương</h1>
                <p className="text-slate-500 mt-2">Cấu hình, tính toán và quản lý bảng lương nhân viên</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 border border-blue-200">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-blue-500 rounded-lg">
                            <Users className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="font-semibold text-blue-900">Nhân viên</h3>
                    </div>
                    <p className="text-3xl font-bold text-blue-600">--</p>
                    <p className="text-sm text-blue-700 mt-1">Đang hoạt động</p>
                </div>

                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-2xl p-6 border border-green-200">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-green-500 rounded-lg">
                            <TrendingUp className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="font-semibold text-green-900">Tháng này</h3>
                    </div>
                    <p className="text-3xl font-bold text-green-600">--</p>
                    <p className="text-sm text-green-700 mt-1">Tổng lương phải trả</p>
                </div>

                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl p-6 border border-amber-200">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="p-2 bg-amber-500 rounded-lg">
                            <FileText className="w-5 h-5 text-white" />
                        </div>
                        <h3 className="font-semibold text-amber-900">Phiếu lương</h3>
                    </div>
                    <p className="text-3xl font-bold text-amber-600">--</p>
                    <p className="text-sm text-amber-700 mt-1">Đã xuất tháng này</p>
                </div>
            </div>

            {/* Module Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {modules.map((module) => {
                    const Icon = module.icon;
                    const colorClasses = {
                        blue: "from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700",
                        green: "from-green-500 to-green-600 hover:from-green-600 hover:to-green-700",
                        amber: "from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
                    };

                    return (
                        <Link key={module.href} href={module.href}>
                            <div className="group bg-white rounded-2xl border-2 border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden hover:border-slate-300">
                                {/* Icon header */}
                                <div className={cn(
                                    "bg-gradient-to-r p-6 transition-all",
                                    colorClasses[module.color as keyof typeof colorClasses]
                                )}>
                                    <div className="flex items-center justify-between">
                                        <Icon className="w-10 h-10 text-white" />
                                        <ArrowRight className="w-6 h-6 text-white/80 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="p-6">
                                    <h3 className="text-xl font-bold text-slate-900 mb-2">{module.title}</h3>
                                    <p className="text-slate-600 text-sm mb-4 line-clamp-2">{module.description}</p>
                                    <div className="flex items-center gap-2 text-xs text-slate-500">
                                        <div className="px-3 py-1 bg-slate-100 rounded-full">
                                            {module.stats}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>

            {/* Quick Links */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200">
                <h3 className="font-semibold text-slate-900 mb-4">Hướng dẫn sử dụng</h3>
                <div className="space-y-2 text-sm text-slate-600">
                    <p>1. <strong>Cấu hình lương:</strong> Thiết lập mức lươngcơ bản, phụ cấp và các thông số tính toán</p>
                    <p>2. <strong>Tính lương:</strong> Tính toán bảng lương hàng tháng dựa trên chấm công thực tế</p>
                    <p>3. <strong>Chốt bảng lương:</strong> Sau khi kiểm tra, chốt bảng lương để không thể chỉnh sửa</p>
                    <p>4. <strong>Xuất phiếu lương:</strong> Xuất phiếu lương PDF hoặc file Excel để lưu trữ và gửi nhân viên</p>
                </div>
            </div>
        </div>
    );
}
