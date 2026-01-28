// Payslips API - Templates, Monthly Payslips, and Export
import { supabase } from '../supabaseClient';

// ==========================================
// TYPES
// ==========================================

export interface PayslipTemplate {
    id: string;
    branch_id: string | null;
    company_name: string;
    company_address: string | null;
    company_phone: string | null;
    company_email: string | null;
    company_tax_code: string | null;
    logo_url: string | null;
    header_text: string | null;
    footer_text: string | null;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

export interface MonthlyPayslip {
    id: string;
    employee_id: string;
    month: string; // YYYY-MM
    branch_id: string | null;

    // Salary
    base_salary: number | null;
    hourly_rate: number | null;
    hours_worked: number;

    // Allowances
    lunch_allowance: number;
    transport_allowance: number;
    phone_allowance: number;
    other_allowance: number;

    // KPI
    kpi_target: number;
    kpi_percent: number;

    // Bonus/Penalty
    bonus: number;
    penalty: number;
    bonus_note: string | null;

    // Deductions
    insurance_deduction: number | null;
    pit_deduction: number | null;

    // Totals
    gross_salary: number;
    net_salary: number;

    // Work details
    work_days: number;
    regular_hours: number;
    ot_hours: number;
    late_count: number;
    early_leave_count: number;

    // Status
    is_finalized: boolean;
    finalized_at: string | null;
    finalized_by: string | null;
    notes: string | null;

    created_at: string;
    updated_at: string;
}

export interface WorkHourDetail {
    date: string;
    check_in: string | null;
    check_out: string | null;
    hours_worked: number;
    overtime_hours: number;
    status: string;
}

// ==========================================
// TEMPLATE FUNCTIONS
// ==========================================

// Get all templates
export async function getPayslipTemplates(): Promise<PayslipTemplate[]> {
    const { data, error } = await supabase
        .from('payslip_templates')
        .select('*')
        .order('is_default', { ascending: false });

    if (error) throw error;
    return (data || []) as unknown as PayslipTemplate[];
}

// Get template for a specific branch (or default)
export async function getPayslipTemplate(branchId?: string): Promise<PayslipTemplate | null> {
    // Try branch-specific first
    if (branchId) {
        const { data: branchTemplate } = await supabase
            .from('payslip_templates')
            .select('*')
            .eq('branch_id', branchId)
            .single();

        if (branchTemplate) return branchTemplate as unknown as PayslipTemplate;
    }

    // Fall back to default
    const { data: defaultTemplate } = await supabase
        .from('payslip_templates')
        .select('*')
        .eq('is_default', true)
        .single();

    return (defaultTemplate || null) as unknown as PayslipTemplate | null;
}

// Create or update template
export async function savePayslipTemplate(
    template: Omit<PayslipTemplate, 'id' | 'created_at' | 'updated_at'>
): Promise<PayslipTemplate> {
    const { data, error } = await supabase
        .from('payslip_templates')
        .upsert({
            ...template,
            updated_at: new Date().toISOString()
        } as never, {
            onConflict: 'branch_id'
        })
        .select()
        .single();

    if (error) throw error;
    return data as unknown as PayslipTemplate;
}

// Delete template
export async function deletePayslipTemplate(id: string): Promise<void> {
    const { error } = await supabase
        .from('payslip_templates')
        .delete()
        .eq('id', id)
        .neq('is_default', true); // Can't delete default

    if (error) throw error;
}

// ==========================================
// MONTHLY PAYSLIP FUNCTIONS
// ==========================================

// Get monthly payslip for an employee
export async function getMonthlyPayslip(
    employeeId: string,
    month: string
): Promise<MonthlyPayslip | null> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('month', month)
        .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data as unknown as MonthlyPayslip;
}

// Get all payslips for a month
export async function getMonthlyPayslips(month: string): Promise<MonthlyPayslip[]> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .select('*')
        .eq('month', month)
        .order('employee_id');

    if (error) throw error;
    return (data || []) as unknown as MonthlyPayslip[];
}

// Get employee's payslip history
export async function getEmployeePayslipHistory(
    employeeId: string,
    limit: number = 12
): Promise<MonthlyPayslip[]> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('is_finalized', true)
        .order('month', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return (data || []) as unknown as MonthlyPayslip[];
}

// Save monthly payslip
export async function saveMonthlyPayslip(
    payslip: Partial<MonthlyPayslip> & { employee_id: string; month: string }
): Promise<MonthlyPayslip> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .upsert({
            ...payslip,
            updated_at: new Date().toISOString()
        } as never, {
            onConflict: 'employee_id,month'
        })
        .select()
        .single();

    if (error) throw error;
    return data as unknown as MonthlyPayslip;
}

// Finalize monthly payslip
export async function finalizeMonthlyPayslip(
    employeeId: string,
    month: string,
    userId: string
): Promise<MonthlyPayslip> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .update({
            is_finalized: true,
            finalized_at: new Date().toISOString(),
            finalized_by: userId,
            updated_at: new Date().toISOString()
        } as never)
        .eq('employee_id', employeeId)
        .eq('month', month)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as MonthlyPayslip;
}

// Finalize all payslips for a month
export async function finalizeAllPayslips(
    month: string,
    userId: string
): Promise<number> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .update({
            is_finalized: true,
            finalized_at: new Date().toISOString(),
            finalized_by: userId,
            updated_at: new Date().toISOString()
        } as never)
        .eq('month', month)
        .eq('is_finalized', false)
        .select();

    if (error) throw error;
    return data?.length || 0;
}

// ==========================================
// WORK HOURS FUNCTIONS
// ==========================================

// Get detailed work hours for an employee in a month
export async function getEmployeeWorkHours(
    employeeId: string,
    month: string
): Promise<WorkHourDetail[]> {
    const [year, monthNum] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNum, 0).getDate();
    const startDate = `${month}-01`;
    const endDate = `${month}-${lastDay.toString().padStart(2, '0')}`;

    // attendance_records may be stored with either:
    // 1. employeeId (from employees table)
    // 2. userId (from users table) - when user checks in via QR
    // So we need to find the linked userId and query both
    const idsToSearch = [employeeId];

    // Find userId that links to this employeeId
    const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('employee_id', employeeId)
        .single();

    if (userData?.id) {
        idsToSearch.push(userData.id);
    }

    // Query attendance_records with both IDs
    const { data, error } = await supabase
        .from('attendance_records')
        .select('date, check_in, check_out, hours_worked, overtime_hours, status')
        .in('employee_id', idsToSearch)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date');

    if (error) throw error;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((data || []) as any[]).map(record => ({
        date: record.date,
        check_in: record.check_in,
        check_out: record.check_out,
        hours_worked: record.hours_worked || 0,
        overtime_hours: record.overtime_hours || 0,
        status: record.status
    }));
}

// Calculate work summary from attendance
export async function calculateWorkSummary(
    employeeId: string,
    month: string
): Promise<{
    workDays: number;
    regularHours: number;
    otHours: number;
    lateCount: number;
    earlyLeaveCount: number;
}> {
    const hours = await getEmployeeWorkHours(employeeId, month);

    // Group records by date first (like timekeeping page does)
    const dateRecords: Record<string, { hours: number; otHours: number; statuses: string[] }> = {};

    hours.forEach(record => {
        const dateKey = record.date;
        if (!dateRecords[dateKey]) {
            dateRecords[dateKey] = { hours: 0, otHours: 0, statuses: [] };
        }
        dateRecords[dateKey].hours += record.hours_worked || 0;
        dateRecords[dateKey].otHours += record.overtime_hours || 0;
        dateRecords[dateKey].statuses.push(record.status);
    });

    let workDays = 0;
    let regularHours = 0;
    let otHours = 0;
    let lateCount = 0;
    let earlyLeaveCount = 0;

    // Calculate from grouped daily records
    Object.values(dateRecords).forEach(dayData => {
        // Each day with any hours counts as 1 work day
        if (dayData.hours > 0) {
            workDays++;
        }
        // Regular hours: cap at 8h per day
        regularHours += Math.min(dayData.hours, 8);
        // OT hours: sum as-is
        otHours += dayData.otHours;
        // Count late/early based on statuses in the day
        if (dayData.statuses.includes('late')) lateCount++;
        if (dayData.statuses.includes('early_leave')) earlyLeaveCount++;
    });

    return { workDays, regularHours, otHours, lateCount, earlyLeaveCount };
}

// ==========================================
// WORK HOUR REQUIREMENTS
// ==========================================

export interface WorkHourRequirement {
    id: string;
    employment_type: string;
    min_hours_per_month: number;
    description: string | null;
    created_at: string;
    updated_at: string;
}

// Get all work hour requirements
export async function getWorkHourRequirements(): Promise<WorkHourRequirement[]> {
    const { data, error } = await supabase
        .from('work_hour_requirements')
        .select('*')
        .order('min_hours_per_month', { ascending: false });

    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []) as any[];
}

// Get requirement for specific employment type
export async function getWorkHourRequirement(
    employmentType: string
): Promise<WorkHourRequirement | null> {
    const { data, error } = await supabase
        .from('work_hour_requirements')
        .select('*')
        .eq('employment_type', employmentType)
        .single();

    if (error && error.code !== 'PGRST116') throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data as any;
}

// Update work hour requirement
export async function updateWorkHourRequirement(
    employmentType: string,
    minHours: number,
    description?: string
): Promise<WorkHourRequirement> {
    const { data, error } = await supabase
        .from('work_hour_requirements')
        .upsert({
            employment_type: employmentType,
            min_hours_per_month: minHours,
            description: description || null,
            updated_at: new Date().toISOString()
        } as never, {
            onConflict: 'employment_type'
        })
        .select()
        .single();

    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data as any;
}

// ==========================================
// HOLIDAYS CONFIGURATION
// ==========================================

export interface Holiday {
    id: string;
    date: string;
    name: string;
    is_recurring: boolean;
    created_at: string;
    updated_at: string;
}

// Get all holidays
export async function getHolidays(): Promise<Holiday[]> {
    const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .order('date');

    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []) as any[];
}

// Create holiday
export async function createHoliday(date: string, name: string, isRecurring: boolean = true): Promise<Holiday> {
    const { data, error } = await supabase
        .from('holidays')
        .insert({ date, name, is_recurring: isRecurring } as never)
        .select()
        .single();

    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data as any;
}

// Delete holiday
export async function deleteHoliday(id: string): Promise<void> {
    const { error } = await supabase
        .from('holidays')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// Get holidays for a specific month (for filtering)
async function getHolidaysForMonth(year: number, month: number): Promise<string[]> {
    const { data } = await supabase
        .from('holidays')
        .select('date, is_recurring');

    if (!data) return [];

    const monthStr = String(month).padStart(2, '0');
    const holidays: string[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data as any[]).forEach((h: { date: string; is_recurring: boolean }) => {
        const hDate = new Date(h.date);
        const hMonth = hDate.getMonth() + 1;
        const hDay = hDate.getDate();

        if (h.is_recurring) {
            // Recurring: match month-day only
            if (hMonth === month) {
                holidays.push(`${monthStr}-${String(hDay).padStart(2, '0')}`);
            }
        } else {
            // Specific date: match year-month-day
            if (hDate.getFullYear() === year && hMonth === month) {
                holidays.push(`${monthStr}-${String(hDay).padStart(2, '0')}`);
            }
        }
    });

    return holidays;
}

// Calculate working days in a month (excluding Sundays and holidays)
async function getWorkingDaysInMonthAsync(year: number, month: number): Promise<number> {
    const daysInMonth = new Date(year, month, 0).getDate();
    const holidays = await getHolidaysForMonth(year, month);
    let workingDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay(); // 0 = Sunday
        const dateStr = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Skip Sundays and holidays from database
        if (dayOfWeek !== 0 && !holidays.includes(dateStr)) {
            workingDays++;
        }
    }

    return workingDays;
}

// Get current month work summary for an employee
export async function getCurrentMonthWorkSummary(
    employeeId: string,
    employeeType?: string  // 'full_time_monthly' | 'full_time_hourly' | 'part_time' | 'probation' | 'intern'
): Promise<{
    workDays: number;
    totalHours: number;
    otHours: number;
    lateCount: number;
    minRequired: number;
    percentComplete: number;
    standardWorkDays: number;
}> {
    // Get current month
    const now = new Date();
    const year = now.getFullYear();
    const monthNum = now.getMonth() + 1;
    const month = `${year}-${String(monthNum).padStart(2, '0')}`;

    // Get work hours
    const summary = await calculateWorkSummary(employeeId, month);

    // Calculate standard working days (excluding Sundays and holidays) - for monthly salary
    const standardWorkDays = await getWorkingDaysInMonthAsync(year, monthNum);

    // Calculate min required hours based on employee_type
    let minRequired: number;

    // Hourly types: không có giờ tối thiểu cố định
    const hourlyTypes = ['full_time_hourly', 'part_time'];
    if (hourlyTypes.includes(employeeType || '')) {
        minRequired = 0;
    } else {
        // Monthly salary types: full_time_monthly, probation, intern
        // Tính = ngày công tiêu chuẩn (trừ CN + lễ) × 8h
        minRequired = standardWorkDays * 8;
    }

    const totalHours = summary.regularHours + summary.otHours;
    const percentComplete = minRequired > 0 ? Math.round((totalHours / minRequired) * 100) : 100;

    return {
        workDays: summary.workDays,
        totalHours,
        otHours: summary.otHours,
        lateCount: summary.lateCount,
        minRequired,
        percentComplete,
        standardWorkDays
    };
}

// ==========================================
// FORMAT HELPERS
// ==========================================

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
        maximumFractionDigits: 0
    }).format(amount);
}

export function formatMonth(month: string): string {
    const [year, m] = month.split('-');
    return `Tháng ${parseInt(m)}/${year}`;
}
