// Payroll History API
// Functions for managing and querying payroll history

import { supabase } from '../supabase';
import { Database } from '../database.types';

type MonthlySalary = Database['public']['Tables']['monthly_salaries']['Row'];

export interface PayrollHistoryFilters {
    year?: number;
    month?: string; // YYYY-MM format
    branchId?: string;
    isFinalized?: boolean;
    employeeId?: string;
}

export interface PayrollHistorySummary {
    month: string;
    branchId: string | null;
    branchName: string | null;
    totalEmployees: number;
    totalGrossSalary: number;
    totalNetSalary: number;
    totalInsuranceDeduction: number;
    totalPitDeduction: number;
    avgNetSalary: number;
    finalizedCount: number;
    firstFinalizedAt: string | null;
    lastFinalizedAt: string | null;
    totalExports: number;
}

export interface EmployeeSalaryHistory {
    employeeId: string;
    employeeName: string;
    department: string | null;
    position: string | null;
    month: string;
    payslipNumber: string | null;
    baseSalary: number | null;
    workDays: number | null;
    otHours: number | null;
    grossSalary: number | null;
    insuranceDeduction: number | null;
    pitDeduction: number | null;
    netSalary: number | null;
    isFinalized: boolean | null;
    finalizedAt: string | null;
    finalizedByName: string | null;
    exportedCount: number | null;
    lastExportedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface MonthlyComparison {
    month1: string;
    month2: string;
    summary1: PayrollHistorySummary;
    summary2: PayrollHistorySummary;
    differences: {
        employeeCountChange: number;
        grossSalaryChange: number;
        netSalaryChange: number;
        avgNetSalaryChange: number;
    };
}

/**
 * Get payroll history summary with filters
 */
export async function getPayrollHistory(
    filters: PayrollHistoryFilters = {}
): Promise<PayrollHistorySummary[]> {
    let query = supabase
        .from('payroll_history_view')
        .select('*');

    if (filters.year) {
        const yearStr = filters.year.toString();
        query = query.ilike('month', `${yearStr}-%`);
    }

    if (filters.month) {
        query = query.eq('month', filters.month);
    }

    if (filters.branchId) {
        query = query.eq('branch_id', filters.branchId);
    }

    query = query.order('month', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(row => ({
        month: row.month || '',
        branchId: row.branch_id,
        branchName: row.branch_name,
        totalEmployees: row.total_employees || 0,
        totalGrossSalary: row.total_gross_salary || 0,
        totalNetSalary: row.total_net_salary || 0,
        totalInsuranceDeduction: row.total_insurance_deduction || 0,
        totalPitDeduction: row.total_pit_deduction || 0,
        avgNetSalary: row.avg_net_salary || 0,
        finalizedCount: row.finalized_count || 0,
        firstFinalizedAt: row.first_finalized_at,
        lastFinalizedAt: row.last_finalized_at,
        totalExports: row.total_exports || 0
    }));
}

/**
 * Get employee salary history
 */
export async function getEmployeePayrollHistory(
    employeeId: string,
    year?: number
): Promise<EmployeeSalaryHistory[]> {
    let query = supabase
        .from('employee_salary_history_view')
        .select('*')
        .eq('employee_id', employeeId);

    if (year) {
        const yearStr = year.toString();
        query = query.ilike('month', `${yearStr}-%`);
    }

    query = query.order('month', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map(row => ({
        employeeId: row.employee_id || '',
        employeeName: row.employee_name || '',
        department: row.department,
        position: row.position,
        month: row.month || '',
        payslipNumber: row.payslip_number,
        baseSalary: row.base_salary,
        workDays: row.work_days,
        otHours: row.ot_hours,
        grossSalary: row.gross_salary,
        insuranceDeduction: row.insurance_deduction,
        pitDeduction: row.pit_deduction,
        netSalary: row.net_salary,
        isFinalized: row.is_finalized,
        finalizedAt: row.finalized_at,
        finalizedByName: row.finalized_by_name,
        exportedCount: row.exported_count,
        lastExportedAt: row.last_exported_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }));
}

/**
 * Get payroll summary for a specific month
 */
export async function getPayrollSummary(
    month: string,
    branchId?: string
): Promise<PayrollHistorySummary | null> {
    const results = await getPayrollHistory({ month, branchId });
    return results.length > 0 ? results[0] : null;
}

/**
 * Get detailed payroll records for a month
 */
export async function getMonthlyPayrollDetails(
    month: string,
    branchId?: string
): Promise<MonthlySalary[]> {
    let query = supabase
        .from('monthly_salaries')
        .select(`
            *,
            employee:employees(id, name, department, position, avatar)
        `)
        .eq('month', month);

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    query = query.order('employee(name)');

    const { data, error } = await query;
    if (error) throw error;

    return (data || []) as unknown as MonthlySalary[];
}

/**
 * Compare payroll between two months
 */
export async function compareMonthlyPayrolls(
    month1: string,
    month2: string,
    branchId?: string
): Promise<MonthlyComparison> {
    const [summary1, summary2] = await Promise.all([
        getPayrollSummary(month1, branchId),
        getPayrollSummary(month2, branchId)
    ]);

    if (!summary1 || !summary2) {
        throw new Error('One or both months do not have payroll data');
    }

    return {
        month1,
        month2,
        summary1,
        summary2,
        differences: {
            employeeCountChange: summary2.totalEmployees - summary1.totalEmployees,
            grossSalaryChange: summary2.totalGrossSalary - summary1.totalGrossSalary,
            netSalaryChange: summary2.totalNetSalary - summary1.totalNetSalary,
            avgNetSalaryChange: summary2.avgNetSalary - summary1.avgNetSalary
        }
    };
}

/**
 * Get list of months with payroll data
 */
export async function getPayrollMonths(branchId?: string): Promise<string[]> {
    let query = supabase
        .from('monthly_salaries')
        .select('month');

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Get unique months and sort descending
    const months = Array.from(new Set((data || []).map(row => row.month)))
        .sort()
        .reverse();

    return months;
}

/**
 * Get payroll statistics for a year
 */
export async function getYearlyPayrollStats(
    year: number,
    branchId?: string
): Promise<{
    year: number;
    totalMonths: number;
    totalGrossSalary: number;
    totalNetSalary: number;
    avgMonthlyGross: number;
    avgMonthlyNet: number;
    avgEmployeesPerMonth: number;
    monthlyBreakdown: PayrollHistorySummary[];
}> {
    const history = await getPayrollHistory({ year, branchId });

    const totalGrossSalary = history.reduce((sum, h) => sum + h.totalGrossSalary, 0);
    const totalNetSalary = history.reduce((sum, h) => sum + h.totalNetSalary, 0);
    const totalEmployees = history.reduce((sum, h) => sum + h.totalEmployees, 0);

    return {
        year,
        totalMonths: history.length,
        totalGrossSalary,
        totalNetSalary,
        avgMonthlyGross: history.length > 0 ? totalGrossSalary / history.length : 0,
        avgMonthlyNet: history.length > 0 ? totalNetSalary / history.length : 0,
        avgEmployeesPerMonth: history.length > 0 ? totalEmployees / history.length : 0,
        monthlyBreakdown: history
    };
}
