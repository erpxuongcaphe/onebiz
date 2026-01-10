"use client";

import { useState, useEffect } from "react";
import { History, Calendar, Loader2, ArrowLeft, Download, TrendingUp, Building2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getPayrollHistory, PayrollHistorySummary } from "@/lib/api/payroll-history";
import { exportPayrollExcel, downloadBlob } from "@/lib/api/payslip-export";
import { getBranches, Branch } from "@/lib/api/timekeeping";

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0,
    }).format(value);
};

const formatMonth = (month: string) => {
    const [year, monthNum] = month.split('-');
    return `Tháng ${monthNum}/${year}`;
};

export default function SalaryHistoryPage() {
    const { user, isLoading: authLoading } = useAuth();
    const [history, setHistory] = useState<PayrollHistorySummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>("");

    const canView = user?.role === 'admin' || user?.role === 'accountant';

    useEffect(() => {
        loadBranches();
    }, []);

    useEffect(() => {
        loadHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedYear]);

    const loadBranches = async () => {
        try {
            const branchData = await getBranches();
            setBranches(branchData);
        } catch (err) {
            console.error('Failed to load branches:', err);
        }
    };

    const loadHistory = async () => {
        setIsLoading(true);
        try {
            const historyData = await getPayrollHistory({ year: selectedYear });
            setHistory(historyData);
        } catch (err) {
            console.error('Failed to load history:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportExcel = async (month: string, branchId?: string) => {
        try {
            const blob = await exportPayrollExcel(month, branchId || undefined);
            const branchName = branchId ? branches.find(b => b.id === branchId)?.name || 'Branch' : 'All';
            downloadBlob(blob, `Payroll_${month}_${branchName}.xlsx`);
        } catch (err) {
            console.error('Failed to export:', err);
            alert('Lỗi khi xuất file: ' + (err as Error).message);
        }
    };

    if (authLoading || !user) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!canView) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Không có quyền truy cập</h1>
                <p className="text-slate-500 max-w-md">
                    Trang lịch sử lương chỉ dành cho Quản trị viên và Kế toán.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="animate-fade-in">
                <Link
                    href="/dashboard/salary"
                    className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Quay lại Trang lương
                </Link>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Lịch sử bảng lương</h1>
                <p className="text-slate-500 mt-1">Xem lại các bảng lương đã chốt và xuất báo cáo</p>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <select
                        value={selectedYear}
                        onChange={e => setSelectedYear(parseInt(e.target.value))}
                        className="text-sm border-none focus:outline-none bg-transparent font-medium"
                    >
                        {[2026, 2025, 2024, 2023].map(year => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
                    <Building2 className="w-4 h-4 text-slate-400" />
                    <select
                        value={selectedBranch}
                        onChange={e => setSelectedBranch(e.target.value)}
                        className="text-sm border-none focus:outline-none bg-transparent font-medium"
                    >
                        <option value="">Tất cả chi nhánh</option>
                        {branches.map(branch => (
                            <option key={branch.id} value={branch.id}>{branch.name}</option>
                        ))}
                    </select>
                </div>
                <span className="text-sm text-slate-500">
                    {history.length} tháng có dữ liệu
                </span>
            </div>

            {/* Summary Cards */}
            {history.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl p-6 border border-blue-200">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-blue-500 rounded-lg">
                                <TrendingUp className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="font-semibold text-blue-900">Tổng chi năm {selectedYear}</h3>
                        </div>
                        <p className="text-2xl font-bold text-blue-600">
                            {formatCurrency(history.reduce((sum, h) => sum + h.totalNetSalary, 0))}
                        </p>
                        <p className="text-sm text-blue-700 mt-1">{history.length} tháng</p>
                    </div>

                    <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-2xl p-6 border border-green-200">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-green-500 rounded-lg">
                                <TrendingUp className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="font-semibold text-green-900">Trung bình/tháng</h3>
                        </div>
                        <p className="text-2xl font-bold text-green-600">
                            {formatCurrency(history.reduce((sum, h) => sum + h.totalNetSalary, 0) / (history.length || 1))}
                        </p>
                        <p className="text-sm text-green-700 mt-1">Tổng lương net</p>
                    </div>

                    <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl p-6 border border-amber-200">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-amber-500 rounded-lg">
                                <Download className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="font-semibold text-amber-900">Phiếu lương đã xuất</h3>
                        </div>
                        <p className="text-2xl font-bold text-amber-600">
                            {history.reduce((sum, h) => sum + h.totalExports, 0)}
                        </p>
                        <p className="text-sm text-amber-700 mt-1">Lần xuất</p>
                    </div>
                </div>
            )}

            {/* History Table */}
            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                </div>
            ) : history.length > 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="text-left text-xs font-semibold text-slate-600 px-4 py-3">Tháng</th>
                                    <th className="text-center text-xs font-semibold text-slate-600 px-3 py-3">Nhân viên</th>
                                    <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Tổng Gross</th>
                                    <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Tổng Net</th>
                                    <th className="text-center text-xs font-semibold text-slate-600 px-3 py-3">Đã chốt</th>
                                    <th className="text-center text-xs font-semibold text-slate-600 px-3 py-3">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {history.map((row, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50/50">
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900">{formatMonth(row.month)}</div>
                                            <div className="text-xs text-slate-500">{row.branchName || 'Tất cả'}</div>
                                        </td>
                                        <td className="px-3 py-3 text-center text-slate-700">{row.totalEmployees}</td>
                                        <td className="px-3 py-3 text-right text-slate-900 font-medium">
                                            {formatCurrency(row.totalGrossSalary)}
                                        </td>
                                        <td className="px-3 py-3 text-right text-green-600 font-semibold">
                                            {formatCurrency(row.totalNetSalary)}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <span className={cn(
                                                "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
                                                row.finalizedCount > 0
                                                    ? "bg-green-100 text-green-700"
                                                    : "bg-slate-100 text-slate-600"
                                            )}>
                                                {row.finalizedCount > 0 ? 'Đã chốt' : 'Nháp'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3">
                                            <div className="flex items-center justify-center gap-2">
                                                <Link
                                                    href={`/dashboard/salary/calculate?month=${row.month}`}
                                                    className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors"
                                                    title="Xem chi tiết & xuất phiếu lương từng nhân viên"
                                                >
                                                    <History className="w-4 h-4" />
                                                </Link>
                                                <button
                                                    onClick={() => handleExportExcel(row.month, selectedBranch || undefined)}
                                                    className="p-1.5 hover:bg-emerald-100 rounded-lg text-emerald-600 transition-colors"
                                                    title="Xuất Excel tổng hợp"
                                                >
                                                    <Download className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="bg-slate-50 rounded-2xl p-12 text-center">
                    <History className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-600">Chưa có lịch sử bảng lương cho năm {selectedYear}</p>
                </div>
            )}
        </div>
    );
}
