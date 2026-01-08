"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    User, Mail, Phone, MapPin, Building2, Calendar, Briefcase, Loader2,
    Key, Eye, EyeOff, Save, FileText, Download, Clock, ChevronLeft, ChevronRight, DollarSign
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getEmployeeById } from "@/lib/api/employees";
import { Employee } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
    getEmployeePayslipHistory,
    getPayslipTemplate,
    getEmployeeWorkHours,
    getCurrentMonthWorkSummary,
    formatCurrency,
    formatMonth,
    MonthlyPayslip,
    PayslipTemplate,
    WorkHourDetail
} from "@/lib/api/payslips";
import { MyLeavesContent } from "@/components/MyLeavesContent";

type Tab = 'info' | 'payslip' | 'leaves';

interface CurrentMonthSummary {
    workDays: number;
    totalHours: number;
    otHours: number;
    lateCount: number;
    minRequired: number;
    percentComplete: number;
}

export default function MyProfilePage() {
    const router = useRouter();
    const { user, isLoading: authLoading } = useAuth();
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<Tab>('info');

    // Change password state
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Payslip state
    const [payslips, setPayslips] = useState<MonthlyPayslip[]>([]);
    const [selectedPayslip, setSelectedPayslip] = useState<MonthlyPayslip | null>(null);
    const [template, setTemplate] = useState<PayslipTemplate | null>(null);
    const [workHours, setWorkHours] = useState<WorkHourDetail[]>([]);
    const [showWorkDetails, setShowWorkDetails] = useState(false);
    const [payslipLoading, setPayslipLoading] = useState(false);
    const [currentMonthSummary, setCurrentMonthSummary] = useState<CurrentMonthSummary | null>(null);
    const payslipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
            return;
        }

        if (user?.employeeId) {
            fetchEmployee();
        } else {
            setIsLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, authLoading]);

    const fetchEmployee = async () => {
        if (!user?.employeeId) return;
        try {
            const data = await getEmployeeById(user.employeeId);
            setEmployee(data);
        } catch (err) {
            console.error('Failed to fetch employee:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Load payslips when switching to payslip tab
    useEffect(() => {
        if (activeTab === 'payslip' && user?.employeeId && payslips.length === 0) {
            loadPayslips();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, user?.employeeId]);

    const loadPayslips = async () => {
        if (!user?.employeeId) return;
        setPayslipLoading(true);
        try {
            // Load current month summary and history in parallel
            const [history, summary] = await Promise.all([
                getEmployeePayslipHistory(user.employeeId),
                getCurrentMonthWorkSummary(user.employeeId, employee?.employee_type || undefined)
            ]);
            setPayslips(history);
            setCurrentMonthSummary(summary);
            if (history.length > 0) {
                await selectPayslip(history[0]);
            }
        } catch (err) {
            console.error('Failed to load payslips:', err);
        } finally {
            setPayslipLoading(false);
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
        if (!selectedPayslip || !user?.employeeId) return;

        if (format === 'pdf') {
            try {
                const { exportPayslipPDF, openPayslipForPrint } = await import('@/lib/api/payslip-export');
                const html = await exportPayslipPDF(user.employeeId, selectedPayslip.month);
                openPayslipForPrint(html);
            } catch (err) {
                console.error('Failed to export PDF:', err);
                alert('Có lỗi khi xuất PDF: ' + (err as Error).message);
            }
            return;
        }

        if (!payslipRef.current) return;

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
        }
    };

    const handleChangePassword = async () => {
        setPasswordMessage(null);

        if (!currentPassword) {
            setPasswordMessage({ type: 'error', text: 'Vui lòng nhập mật khẩu hiện tại' });
            return;
        }
        if (!newPassword) {
            setPasswordMessage({ type: 'error', text: 'Vui lòng nhập mật khẩu mới' });
            return;
        }
        if (newPassword.length < 6) {
            setPasswordMessage({ type: 'error', text: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
            return;
        }
        if (newPassword !== confirmPassword) {
            setPasswordMessage({ type: 'error', text: 'Mật khẩu xác nhận không khớp' });
            return;
        }

        setIsChangingPassword(true);
        try {
            if (!user?.id) return;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: userData } = await (supabase as any)
                .from('users')
                .select('password')
                .eq('id', user.id)
                .single();

            if (!userData || userData.password !== currentPassword) {
                setPasswordMessage({ type: 'error', text: 'Mật khẩu hiện tại không đúng' });
                setIsChangingPassword(false);
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { error } = await (supabase as any)
                .from('users')
                .update({ password: newPassword })
                .eq('id', user.id);

            if (error) throw error;

            setPasswordMessage({ type: 'success', text: 'Đổi mật khẩu thành công!' });
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            console.error('Failed to change password:', err);
            setPasswordMessage({ type: 'error', text: 'Lỗi khi đổi mật khẩu. Vui lòng thử lại.' });
        } finally {
            setIsChangingPassword(false);
        }
    };

    if (authLoading || isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải...</span>
            </div>
        );
    }

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'Chưa cập nhật';
        return new Date(dateString).toLocaleDateString('vi-VN');
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Hồ sơ của tôi</h1>
                <p className="text-slate-500 mt-1">Thông tin cá nhân và phiếu lương</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b border-slate-200">
                <button
                    onClick={() => setActiveTab('info')}
                    className={cn(
                        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all",
                        activeTab === 'info'
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                    )}
                >
                    <User className="w-4 h-4 inline mr-2" />
                    Thông tin
                </button>
                <button
                    onClick={() => setActiveTab('payslip')}
                    className={cn(
                        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all",
                        activeTab === 'payslip'
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                    )}
                >
                    <FileText className="w-4 h-4 inline mr-2" />
                    Phiếu lương
                </button>
                <button
                    onClick={() => setActiveTab('leaves')}
                    className={cn(
                        "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all",
                        activeTab === 'leaves'
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-slate-500 hover:text-slate-700"
                    )}
                >
                    <Calendar className="w-4 h-4 inline mr-2" />
                    Nghỉ phép
                </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'info' && (
                <>
                    {!employee ? (
                        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                            <User className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                            <p className="text-slate-500">Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.</p>
                            <p className="text-sm text-slate-400 mt-2">Vui lòng liên hệ quản trị viên để được hỗ trợ.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Profile Card */}
                            <div className="lg:col-span-1 space-y-6">
                                <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
                                    <div className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-3xl font-bold mb-4">
                                        {employee.name?.charAt(0) || 'U'}
                                    </div>
                                    <h2 className="text-xl font-bold text-slate-900">{employee.name}</h2>
                                    <p className="text-slate-500">{employee.position || 'Chưa cập nhật'}</p>
                                    <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
                                        <Briefcase className="w-4 h-4" />
                                        {employee.department || 'Chưa có phòng ban'}
                                    </div>
                                </div>

                                {/* Change Password Card */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                                    <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                        <Key className="w-5 h-5 text-amber-500" />
                                        Đổi mật khẩu
                                    </h3>

                                    {passwordMessage && (
                                        <div className={cn(
                                            "mb-4 p-3 rounded-xl text-sm",
                                            passwordMessage.type === 'success'
                                                ? "bg-green-50 text-green-700"
                                                : "bg-red-50 text-red-700"
                                        )}>
                                            {passwordMessage.text}
                                        </div>
                                    )}

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                                Mật khẩu hiện tại
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={showCurrentPassword ? "text" : "password"}
                                                    value={currentPassword}
                                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                                    className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                    placeholder="Nhập mật khẩu hiện tại"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                                >
                                                    {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                                Mật khẩu mới
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={showNewPassword ? "text" : "password"}
                                                    value={newPassword}
                                                    onChange={(e) => setNewPassword(e.target.value)}
                                                    className="w-full px-4 py-2.5 pr-10 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                    placeholder="Tối thiểu 6 ký tự"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                                >
                                                    {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">
                                                Xác nhận mật khẩu mới
                                            </label>
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                placeholder="Nhập lại mật khẩu mới"
                                            />
                                        </div>

                                        <button
                                            onClick={handleChangePassword}
                                            disabled={isChangingPassword}
                                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 text-white rounded-xl font-medium hover:bg-amber-600 transition-all disabled:opacity-50"
                                        >
                                            {isChangingPassword ? (
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                            ) : (
                                                <Save className="w-5 h-5" />
                                            )}
                                            Đổi mật khẩu
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Info Cards */}
                            <div className="lg:col-span-2 space-y-4">
                                {/* Personal Info */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                                    <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                        <User className="w-5 h-5 text-blue-500" />
                                        Thông tin cá nhân
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <InfoItem label="Mã nhân viên" value={employee.id} />
                                        <InfoItem label="Ngày sinh" value={formatDate(employee.date_of_birth || '')} />
                                        <InfoItem label="CCCD/CMND" value={employee.identity_card || 'Chưa cập nhật'} />
                                        <InfoItem label="Loại hình" value={
                                            employee.employee_type === 'full_time_monthly' ? 'Fulltime (lương tháng)' :
                                                employee.employee_type === 'full_time_hourly' ? 'Fulltime (lương giờ)' :
                                                    employee.employee_type === 'part_time' ? 'Parttime' :
                                                        employee.employee_type === 'probation' ? 'Nhân viên thử việc' :
                                                            employee.employee_type === 'intern' ? 'Thực tập sinh' : 'Chưa cập nhật'
                                        } />
                                    </div>
                                </div>

                                {/* Contact Info */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                                    <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                        <Mail className="w-5 h-5 text-green-500" />
                                        Liên hệ
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <InfoItem label="Email" value={employee.email || 'Chưa cập nhật'} icon={<Mail className="w-4 h-4" />} />
                                        <InfoItem label="Số điện thoại" value={employee.phone || 'Chưa cập nhật'} icon={<Phone className="w-4 h-4" />} />
                                        <InfoItem label="Địa chỉ" value={employee.address || 'Chưa cập nhật'} icon={<MapPin className="w-4 h-4" />} className="md:col-span-2" />
                                    </div>
                                </div>

                                {/* Work Info */}
                                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                                    <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                                        <Building2 className="w-5 h-5 text-purple-500" />
                                        Thông tin công việc
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <InfoItem label="Phòng ban" value={employee.department || 'Chưa cập nhật'} />
                                        <InfoItem label="Chức vụ" value={employee.position || 'Chưa cập nhật'} />
                                        <InfoItem label="Ngày vào làm" value={formatDate(employee.join_date)} icon={<Calendar className="w-4 h-4" />} />
                                        <InfoItem
                                            label="Trạng thái"
                                            value={
                                                <span className={cn(
                                                    "px-2 py-1 rounded-full text-xs font-medium",
                                                    employee.status === 'active' ? "bg-green-100 text-green-700" :
                                                        employee.status === 'probation' ? "bg-amber-100 text-amber-700" :
                                                            "bg-slate-100 text-slate-700"
                                                )}>
                                                    {employee.status === 'active' ? 'Đang làm việc' :
                                                        employee.status === 'probation' ? 'Thử việc' : 'Nghỉ việc'}
                                                </span>
                                            }
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'payslip' && (
                <>
                    {payslipLoading ? (
                        <div className="flex items-center justify-center py-24">
                            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {/* Current Month Summary Card */}
                            {currentMonthSummary && (() => {
                                const now = new Date();
                                const monthLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
                                return (
                                    <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-xl">
                                        <h3 className="font-semibold mb-4 flex items-center gap-2">
                                            <Clock className="w-5 h-5" />
                                            Giờ làm tháng {monthLabel}
                                        </h3>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            <div className="bg-white/10 rounded-xl p-3 text-center">
                                                <p className="text-3xl font-bold">{currentMonthSummary.totalHours.toFixed(1)}</p>
                                                <p className="text-xs opacity-75">Tổng giờ làm</p>
                                            </div>
                                            <div className="bg-white/10 rounded-xl p-3 text-center">
                                                <p className="text-3xl font-bold">{currentMonthSummary.workDays}</p>
                                                <p className="text-xs opacity-75">Ngày công</p>
                                            </div>
                                            <div className="bg-white/10 rounded-xl p-3 text-center">
                                                <p className="text-3xl font-bold">{currentMonthSummary.otHours.toFixed(1)}</p>
                                                <p className="text-xs opacity-75">Giờ OT</p>
                                            </div>
                                            <div className="bg-white/10 rounded-xl p-3 text-center">
                                                <p className="text-3xl font-bold">{currentMonthSummary.lateCount}</p>
                                                <p className="text-xs opacity-75">Đi trễ</p>
                                            </div>
                                        </div>
                                        {/* Progress bar */}
                                        <div className="mt-4">
                                            <div className="flex justify-between text-sm mb-1">
                                                <span>Tiến độ: {currentMonthSummary.totalHours.toFixed(1)}/{currentMonthSummary.minRequired}h</span>
                                                <span className="font-bold">{currentMonthSummary.percentComplete}%</span>
                                            </div>
                                            <div className="h-3 bg-white/20 rounded-full overflow-hidden">
                                                <div
                                                    className={cn(
                                                        "h-full rounded-full transition-all",
                                                        currentMonthSummary.percentComplete >= 100
                                                            ? "bg-green-400"
                                                            : currentMonthSummary.percentComplete >= 75
                                                                ? "bg-yellow-400"
                                                                : "bg-white"
                                                    )}
                                                    style={{ width: `${Math.min(currentMonthSummary.percentComplete, 100)}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Payslip History Section */}
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
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img
                                                            src={template.logo_url}
                                                            alt="Logo"
                                                            className="h-12 mx-auto mb-2"
                                                        />
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
                    )}
                </>
            )}

            {/* Leaves Tab */}
            {activeTab === 'leaves' && (
                <MyLeavesContent />
            )}
        </div>
    );
}

function InfoItem({
    label,
    value,
    icon,
    className
}: {
    label: string;
    value: React.ReactNode;
    icon?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col gap-1", className)}>
            <span className="text-xs text-slate-500">{label}</span>
            <span className="text-sm font-medium text-slate-900 flex items-center gap-2">
                {icon && <span className="text-slate-400">{icon}</span>}
                {value}
            </span>
        </div>
    );
}

