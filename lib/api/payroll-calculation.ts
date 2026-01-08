// Payroll Calculation API
// Centralized logic for calculating employee payroll with attendance, OT, leaves, insurance, and tax

import { supabase } from '../supabase';
import { Database } from '../database.types';
import { getAttendanceRecords } from './timekeeping';
import { getLeaveRequests } from './leave-management';
import { getSalaryConfigs, getConfigValue, calculatePIT } from './salary-config';
import { saveMonthlySalary } from './monthly-salaries';


type MonthlySalary = Database['public']['Tables']['monthly_salaries']['Row'];

export interface PayrollCalculationResult {
    employeeId: string;
    employeeName: string;
    month: string;

    // Work time
    actualWorkDays: number;
    paidLeaveDays: number;
    totalWorkDays: number;
    regularHours: number;
    otHours: number;

    // Salary components
    baseSalary: number;
    lunchAllowance: number;
    transportAllowance: number;
    phoneAllowance: number;
    otherAllowance: number;
    kpiBonus: number;
    otPay: number;
    bonus: number;
    penalty: number;

    // Totals
    grossSalary: number;
    insuranceDeduction: number;
    pitDeduction: number;
    netSalary: number;

    // Additional info
    hasInsurance: boolean;
    dependentsCount: number;
    taxableIncome: number;
    standardWorkDays: number;
    salaryBasedOnWorkDays: number;
}

/**
 * Calculate payroll for a single employee for a given month
 */
export async function calculateEmployeePayroll(
    employeeId: string,
    month: string,
    overrides?: Partial<{
        bonus: number;
        penalty: number;
        kpiPercent: number;
        insuranceOverride: number;
        pitOverride: number;
    }>
): Promise<PayrollCalculationResult> {
    // Get employee data
    const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('*')
        .eq('id', employeeId)
        .single();

    if (empError || !employee) {
        throw new Error(`Employee ${employeeId} not found`);
    }

    // Get salary configs
    const configs = await getSalaryConfigs((employee.pay_type as 'monthly' | 'hourly') || 'monthly');

    // Get attendance and leave data for the month
    const [year, monthNum] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNum, 0).getDate();
    const startDate = `${month}-01`;
    const endDate = `${month}-${lastDay.toString().padStart(2, '0')}`;

    const [attendance, leaves, holidaysResult] = await Promise.all([
        getAttendanceRecords({ startDate, endDate }),
        getLeaveRequests({ status: 'approved', startDate, endDate }),
        supabase.from('holidays').select('*')
    ]);

    const holidays = holidaysResult.data || [];

    // Filter attendance for this employee
    const validStatuses = ['approved', 'ontime', 'late'];
    const empAttendance = attendance.filter(a => {
        const matchesEmployee = a.employee_id === employeeId;
        const hasValidStatus = validStatuses.includes(a.status) || (a.hours_worked && a.hours_worked > 0);
        return matchesEmployee && hasValidStatus;
    });

    // Group attendance records by date - each day counts as max 1 work day (8h) + OT
    const attendanceByDate: Record<string, { totalHours: number; otHours: number }> = {};
    empAttendance.forEach(a => {
        // Extract date from check_in timestamp
        const checkInDate = a.check_in ? a.check_in.split('T')[0] : null;
        if (!checkInDate) return;

        if (!attendanceByDate[checkInDate]) {
            attendanceByDate[checkInDate] = { totalHours: 0, otHours: 0 };
        }
        attendanceByDate[checkInDate].totalHours += (a.hours_worked || 0);
        attendanceByDate[checkInDate].otHours += (a.overtime_hours || 0);
    });

    // Calculate work days and hours based on grouped data
    const minHours = getConfigValue(configs, 'min_hours_for_lunch') || 7;
    // Count days where total hours >= minHours (each day = max 1 work day)
    const actualWorkDays = Object.values(attendanceByDate).filter(d => d.totalHours >= minHours).length;
    // Regular hours: max 8h per day
    const regularHours = Object.values(attendanceByDate).reduce((sum, d) => sum + Math.min(d.totalHours, 8), 0);
    // OT hours: sum of all overtime
    const otHours = Object.values(attendanceByDate).reduce((sum, d) => sum + d.otHours, 0);

    // Calculate paid leave days
    const empLeaves = leaves.filter(l => l.employee_id === employeeId && l.leave_type?.is_paid);
    const paidLeaveDays = empLeaves.reduce((sum, l) => sum + l.total_days, 0);

    const totalWorkDays = actualWorkDays + paidLeaveDays;

    // Get salary components
    const baseSalary = employee.salary || getConfigValue(configs, 'base_salary');
    const lunchAllowancePerDay = employee.lunch_allowance ?? getConfigValue(configs, 'lunch_allowance');
    const transportAllowance = employee.transport_allowance ?? getConfigValue(configs, 'transport_allowance');
    const phoneAllowance = employee.phone_allowance ?? getConfigValue(configs, 'phone_allowance');
    const otherAllowance = employee.other_allowance ?? 0;
    const kpiTarget = employee.kpi_target || 0;

    // Calculate standard work days
    let calculatedStandardDays = 0;
    const daysInMonth = new Date(year, monthNum, 0).getDate(); // monthNum is 1-based from split

    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, monthNum - 1, day);
        const dayOfWeek = currentDate.getDay(); // 0 is Sunday

        // Skip Sundays
        if (dayOfWeek === 0) continue;

        // Check holidays
        const dateString = `${year}-${monthNum.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        const holidayMatch = holidays.find(h => {
            if (h.is_recurring) {
                // Check if MM-DD matches
                return h.date.slice(5) === dateString.slice(5);
            }
            return h.date === dateString;
        });

        if (holidayMatch) continue;

        calculatedStandardDays++;
    }

    // Use calculated days, fallback to config if calculation fails (safety, though unlikely)
    const standardWorkDays = calculatedStandardDays || (getConfigValue(configs, 'standard_work_days') || 26);

    // Calculate components
    const lunchAllowance = lunchAllowancePerDay * actualWorkDays; // Only for actual worked days
    const kpiPercent = overrides?.kpiPercent ?? 100;
    const kpiBonus = kpiTarget * (kpiPercent / 100);

    // Prorated Salary Calculation
    const dailyRate = baseSalary / standardWorkDays;
    const salaryBasedOnWorkDays = dailyRate * totalWorkDays;

    // OT pay calculation (1.5x hourly rate)
    const hourlyRate = baseSalary / standardWorkDays / 8; // Based on standard days
    const otPay = otHours * hourlyRate * 1.5;

    const bonus = overrides?.bonus ?? 0;
    const penalty = overrides?.penalty ?? 0;

    // Calculate gross salary
    // Use salaryBasedOnWorkDays instead of full baseSalary
    const grossSalary = salaryBasedOnWorkDays + lunchAllowance + transportAllowance + phoneAllowance + otherAllowance + kpiBonus + otPay + bonus - penalty;

    // Insurance deduction
    const hasInsurance = getConfigValue(configs, 'has_insurance') === 1;
    const bhxhPercent = getConfigValue(configs, 'bhxh_percent');
    const bhytPercent = getConfigValue(configs, 'bhyt_percent');
    const bhtnPercent = getConfigValue(configs, 'bhtn_percent');

    const insuranceDeduction = overrides?.insuranceOverride ?? (
        hasInsurance ? baseSalary * ((bhxhPercent + bhytPercent + bhtnPercent) / 100) : 0
    );

    // Tax calculation
    const dependentsCount = getConfigValue(configs, 'dependents_count');
    const personalDeduction = 11000000; // 11M VND
    const dependentDeduction = 4400000 * dependentsCount; // 4.4M per dependent
    const taxableIncome = Math.max(0, grossSalary - insuranceDeduction - personalDeduction - dependentDeduction);

    const pitDeduction = overrides?.pitOverride ?? calculatePIT(taxableIncome);

    // Net salary
    const netSalary = grossSalary - insuranceDeduction - pitDeduction;

    return {
        employeeId,
        employeeName: employee.name,
        month,
        actualWorkDays,
        paidLeaveDays,
        totalWorkDays,
        regularHours,
        otHours,
        baseSalary,
        lunchAllowance,
        transportAllowance,
        phoneAllowance,
        otherAllowance,
        kpiBonus,
        otPay,
        bonus,
        penalty,
        grossSalary,
        insuranceDeduction,
        pitDeduction,
        netSalary,
        hasInsurance,
        dependentsCount,
        taxableIncome,
        standardWorkDays,
        salaryBasedOnWorkDays
    };
}

/**
 * Calculate payroll for all active employees in bulk
 */
export async function calculateBulkPayroll(
    month: string,
    branchId?: string
): Promise<PayrollCalculationResult[]> {
    // Get active employees
    let query = supabase
        .from('employees')
        .select('id')
        .eq('status', 'active');

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data: employees, error } = await query;
    if (error) throw error;

    // Calculate payroll for each employee
    const results = await Promise.all(
        (employees || []).map(emp => calculateEmployeePayroll(emp.id, month))
    );

    return results;
}

/**
 * Save calculated payroll to database
 */
export async function savePayrollCalculation(
    calculation: PayrollCalculationResult,
    additionalData?: {
        notes?: string;
        kpiPercent?: number;
    }
): Promise<MonthlySalary> {
    const { data: employee } = await supabase
        .from('employees')
        .select('branch_id')
        .eq('id', calculation.employeeId)
        .single();

    return saveMonthlySalary({
        employee_id: calculation.employeeId,
        month: calculation.month,
        branch_id: employee?.branch_id,
        base_salary: calculation.baseSalary,
        lunch_allowance: calculation.lunchAllowance / calculation.totalWorkDays, // Store per-day rate
        transport_allowance: calculation.transportAllowance,
        phone_allowance: calculation.phoneAllowance,
        other_allowance: calculation.otherAllowance,
        work_days: calculation.totalWorkDays,
        regular_hours: calculation.regularHours,
        ot_hours: calculation.otHours,
        kpi_target: calculation.kpiBonus / (additionalData?.kpiPercent ?? 100) * 100, // Reverse calculate target
        kpi_percent: additionalData?.kpiPercent ?? 100,
        bonus: calculation.bonus,
        penalty: calculation.penalty,
        insurance_deduction: calculation.insuranceDeduction,
        pit_deduction: calculation.pitDeduction,
        gross_salary: calculation.grossSalary,
        net_salary: calculation.netSalary,
        is_finalized: false,
        notes: additionalData?.notes,
        updated_at: new Date().toISOString(),
        standard_work_days: calculation.standardWorkDays,
        actual_work_days: calculation.actualWorkDays,
        paid_leave_days: calculation.paidLeaveDays
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
}

/**
 * Finalize payroll (lock for editing)
 */
export async function finalizePayroll(
    month: string,
    employeeIds: string[],
    userId: string,
    userName: string
): Promise<void> {
    const { error } = await supabase
        .from('monthly_salaries')
        .update({
            is_finalized: true,
            finalized_at: new Date().toISOString(),
            finalized_by: userId,
            finalized_by_name: userName
        })
        .eq('month', month)
        .in('employee_id', employeeIds);

    if (error) throw error;
}

/**
 * Unfinalize payroll (unlock for editing)
 */
export async function unfinalizePayroll(
    month: string,
    employeeIds: string[]
): Promise<void> {
    const { error } = await supabase
        .from('monthly_salaries')
        .update({
            is_finalized: false,
            finalized_at: null,
            finalized_by: null,
            finalized_by_name: null
        })
        .eq('month', month)
        .in('employee_id', employeeIds);

    if (error) throw error;
}
