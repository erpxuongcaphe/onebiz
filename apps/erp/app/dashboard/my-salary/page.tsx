"use client";

import { useState, useEffect, useRef } from "react";
import {
    FileText, Download, Calendar, Clock, ChevronLeft, ChevronRight,
    Loader2, DollarSign, AlertTriangle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
    getEmployeePayslipHistory,
    getPayslipTemplate,
    getEmployeeWorkHours,
    formatCurrency,
    formatMonth,
    MonthlyPayslip,
    PayslipTemplate,
    WorkHourDetail
} from "@/lib/api/payslips";
import { getEmployeeById } from "@/lib/api/employees";
import { Employee } from "@/lib/database.types";

export default function MySalaryPage() {
    const { user, isLoading: authLoading } = useAuth();
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [payslips, setPayslips] = useState<MonthlyPayslip[]>([]);
    const [selectedPayslip, setSelectedPayslip] = useState<MonthlyPayslip | null>(null);
    const [template, setTemplate] = useState<PayslipTemplate | null>(null);
    const [workHours, setWorkHours] = useState<WorkHourDetail[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showWorkDetails, setShowWorkDetails] = useState(false);
    const payslipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (user?.employeeId) {
            loadData();
        }
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

    const loadData = async () => {
        if (!user?.employeeId) return;
        setIsLoading(true);
        try {
            const [empData, history] = await Promise.all([
                getEmployeeById(user.employeeId),
                getEmployeePayslipHistory(user.employeeId)
            ]);
            setEmployee(empData);
            setPayslips(history);

            if (history.length > 0) {
                await selectPayslip(history[0]);
            }
        } catch (err) {
            console.error('Failed to load data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const selectPayslip = async (payslip: MonthlyPayslip) => {
        setSelectedPayslip(payslip);
        try {
            const [templateData, hoursData] = await Promise.all([
                getPayslipTemplate(payslip.branch_id || undefined),
                getEmployeeWorkHours(payslip.employee_id, payslip.month)
            ]);
            setTemplate(templateData);
            setWorkHours(hoursData);
        } catch (err) {
            console.error('Failed to load payslip details:', err);
        }
    };

    const handleDownload = async (format: 'pdf' | 'jpg') => {
        if (!payslipRef.current) return;

        // Dynamic import html2canvas
        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(payslipRef.current, {
            scale: 2,
            backgroundColor: '#ffffff'
        });

        if (format === 'jpg') {
            const link = document.createElement('a');
            link.download = `phieu-luong-${selectedPayslip?.month}.jpg`;
            link.href = canvas.toDataURL('image/jpeg', 0.9);
            link.click();
        } else {
            // PDF using jspdf
            const { jsPDF } = await import('jspdf');
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgWidth = 210;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
            pdf.save(`phieu-luong-${selectedPayslip?.month}.pdf`);
        }
    };

    if (authLoading || isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!user?.employeeId) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center mb-6">
                    <AlertTriangle className="w-12 h-12 text-amber-500" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Chưa liên kết nhân viên</h1>
                <p className="text-slate-500">Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="animate-fade-in">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Phiếu Lương Của Tôi</h1>
                <p className="text-slate-500 mt-1">Xem và tải phiếu lương hàng tháng</p>
            </div>

            {payslips.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-12 text-center">
                    <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <FileText className="w-10 h-10 text-slate-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900 mb-2">Chưa có phiếu lương</h2>
                    <p className="text-slate-500 text-sm">Phiếu lương sẽ hiển thị sau khi kế toán chốt lương hàng tháng.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    {/* Month Selector */}
                    <div className="lg:col-span-1">
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                            <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-blue-500" />
                                Chọn tháng
                            </h3>
                            <div className="space-y-1 max-h-80 overflow-y-auto">
                                {payslips.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => selectPayslip(p)}
                                        className={cn(
                                            "w-full text-left px-3 py-2 rounded-lg text-sm transition-all",
                                            selectedPayslip?.id === p.id
                                                ? "bg-blue-600 text-white"
                                                : "hover:bg-slate-100 text-slate-700"
                                        )}
                                    >
                                        <span className="font-medium">{formatMonth(p.month)}</span>
                                        <span className="block text-xs opacity-75 mt-0.5">
                                            {formatCurrency(p.net_salary)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Payslip Content */}
                    <div className="lg:col-span-3 space-y-4">
                        {/* Download buttons */}
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => handleDownload('jpg')}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-all"
                            >
                                <Download className="w-4 h-4" />
                                Tải JPG
                            </button>
                            <button
                                onClick={() => handleDownload('pdf')}
                                className="inline-flex items-center gap-2 px-4 py-2 gradient-primary text-white rounded-xl text-sm font-medium shadow-lg hover:shadow-xl transition-all"
                            >
                                <Download className="w-4 h-4" />
                                Tải PDF
                            </button>
                        </div>

                        {/* Payslip Card */}
                        <div
                            ref={payslipRef}
                            className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 lg:p-8"
                        >
                            {/* Company Header */}
                            {template && (
                                <div className="text-center mb-6 pb-6 border-b border-slate-200">
                                    {template.logo_url && (
                                        <>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src={template.logo_url}
                                                alt="Logo"
                                                className="h-12 mx-auto mb-2"
                                            />
                                        </>
                                    )}
                                    <h2 className="font-bold text-lg text-slate-900">{template.company_name}</h2>
                                    {template.company_address && (
                                        <p className="text-sm text-slate-500">{template.company_address}</p>
                                    )}
                                    <div className="flex justify-center gap-4 text-xs text-slate-400 mt-1">
                                        {template.company_phone && <span>📞 {template.company_phone}</span>}
                                        {template.company_email && <span>✉️ {template.company_email}</span>}
                                    </div>
                                    {template.company_tax_code && (
                                        <p className="text-xs text-slate-400">MST: {template.company_tax_code}</p>
                                    )}
                                </div>
                            )}

                            {/* Title */}
                            <div className="text-center mb-6">
                                <h1 className="text-xl font-bold text-blue-600">PHIẾU LƯƠNG</h1>
                                <p className="text-slate-500">{formatMonth(selectedPayslip?.month || '')}</p>
                            </div>

                            {/* Employee Info */}
                            {employee && (
                                <div className="bg-slate-50 rounded-xl p-4 mb-6">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <span className="text-slate-500">Họ tên:</span>
                                            <span className="font-medium text-slate-900 ml-2">{employee.name}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-500">Mã NV:</span>
                                            <span className="font-medium text-slate-900 ml-2">{employee.id}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-500">Chức vụ:</span>
                                            <span className="font-medium text-slate-900 ml-2">{employee.position}</span>
                                        </div>
                                        <div>
                                            <span className="text-slate-500">Phòng ban:</span>
                                            <span className="font-medium text-slate-900 ml-2">{employee.department}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Work Summary */}
                            {selectedPayslip && (
                                <div className="mb-6">
                                    <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-blue-500" />
                                        Tổng hợp công
                                    </h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="bg-blue-50 rounded-xl p-3 text-center">
                                            <p className="text-2xl font-bold text-blue-600">{selectedPayslip.work_days}</p>
                                            <p className="text-xs text-slate-500">Ngày công</p>
                                        </div>
                                        <div className="bg-green-50 rounded-xl p-3 text-center">
                                            <p className="text-2xl font-bold text-green-600">{selectedPayslip.regular_hours?.toFixed(1) || 0}</p>
                                            <p className="text-xs text-slate-500">Giờ thường</p>
                                        </div>
                                        <div className="bg-amber-50 rounded-xl p-3 text-center">
                                            <p className="text-2xl font-bold text-amber-600">{selectedPayslip.ot_hours?.toFixed(1) || 0}</p>
                                            <p className="text-xs text-slate-500">Giờ OT</p>
                                        </div>
                                        <div className="bg-red-50 rounded-xl p-3 text-center">
                                            <p className="text-2xl font-bold text-red-600">{selectedPayslip.late_count || 0}</p>
                                            <p className="text-xs text-slate-500">Đi trễ</p>
                                        </div>
                                    </div>

                                    {/* Toggle details */}
                                    <button
                                        onClick={() => setShowWorkDetails(!showWorkDetails)}
                                        className="mt-3 text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                                    >
                                        {showWorkDetails ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        {showWorkDetails ? 'Ẩn chi tiết' : 'Xem chi tiết'}
                                    </button>

                                    {showWorkDetails && (
                                        <div className="mt-3 max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                                            <table className="w-full text-sm">
                                                <thead className="bg-slate-50 sticky top-0">
                                                    <tr>
                                                        <th className="text-left px-3 py-2 font-medium text-slate-600">Ngày</th>
                                                        <th className="text-center px-3 py-2 font-medium text-slate-600">Vào</th>
                                                        <th className="text-center px-3 py-2 font-medium text-slate-600">Ra</th>
                                                        <th className="text-center px-3 py-2 font-medium text-slate-600">Giờ</th>
                                                        <th className="text-center px-3 py-2 font-medium text-slate-600">OT</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {workHours.map((wh, idx) => (
                                                        <tr key={idx} className="hover:bg-slate-50">
                                                            <td className="px-3 py-2">{new Date(wh.date).toLocaleDateString('vi-VN')}</td>
                                                            <td className="px-3 py-2 text-center">{wh.check_in ? new Date(wh.check_in).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                                                            <td className="px-3 py-2 text-center">{wh.check_out ? new Date(wh.check_out).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                                                            <td className="px-3 py-2 text-center font-medium">{wh.hours_worked.toFixed(1)}</td>
                                                            <td className="px-3 py-2 text-center text-amber-600">{wh.overtime_hours > 0 ? wh.overtime_hours.toFixed(1) : '-'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Salary Details */}
                            {selectedPayslip && (
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                        <DollarSign className="w-4 h-4 text-green-500" />
                                        Chi tiết lương
                                    </h3>

                                    {/* Income */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-600">Lương cơ bản</span>
                                            <span className="font-medium">{formatCurrency(selectedPayslip.base_salary || 0)}</span>
                                        </div>
                                        {(selectedPayslip.lunch_allowance || 0) > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-600">Phụ cấp cơm</span>
                                                <span className="font-medium">{formatCurrency(selectedPayslip.lunch_allowance)}</span>
                                            </div>
                                        )}
                                        {(selectedPayslip.transport_allowance || 0) > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-600">Phụ cấp xăng xe</span>
                                                <span className="font-medium">{formatCurrency(selectedPayslip.transport_allowance)}</span>
                                            </div>
                                        )}
                                        {(selectedPayslip.phone_allowance || 0) > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-600">Phụ cấp điện thoại</span>
                                                <span className="font-medium">{formatCurrency(selectedPayslip.phone_allowance)}</span>
                                            </div>
                                        )}
                                        {(selectedPayslip.other_allowance || 0) > 0 && (
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-600">Phụ cấp khác</span>
                                                <span className="font-medium">{formatCurrency(selectedPayslip.other_allowance)}</span>
                                            </div>
                                        )}
                                        {(selectedPayslip.bonus || 0) > 0 && (
                                            <div className="flex justify-between text-sm text-green-600">
                                                <span>Thưởng</span>
                                                <span className="font-medium">+{formatCurrency(selectedPayslip.bonus)}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex justify-between py-2 border-t border-slate-200">
                                        <span className="font-medium text-slate-700">Tổng thu nhập</span>
                                        <span className="font-bold text-slate-900">{formatCurrency(selectedPayslip.gross_salary)}</span>
                                    </div>

                                    {/* Deductions */}
                                    <div className="space-y-2">
                                        {(selectedPayslip.insurance_deduction || 0) > 0 && (
                                            <div className="flex justify-between text-sm text-red-600">
                                                <span>Bảo hiểm XH</span>
                                                <span className="font-medium">-{formatCurrency(selectedPayslip.insurance_deduction || 0)}</span>
                                            </div>
                                        )}
                                        {(selectedPayslip.pit_deduction || 0) > 0 && (
                                            <div className="flex justify-between text-sm text-red-600">
                                                <span>Thuế TNCN</span>
                                                <span className="font-medium">-{formatCurrency(selectedPayslip.pit_deduction || 0)}</span>
                                            </div>
                                        )}
                                        {(selectedPayslip.penalty || 0) > 0 && (
                                            <div className="flex justify-between text-sm text-red-600">
                                                <span>Phạt</span>
                                                <span className="font-medium">-{formatCurrency(selectedPayslip.penalty)}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Net Salary */}
                                    <div className="flex justify-between py-4 border-t-2 border-blue-500 bg-blue-50 rounded-xl px-4 -mx-4">
                                        <span className="font-bold text-blue-900">THỰC LÃNH</span>
                                        <span className="font-bold text-2xl text-blue-600">{formatCurrency(selectedPayslip.net_salary)}</span>
                                    </div>

                                    {selectedPayslip.notes && (
                                        <div className="text-sm text-slate-500 italic p-3 bg-slate-50 rounded-lg">
                                            Ghi chú: {selectedPayslip.notes}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Footer */}
                            {template?.footer_text && (
                                <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-500 italic">
                                    {template.footer_text}
                                </div>
                            )}

                            {/* Signature area */}
                            <div className="mt-8 pt-4 border-t border-slate-200 grid grid-cols-2 gap-8 text-center text-sm">
                                <div>
                                    <p className="font-medium text-slate-700">Người lập</p>
                                    <p className="text-slate-400 text-xs mt-1">(Ký, ghi rõ họ tên)</p>
                                    <div className="h-16"></div>
                                </div>
                                <div>
                                    <p className="font-medium text-slate-700">Người nhận</p>
                                    <p className="text-slate-400 text-xs mt-1">(Ký, ghi rõ họ tên)</p>
                                    <div className="h-16"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
