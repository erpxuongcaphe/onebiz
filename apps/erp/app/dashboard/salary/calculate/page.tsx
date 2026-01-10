"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import PayslipPDFButton from "@/components/payroll/PayslipPDFButton";
import { Calculator, Save, Calendar, Loader2, ArrowLeft, Lock, Unlock, Download, Edit2, Check, X, Building2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getEmployees } from "@/lib/api/employees";
import { getMonthlySalaries } from "@/lib/api/monthly-salaries";
import { exportPayrollExcel, downloadBlob } from "@/lib/api/payslip-export";
import { getAttendanceRecords, getBranches, Branch } from "@/lib/api/timekeeping";
import { getLeaveRequests } from "@/lib/api/leave-management";
import { saveMonthlySalary } from "@/lib/api/monthly-salaries";
import { finalizePayroll, unfinalizePayroll } from "@/lib/api/payroll-calculation";
import { getUsers } from "@/lib/api/users";
import { getSystemConfigs, configsToObject } from "@/lib/api/system-configs";

const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0,
    }).format(value);
};

interface PayrollRow {
    employeeId: string;
    employeeName: string;
    workDays: number;
    otHours: number;
    baseSalary: number;
    lunchAllowance: number;
    transportAllowance: number;
    phoneAllowance: number;
    otherAllowance: number;
    kpiBonus: number;
    bonus: number;
    penalty: number;
    grossSalary: number;
    insuranceDeduction: number; // Restored
    pitDeduction: number;
    netSalary: number;
    branchId?: string | null;
    lunchAllowanceRate?: number; // Added for recalculation
    actualWorkDays: number;
    paidLeaveDays: number;
}

export default function SalaryCalculationPage() {
    const { user, isLoading: authLoading } = useAuth();
    const searchParams = useSearchParams();
    const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [payrollData, setPayrollData] = useState<PayrollRow[]>([]);
    const [editingCell, setEditingCell] = useState<{ rowIdx: number, field: string } | null>(null);
    const [editValue, setEditValue] = useState<string>("");
    const [isFinalized, setIsFinalized] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = useState<string>("");
    const [configs, setConfigs] = useState<Record<string, number>>({});

    const canEdit = user?.role === 'admin' || user?.role === 'accountant';

    useEffect(() => {
        loadConfigs();
    }, []);

    const loadConfigs = async () => {
        try {
            const systemConfigs = await getSystemConfigs('payroll');
            const configMap = configsToObject(systemConfigs);
            setConfigs(configMap);
        } catch (err) {
            console.error("Failed to load configs:", err);
            setConfigs({});
        }
    };

    const calculateDeductions = (gross: number, insuranceBase: number, currentConfigs: Record<string, number>) => {
        const insuranceRate = currentConfigs['payroll.insurance.employee_rate'] || 0.105;
        const personalDeduction = currentConfigs['payroll.tax.personal_deduction'] || 11000000;

        const insuranceDeduction = insuranceBase * insuranceRate;
        const taxableIncome = Math.max(0, gross - insuranceDeduction - personalDeduction);

        let pitDeduction = 0;
        if (taxableIncome > 0) {
            if (taxableIncome <= 5000000) pitDeduction = taxableIncome * 0.05;
            else if (taxableIncome <= 10000000) pitDeduction = 250000 + (taxableIncome - 5000000) * 0.1;
            else if (taxableIncome <= 18000000) pitDeduction = 750000 + (taxableIncome - 10000000) * 0.15;
            else pitDeduction = 1950000 + (taxableIncome - 18000000) * 0.2;
        }

        return { insuranceDeduction, pitDeduction };
    };

    // Read month from URL if provided
    useEffect(() => {
        const monthParam = searchParams.get('month');
        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
            setSelectedMonth(monthParam);
        }
    }, [searchParams]);

    useEffect(() => {
        loadBranches();
    }, []);

    const loadBranches = async () => {
        try {
            const branchData = await getBranches();
            setBranches(branchData);
        } catch (err) {
            console.error('Failed to load branches:', err);
        }
    };

    useEffect(() => {
        loadPayrollData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth]);


    const loadPayrollData = async () => {
        setIsLoading(true);
        try {
            // Check if saved payroll exists
            const existing = await getMonthlySalaries(selectedMonth);

            if (existing && existing.length > 0) {
                // Load from DB
                const employees = await getEmployees();
                // removed unused activeEmployees filter

                const rows: PayrollRow[] = existing.map(s => {
                    const emp = employees.find(e => e.id === s.employee_id);
                    return {
                        employeeId: s.employee_id,
                        employeeName: s.employee?.name || 'N/A',
                        workDays: s.work_days || 0,
                        otHours: s.ot_hours || 0,
                        baseSalary: s.base_salary || 0,
                        lunchAllowance: s.lunch_allowance || 0, // Read as Total
                        lunchAllowanceRate: emp?.lunch_allowance || 0, // Populate Rate
                        transportAllowance: s.transport_allowance || 0,
                        phoneAllowance: s.phone_allowance || 0,
                        otherAllowance: s.other_allowance || 0,
                        kpiBonus: s.kpi_bonus ?? ((s.kpi_target || 0) * ((s.kpi_percent || 100) / 100)),
                        bonus: s.bonus || 0,
                        penalty: s.penalty || 0,
                        grossSalary: s.gross_salary || 0,
                        insuranceDeduction: s.insurance_deduction || 0,
                        pitDeduction: s.pit_deduction || 0,
                        netSalary: s.net_salary || 0,
                        branchId: s.branch_id,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        actualWorkDays: (s as any).actual_work_days || 0,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        paidLeaveDays: (s as any).paid_leave_days || 0,
                    };
                });
                setPayrollData(rows);
                setIsFinalized(existing.some(s => s.is_finalized));
            } else {
                // Generate initial data from employees
                await generateInitialData();
            }
        } catch (err) {
            console.error('Failed to load payroll:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const generateInitialData = async () => {
        try {
            const employees = await getEmployees();
            const activeEmployees = employees.filter(e => e.status === 'active');

            // Get attendance data
            const [year, monthNum] = selectedMonth.split('-').map(Number);
            const lastDay = new Date(year, monthNum, 0).getDate();
            const startDate = `${selectedMonth}-01`;
            const endDate = `${selectedMonth}-${lastDay.toString().padStart(2, '0')}`;

            const [attendance, leaves, users] = await Promise.all([
                getAttendanceRecords({ startDate, endDate }),
                getLeaveRequests({ status: 'approved', startDate, endDate }),
                getUsers()
            ]);

            const rows: PayrollRow[] = activeEmployees.map(emp => {
                // Get attendance for this employee (checking both direct Employee ID and linked User ID)
                const empAttendance = attendance.filter(a => {
                    // 1. Direct match
                    if (a.employee_id === emp.id) return true;

                    // 2. User ID match (find user who owns this attendance record)
                    const user = users.find(u => u.id === a.employee_id);
                    // If that user is linked to current employee, then it's a match
                    if (user?.employeeId === emp.id) return true;

                    return false;
                });

                // === ALIGN WITH TIMEKEEPING SUMMARY LOGIC ===
                // 1. Work Days: Count ANY record with a check_in time (as seen in Timekeeping page)
                const workDays = empAttendance.filter(a => a.check_in != null).length;

                // 2. Total Hours: Sum of hours_worked
                const totalHours = empAttendance.reduce((sum, a) => sum + (a.hours_worked || 0), 0);

                // Count OT hours
                const otHours = empAttendance.reduce((sum, a) => sum + (a.overtime_hours || 0), 0);

                // Count paid leave days
                const empLeaves = leaves.filter(l => l.employee_id === emp.id && l.leave_type?.is_paid);
                const paidLeaveDays = empLeaves.reduce((sum, l) => sum + l.total_days, 0);

                // Count unpaid leave days (leave requests where is_paid = false)
                const empUnpaidLeaves = leaves.filter(l => l.employee_id === emp.id && !l.leave_type?.is_paid);
                const unpaidLeaveDays = empUnpaidLeaves.reduce((sum, l) => sum + l.total_days, 0);

                // === SALARY CALCULATION ===
                // Use employment_type or pay_type from DB (assuming 'employment_type' holds 'full_time', 'part_time' etc.)
                // Fallback to check if hourly_rate is present > 0 implies hourly?
                const isMonthly = (emp.employment_type === 'full_time' || emp.employment_type === 'full_time_monthly') || (!emp.hourly_rate && emp.salary);

                const baseSalary = emp.salary || 0;
                let grossSalary = 0;
                const standardWorkDays = 26; // Default standard work days for calculating daily rate

                if (isMonthly) {
                    // --- Monthly Salary Logic ---
                    // CORRECT LOGIC:
                    // - Full month work (regardless of 25, 26, 27 actual days) = Full Base Salary
                    // - Paid leave = Still counts as full month
                    // - Unpaid leave = Deduct: unpaidLeaveDays * (Base Salary / 26)

                    const dailyRate = baseSalary / standardWorkDays;
                    const unpaidDeduction = unpaidLeaveDays * dailyRate;

                    // Salary = Full Base - Unpaid Deduction
                    grossSalary = baseSalary - unpaidDeduction;
                } else {
                    // --- Hourly/Part-time Logic ---
                    // Salary = Hourly Rate * Total Hours
                    // Assuming emp.salary is HOURLY rate for part-time/intern/seasonal
                    // Or if emp.salary is monthly, convert to hourly? 
                    // Usually 'salary' field stores the rate based on contract type.
                    // If contract is 'part_time' or 'intern', assume 'salary' is hourly rate or calculate hourly from monthly.

                    // Let's assume for non-monthly, we pay by HOUR as requested by user ("tổng giờ đối với nhân viên lương giờ")
                    let hourlyRate = 0;
                    if (emp.hourly_rate) {
                        hourlyRate = emp.hourly_rate;
                    } else {
                        // Fallback: if they have a monthly salary set but are not full_time_monthly, maybe convert?
                        // But safer to assume 0 or derived if explicit hourly rate not present.
                        // For now, let's assume 'salary' column holds the rate appropriate for the contract.
                        hourlyRate = emp.salary || 20000; // Default 20k/hr if missing?
                    }

                    grossSalary = hourlyRate * totalHours;

                    // For display consistency in the table (which has "Work Days" and "Base Salary"),
                    // We might want to show Total Hours in a way or just keep using workDays for display column but calculate money differently.
                    // However, the user specifically asked to LINK totals.
                    // The table column is "Ngày công" (Work Days). For hourly staff, maybe we implies days or just keep days count.
                    // BUT the calculation MUST use hours.
                }

                // Allowances
                // Lunch: specific logic. e.g. 50k/day present
                const lunchPerDay = emp.lunch_allowance || 0;
                // Lunch only for actual days present (workDays), not paid leaves usually
                const lunchAllowance = lunchPerDay * workDays;

                const transportAllowance = emp.transport_allowance || 0;
                const phoneAllowance = emp.phone_allowance || 0;
                const otherAllowance = emp.other_allowance || 0;

                // OT pay
                const otMultiplier = configs['payroll.ot.weekday_multiplier'] || 1.5;
                let otHourlyRate = 0;
                if (isMonthly) {
                    otHourlyRate = (baseSalary / standardWorkDays) / 8;
                } else {
                    otHourlyRate = emp.salary || 0;
                }
                const otPay = otHours * otHourlyRate * otMultiplier;

                const kpiBonus = (emp.kpi_target || 0);
                const bonus = 0;
                const penalty = 0;

                // CALCULATED BASE PAY for display
                // For Monthly: Full Base - Unpaid Deduction
                // For Hourly: Hours * Rate
                let calculatedBasePay = 0;
                if (isMonthly) {
                    const dailyRate = baseSalary / standardWorkDays;
                    calculatedBasePay = baseSalary - (unpaidLeaveDays * dailyRate);
                } else {
                    calculatedBasePay = (emp.hourly_rate || (baseSalary / 26 / 8) || 20000) * totalHours;
                }

                grossSalary = calculatedBasePay + lunchAllowance + transportAllowance + phoneAllowance + otherAllowance + kpiBonus + otPay + bonus - penalty;

                // Insurance & Tax
                const insuranceBase = isMonthly ? baseSalary : calculatedBasePay;
                const { insuranceDeduction, pitDeduction } = calculateDeductions(grossSalary, insuranceBase, configs);

                const netSalary = grossSalary - insuranceDeduction - pitDeduction;

                return {
                    employeeId: emp.id,
                    employeeName: emp.name,
                    // For logic display: if monthly show days, if hourly show hours?
                    // But column header says "Ngày công" (Work Days).
                    // Maybe just show Work Days for consistency, but use Hours for calculation invisible.
                    workDays: workDays + paidLeaveDays,
                    otHours,
                    baseSalary: calculatedBasePay, // Showing the ACTUAL calculated pay for base component
                    lunchAllowance,
                    lunchAllowanceRate: emp.lunch_allowance || 0, // Store Rate for recalculation
                    transportAllowance,
                    phoneAllowance,
                    otherAllowance,
                    kpiBonus,
                    bonus,
                    penalty,
                    grossSalary,
                    insuranceDeduction,
                    pitDeduction,
                    netSalary,
                    branchId: emp.branch_id,
                    actualWorkDays: workDays,
                    paidLeaveDays: paidLeaveDays,
                };
            });

            setPayrollData(rows);
        } catch (err) {
            console.error('Failed to generate initial data:', err);
        }
    };

    const startEditing = (rowIdx: number, field: string, currentValue: number) => {
        setEditingCell({ rowIdx, field });
        setEditValue(currentValue.toString());
    };

    const cancelEditing = () => {
        setEditingCell(null);
        setEditValue("");
    };

    const saveEdit = (rowIdx: number, field: string) => {
        const newValue = parseFloat(editValue) || 0;
        const updatedData = [...payrollData];
        const row = { ...updatedData[rowIdx] };

        // Update the field
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (row as any)[field] = newValue;

        // Auto-recalculate Lunch Allowance if Work Days changes
        if (field === 'workDays') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rate = (row as any).lunchAllowanceRate || 0;
            row.lunchAllowance = rate * newValue;
        }

        // Recalculate totals
        const gross = row.baseSalary + row.lunchAllowance + row.transportAllowance +
            row.phoneAllowance + row.otherAllowance + row.kpiBonus + row.bonus - row.penalty;
        row.grossSalary = gross;

        // Recalculate Tax & Insurance
        const insuranceBase = row.baseSalary;
        const { insuranceDeduction, pitDeduction } = calculateDeductions(gross, insuranceBase, configs);
        row.insuranceDeduction = insuranceDeduction;
        row.pitDeduction = pitDeduction;

        row.netSalary = gross - row.insuranceDeduction - row.pitDeduction;

        updatedData[rowIdx] = row;
        setPayrollData(updatedData);
        cancelEditing();
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            for (const row of payrollData) {
                await saveMonthlySalary({
                    employee_id: row.employeeId,
                    month: selectedMonth,
                    branch_id: row.branchId,
                    base_salary: row.baseSalary,
                    work_days: row.workDays,
                    ot_hours: row.otHours,
                    lunch_allowance: row.lunchAllowance, // Store as TOTAL allowance for the month
                    transport_allowance: row.transportAllowance,
                    phone_allowance: row.phoneAllowance,
                    other_allowance: row.otherAllowance,
                    kpi_target: row.kpiBonus, // Legacy: Keep populating for now just in case
                    kpi_bonus: row.kpiBonus,   // New: Correct column
                    kpi_percent: 100,
                    bonus: row.bonus,
                    penalty: row.penalty,
                    gross_salary: row.grossSalary,
                    insurance_deduction: row.insuranceDeduction,
                    pit_deduction: row.pitDeduction,
                    net_salary: row.netSalary,
                    is_finalized: false,
                    actual_work_days: row.actualWorkDays,
                    paid_leave_days: row.paidLeaveDays
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any);
            }
            alert('Đã lưu bảng lương thành công!');
            await loadPayrollData();
        } catch (err) {
            console.error('Failed to save:', err);
            alert('Lỗi khi lưu: ' + (err as Error).message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleFinalize = async () => {
        if (!user) return;
        const confirm = window.confirm('Chốt bảng lương sẽ khóa không cho chỉnh sửa. Bạn có chắc chắn?');
        if (!confirm) return;

        try {
            const employeeIds = payrollData.map(p => p.employeeId);
            await finalizePayroll(selectedMonth, employeeIds, user.id, user.fullName);
            alert('Đã chốt bảng lương thành công!');
            await loadPayrollData();
        } catch (err) {
            console.error('Failed to finalize:', err);
            alert('Lỗi: ' + (err as Error).message);
        }
    };

    const handleUnfinalize = async () => {
        const confirm = window.confirm('Mở lại bảng lương để chỉnh sửa. Bạn có chắc chắn?');
        if (!confirm) return;

        try {
            const employeeIds = payrollData.map(p => p.employeeId);
            await unfinalizePayroll(selectedMonth, employeeIds);
            alert('Đã mở lại bảng lương!');
            await loadPayrollData();
        } catch (err) {
            console.error('Failed to unfinalize:', err);
            alert('Lỗi: ' + (err as Error).message);
        }
    };

    const handleExportExcel = async () => {
        try {
            const blob = await exportPayrollExcel(selectedMonth, selectedBranch || undefined);
            const branchName = selectedBranch ? branches.find(b => b.id === selectedBranch)?.name || 'Branch' : 'All';
            downloadBlob(blob, `Payroll_${selectedMonth}_${branchName}.xlsx`);
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

    if (!canEdit) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Không có quyền truy cập</h1>
                <p className="text-slate-500 max-w-md">
                    Trang tính lương chỉ dành cho Quản trị viên và Kế toán.
                </p>
            </div>
        );
    }

    const EditableCell = ({ value, rowIdx, field }: { value: number, rowIdx: number, field: string }) => {
        const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.field === field;

        // Admin and accountant can always edit, even after finalizing


        if (isEditing) {
            return (
                <div className="flex items-center gap-1">
                    <input
                        type="number"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        className="w-24 px-2 py-1 border border-blue-500 rounded text-sm"
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter') saveEdit(rowIdx, field);
                            if (e.key === 'Escape') cancelEditing();
                        }}
                    />
                    <button onClick={() => saveEdit(rowIdx, field)} className="text-green-600 hover:bg-green-100 p-1 rounded">
                        <Check className="w-3 h-3" />
                    </button>
                    <button onClick={cancelEditing} className="text-red-600 hover:bg-red-100 p-1 rounded">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            );
        }

        return (
            <div className="group flex items-center gap-2">
                <span>{field.includes('Salary') || field.includes('Allowance') || field.includes('Deduction') || field.includes('Bonus') || field.includes('Penalty') ? formatCurrency(value) : value}</span>
                <button
                    onClick={() => startEditing(rowIdx, field, value)}
                    className="opacity-0 group-hover:opacity-100 text-blue-600 hover:bg-blue-100 p-1 rounded transition-opacity"
                >
                    <Edit2 className="w-3 h-3" />
                </button>
            </div>
        );
    };

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
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Tính lương</h1>
                <p className="text-slate-500 mt-1">Tính toán và điều chỉnh bảng lương thủ công</p>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                    {/* Year Selector */}
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <select
                            value={selectedMonth.split('-')[0]}
                            onChange={e => setSelectedMonth(`${e.target.value}-${selectedMonth.split('-')[1] || '01'}`)}
                            className="text-sm border-none focus:outline-none bg-transparent font-medium"
                        >
                            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(year => (
                                <option key={year} value={year}>Năm {year}</option>
                            ))}
                        </select>
                    </div>

                    {/* Month Selector */}
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm">
                        <select
                            value={selectedMonth.split('-')[1]}
                            onChange={e => setSelectedMonth(`${selectedMonth.split('-')[0]}-${e.target.value}`)}
                            className="text-sm border-none focus:outline-none bg-transparent font-medium"
                        >
                            {Array.from({ length: 12 }, (_, i) => {
                                const month = (i + 1).toString().padStart(2, '0');
                                return <option key={month} value={month}>Tháng {i + 1}</option>;
                            })}
                        </select>
                    </div>

                    {/* Branch Selector */}
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

                    {isFinalized && (
                        <div className="px-4 py-2 bg-green-100 text-green-700 rounded-lg flex items-center gap-2">
                            <Lock className="w-4 h-4" />
                            Đã chốt
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {/* Admin and accountant can always access all buttons */}
                    <button
                        onClick={() => generateInitialData()}
                        disabled={isLoading}
                        className={cn(
                            "inline-flex items-center gap-2 px-5 py-2.5 bg-white border-2 border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:border-slate-300 transition-all",
                            isLoading && "opacity-50"
                        )}
                    >
                        <Calculator className="w-4 h-4" />
                        {isLoading ? "Đang tạo..." : "Tạo mới từ chấm công"}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || payrollData.length === 0}
                        className={cn(
                            "inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-medium rounded-xl shadow-lg transition-all gradient-primary hover:shadow-xl",
                            (isSaving || payrollData.length === 0) && "opacity-50"
                        )}
                    >
                        <Save className="w-4 h-4" />
                        {isSaving ? "Đang lưu..." : "Lưu"}
                    </button>
                    <button
                        onClick={handleFinalize}
                        disabled={payrollData.length === 0}
                        className={cn(
                            "inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-xl hover:bg-green-700 transition-all",
                            payrollData.length === 0 && "opacity-50"
                        )}
                    >
                        <Lock className="w-4 h-4" />
                        Chốt lương
                    </button>
                    {isFinalized && (
                        <button
                            onClick={handleUnfinalize}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white text-sm font-medium rounded-xl hover:bg-amber-700 transition-all"
                        >
                            <Unlock className="w-4 h-4" />
                            Mở lại
                        </button>
                    )}

                    {payrollData.length > 0 && (
                        <button
                            onClick={handleExportExcel}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-all"
                        >
                            <Download className="w-4 h-4" />
                            Xuất Excel
                        </button>
                    )}
                </div>
            </div >

            {/* Notice */}
            {
                !isFinalized && payrollData.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-blue-800">
                            <Edit2 className="w-4 h-4" />
                            <span className="font-semibold">Chế độ chỉnh sửa:</span>
                        </div>
                        <p className="text-sm text-blue-700 mt-1">
                            Di chuột vào các ô số liệu để chỉnh sửa. Nhấn vào biểu tượng <Edit2 className="w-3 h-3 inline" /> để sửa, nhập số mới rồi nhấn <b>Enter</b> để lưu hoặc <b>Esc</b> để hủy.
                        </p>
                    </div>
                )
            }

            {/* Data Table */}
            {
                isLoading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                    </div>
                ) : payrollData.length > 0 ? (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        <th className="text-left text-xs font-semibold text-slate-600 px-4 py-3 sticky left-0 bg-slate-50 z-10">Nhân viên</th>
                                        <th className="text-center text-xs font-semibold text-slate-600 px-3 py-3">Ngày công</th>
                                        <th className="text-center text-xs font-semibold text-slate-600 px-3 py-3">OT (h)</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Lương CB</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Phụ cấp ăn trưa</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Phụ cấp đi lại</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Phụ cấp ĐT</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Phụ cấp khác</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">KPI</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Thưởng</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Phạt</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3 bg-blue-50">Gross</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3 bg-red-50">BHXH</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3 bg-red-50">Thuế</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3 bg-green-50">Net</th>
                                        <th className="text-right text-xs font-semibold text-slate-600 px-3 py-3">Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {payrollData.map((row, idx) => (
                                        <tr key={row.employeeId} className="hover:bg-slate-50/50">
                                            <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-slate-50/50">
                                                <div className="font-medium text-slate-900">{row.employeeName}</div>
                                            </td>
                                            <td className="px-3 py-3 text-center text-slate-700">
                                                <div className="flex flex-col items-center">
                                                    <EditableCell value={row.workDays} rowIdx={idx} field="workDays" />
                                                    {(row.actualWorkDays > 0 || row.paidLeaveDays > 0) && (
                                                        <span className="text-[10px] text-slate-400 mt-1">
                                                            {row.actualWorkDays} làm + {row.paidLeaveDays} phép
                                                        </span>
                                                    )}
                                                    {/* Fallback if breakdown missing but total exists */}
                                                    {(row.actualWorkDays === 0 && row.paidLeaveDays === 0 && row.workDays > 0) && (
                                                        <span className="text-[10px] text-slate-400 mt-1">
                                                            (Nhập tay)
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-center text-amber-600">
                                                <EditableCell value={row.otHours} rowIdx={idx} field="otHours" />
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                <EditableCell value={row.baseSalary} rowIdx={idx} field="baseSalary" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-600">
                                                <EditableCell value={row.lunchAllowance} rowIdx={idx} field="lunchAllowance" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-600">
                                                <EditableCell value={row.transportAllowance} rowIdx={idx} field="transportAllowance" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-600">
                                                <EditableCell value={row.phoneAllowance} rowIdx={idx} field="phoneAllowance" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-slate-600">
                                                <EditableCell value={row.otherAllowance} rowIdx={idx} field="otherAllowance" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-blue-600">
                                                <EditableCell value={row.kpiBonus} rowIdx={idx} field="kpiBonus" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-green-600">
                                                <EditableCell value={row.bonus} rowIdx={idx} field="bonus" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-red-600">
                                                <EditableCell value={row.penalty} rowIdx={idx} field="penalty" />
                                            </td>
                                            <td className="px-3 py-3 text-right font-semibold text-slate-900 bg-blue-50/50">
                                                {formatCurrency(row.grossSalary)}
                                            </td>
                                            <td className="px-3 py-3 text-right text-red-600 bg-red-50/50">
                                                <EditableCell value={row.insuranceDeduction} rowIdx={idx} field="insuranceDeduction" />
                                            </td>
                                            <td className="px-3 py-3 text-right text-red-600 bg-red-50/50">
                                                <EditableCell value={row.pitDeduction} rowIdx={idx} field="pitDeduction" />
                                            </td>
                                            <td className="px-3 py-3 text-right font-bold text-green-600 bg-green-50/50">
                                                {formatCurrency(row.netSalary)}
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                <PayslipPDFButton
                                                    employeeId={row.employeeId}
                                                    month={selectedMonth}
                                                    variant="icon"
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="bg-slate-50 rounded-2xl p-12 text-center">
                        <Calculator className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-600 mb-4">Chưa có bảng lương cho tháng này</p>
                        <button
                            onClick={() => generateInitialData()}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700"
                        >
                            <Calculator className="w-4 h-4" />
                            Tạo bảng lương từ chấm công
                        </button>
                    </div>
                )
            }
        </div >
    );
}
