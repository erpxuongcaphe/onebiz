/* eslint-disable @typescript-eslint/no-explicit-any */
// Birthday and Event Forecast APIs
import { supabase } from '../supabaseClient';
import { Employee } from '../database.types';

export interface BirthdayForecast {
    employee: Employee;
    birthdayDate: string; // This year's birthday date
    daysUntil: number;
    age: number;
}

export interface ContractExpiryForecast {
    employee: Employee;
    expiryDate: string;
    daysUntil: number;
}

/**
 * Get upcoming birthdays within the specified number of months
 * @param months Number of months to look ahead (1-12)
 * @returns List of employees with upcoming birthdays
 */
export async function getUpcomingBirthdays(months: number = 3): Promise<BirthdayForecast[]> {
    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('status', 'active')
        .not('date_of_birth', 'is', null);

    if (error) {
        console.error('Error fetching employees for birthday forecast:', error);
        return [];
    }

    const employees = (data || []) as Employee[];
    const today = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const forecasts: BirthdayForecast[] = [];

    employees.forEach(emp => {
        if (!emp.date_of_birth) return;

        const dob = new Date(emp.date_of_birth);
        const thisYearBirthday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());

        // If birthday already passed this year, check next year
        if (thisYearBirthday < today) {
            thisYearBirthday.setFullYear(today.getFullYear() + 1);
        }

        // Check if within range
        if (thisYearBirthday <= endDate) {
            const daysUntil = Math.ceil((thisYearBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const age = thisYearBirthday.getFullYear() - dob.getFullYear();

            forecasts.push({
                employee: emp,
                birthdayDate: thisYearBirthday.toISOString().split('T')[0],
                daysUntil,
                age
            });
        }
    });

    // Sort by days until birthday
    return forecasts.sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * Get employees with contracts expiring within the specified number of months
 * @param months Number of months to look ahead (1-12)
 * @returns List of employees with expiring contracts
 */
export async function getExpiringContracts(months: number = 3): Promise<ContractExpiryForecast[]> {
    const today = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('status', 'active')
        .not('contract_end_date', 'is', null)
        .gte('contract_end_date', today.toISOString().split('T')[0])
        .lte('contract_end_date', endDate.toISOString().split('T')[0])
        .order('contract_end_date', { ascending: true });

    if (error) {
        console.error('Error fetching employees for contract expiry forecast:', error);
        return [];
    }

    const employees = (data || []) as Employee[];

    return employees.map(emp => {
        const expiryDate = new Date((emp as any).contract_end_date);
        const daysUntil = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        return {
            employee: emp,
            expiryDate: (emp as any).contract_end_date,
            daysUntil
        };
    });
}

/**
 * Get count of employees whose probation ends within the specified months
 */
export async function getProbationEnding(months: number = 1): Promise<{ employee: Employee; daysUntil: number }[]> {
    const today = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('status', 'active')
        .eq('employee_type', 'probation')
        .not('probation_end_date', 'is', null)
        .gte('probation_end_date', today.toISOString().split('T')[0])
        .lte('probation_end_date', endDate.toISOString().split('T')[0])
        .order('probation_end_date', { ascending: true });

    if (error) {
        console.error('Error fetching probation ending:', error);
        return [];
    }

    const employees = (data || []) as Employee[];

    return employees.map(emp => {
        const probEnd = new Date((emp as any).probation_end_date);
        const daysUntil = Math.ceil((probEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return { employee: emp, daysUntil };
    });
}
