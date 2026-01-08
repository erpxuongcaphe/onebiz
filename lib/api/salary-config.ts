// Salary Configuration API functions
import { supabase } from '../supabase';

export type PayType = 'hourly' | 'monthly';

export interface SalaryConfig {
    id: string;
    pay_type: PayType;
    config_key: string;
    config_value: string;
    description?: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// Get all salary configs for a pay type
export async function getSalaryConfigs(payType: PayType): Promise<SalaryConfig[]> {
    const { data, error } = await supabase
        .from('salary_configs')
        .select('*')
        .eq('pay_type', payType)
        .eq('is_active', true)
        .order('sort_order');

    if (error) throw error;
    return (data || []) as SalaryConfig[];
}

// Get all salary configs (both types)
export async function getAllSalaryConfigs(): Promise<SalaryConfig[]> {
    const { data, error } = await supabase
        .from('salary_configs')
        .select('*')
        .eq('is_active', true)
        .order('pay_type')
        .order('sort_order');

    if (error) throw error;
    return (data || []) as SalaryConfig[];
}

// Update a single salary config
export async function updateSalaryConfig(
    id: string,
    value: string
): Promise<SalaryConfig> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
        .from('salary_configs')
        .update({ config_value: value, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as SalaryConfig;
}

// Bulk update salary configs
export async function updateSalaryConfigs(
    configs: { id: string; config_value: string }[]
): Promise<void> {
    const errors: string[] = [];
    for (const config of configs) {
        // Skip if id is empty or undefined
        if (!config.id) continue;

        try {
            await updateSalaryConfig(config.id, config.config_value);
        } catch (err) {
            console.error(`Failed to update config ${config.id}:`, err);
            errors.push(config.id);
        }
    }
    if (errors.length > 0) {
        throw new Error(`Failed to update ${errors.length} configs`);
    }
}

// Create a new salary config
export async function createSalaryConfig(
    payType: PayType,
    configKey: string,
    configValue: string,
    description?: string
): Promise<SalaryConfig> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
        .from('salary_configs')
        .insert({
            pay_type: payType,
            config_key: configKey,
            config_value: configValue,
            description
        })
        .select()
        .single();

    if (error) throw error;
    return data as SalaryConfig;
}

// Delete a salary config (soft delete)
export async function deleteSalaryConfig(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('salary_configs')
        .update({ is_active: false })
        .eq('id', id);

    if (error) throw error;
}

// Helper functions for specific configs
export function getConfigValue(configs: SalaryConfig[], key: string): number {
    const config = configs.find(c => c.config_key === key);
    return config ? parseFloat(config.config_value) || 0 : 0;
}

// Calculate Vietnam Personal Income Tax (Thuế TNCN)
// Based on progressive tax rates after deductions
export function calculatePIT(taxableIncome: number): number {
    // Tax brackets in VND (after personal deduction of 11M + 4.4M per dependent)
    const brackets = [
        { max: 5000000, rate: 0.05 },
        { max: 10000000, rate: 0.10 },
        { max: 18000000, rate: 0.15 },
        { max: 32000000, rate: 0.20 },
        { max: 52000000, rate: 0.25 },
        { max: 80000000, rate: 0.30 },
        { max: Infinity, rate: 0.35 }
    ];

    if (taxableIncome <= 0) return 0;

    let tax = 0;
    let remaining = taxableIncome;
    let prevMax = 0;

    for (const bracket of brackets) {
        const bracketAmount = Math.min(remaining, bracket.max - prevMax);
        if (bracketAmount <= 0) break;
        tax += bracketAmount * bracket.rate;
        remaining -= bracketAmount;
        prevMax = bracket.max;
    }

    return Math.round(tax);
}

// Calculate monthly salary with attendance data
export function calculateMonthlySalaryWithAttendance(
    configs: SalaryConfig[],
    eligibleLunchDays: number = 0,  // Days with >= min hours
    kpiBonus: number = 0,           // Manual KPI bonus for the month
    otHours: number = 0             // Overtime hours
) {
    const baseSalary = getConfigValue(configs, 'base_salary');
    const lunchAllowancePerDay = getConfigValue(configs, 'lunch_allowance');
    const transportAllowance = getConfigValue(configs, 'transport_allowance');
    const phoneAllowance = getConfigValue(configs, 'phone_allowance');
    const otherAllowance = getConfigValue(configs, 'other_allowance');

    const hasInsurance = getConfigValue(configs, 'has_insurance') === 1;
    const bhxhPercent = getConfigValue(configs, 'bhxh_percent');
    const bhytPercent = getConfigValue(configs, 'bhyt_percent');
    const bhtnPercent = getConfigValue(configs, 'bhtn_percent');
    const dependentsCount = getConfigValue(configs, 'dependents_count');

    // Calculate lunch allowance based on eligible days
    const lunchAllowance = lunchAllowancePerDay * eligibleLunchDays;

    // OT rate (1.5x base hourly rate)
    const hourlyRate = baseSalary / 26 / 8; // 26 working days, 8 hours/day
    const otPay = otHours * hourlyRate * 1.5;

    const totalAllowance = lunchAllowance + transportAllowance + phoneAllowance + otherAllowance;
    const grossSalary = baseSalary + totalAllowance + kpiBonus + otPay;

    // Insurance deduction (only if has_insurance is true)
    let insuranceDeduction = 0;
    if (hasInsurance) {
        insuranceDeduction = baseSalary * ((bhxhPercent + bhytPercent + bhtnPercent) / 100);
    }

    // PIT calculation
    const personalDeduction = 11000000; // 11 million VND
    const dependentDeduction = 4400000 * dependentsCount; // 4.4M per dependent
    const taxableIncome = grossSalary - insuranceDeduction - personalDeduction - dependentDeduction;
    const pitAmount = calculatePIT(taxableIncome);

    const totalDeduction = insuranceDeduction + pitAmount;
    const netSalary = grossSalary - totalDeduction;

    return {
        baseSalary,
        eligibleLunchDays,
        lunchAllowance,
        transportAllowance,
        phoneAllowance,
        otherAllowance,
        kpiBonus,
        otHours,
        otPay,
        totalAllowance,
        grossSalary,
        hasInsurance,
        insuranceDeduction,
        taxableIncome: Math.max(0, taxableIncome),
        pitAmount,
        totalDeduction,
        netSalary
    };
}

// Simple monthly salary calculation for preview (without attendance data)
export function calculateMonthlySalary(configs: SalaryConfig[]) {
    return calculateMonthlySalaryWithAttendance(configs, 22, 0, 0); // Default 22 days
}

// Calculate hourly salary for a period
export function calculateHourlySalary(
    configs: SalaryConfig[],
    regularHours: number,
    otWeekdayHours: number = 0,
    otWeekendHours: number = 0,
    otHolidayHours: number = 0,
    nightShiftCount: number = 0
) {
    const hourlyRate = getConfigValue(configs, 'hourly_rate');
    const otRateWeekday = getConfigValue(configs, 'ot_rate_weekday');
    const otRateWeekend = getConfigValue(configs, 'ot_rate_weekend');
    const otRateHoliday = getConfigValue(configs, 'ot_rate_holiday');
    const nightShiftAllowance = getConfigValue(configs, 'night_shift_allowance');
    const attendanceBonus = getConfigValue(configs, 'attendance_bonus');

    const hasInsurance = getConfigValue(configs, 'has_insurance') === 1;
    const bhxhPercent = getConfigValue(configs, 'bhxh_percent');
    const bhytPercent = getConfigValue(configs, 'bhyt_percent');
    const bhtnPercent = getConfigValue(configs, 'bhtn_percent');

    const regularPay = regularHours * hourlyRate;
    const otWeekdayPay = otWeekdayHours * hourlyRate * otRateWeekday;
    const otWeekendPay = otWeekendHours * hourlyRate * otRateWeekend;
    const otHolidayPay = otHolidayHours * hourlyRate * otRateHoliday;
    const nightShiftPay = nightShiftCount * nightShiftAllowance;

    const grossSalary = regularPay + otWeekdayPay + otWeekendPay + otHolidayPay + nightShiftPay + attendanceBonus;

    // Insurance deduction (only if has_insurance is true)
    let insuranceDeduction = 0;
    if (hasInsurance) {
        const insuranceBaseAmount = regularPay;
        insuranceDeduction = insuranceBaseAmount * ((bhxhPercent + bhytPercent + bhtnPercent) / 100);
    }
    const netSalary = grossSalary - insuranceDeduction;

    return {
        hourlyRate,
        regularHours,
        regularPay,
        otWeekdayPay,
        otWeekendPay,
        otHolidayPay,
        nightShiftPay,
        attendanceBonus,
        grossSalary,
        hasInsurance,
        insuranceDeduction,
        netSalary
    };
}
