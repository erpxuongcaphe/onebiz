import { supabase } from '../supabase';
import { Database } from '../database.types';

export type MonthlySalary = Database['public']['Tables']['monthly_salaries']['Row'];
export type MonthlySalaryInsert = Database['public']['Tables']['monthly_salaries']['Insert'];

export type MonthlySalaryWithEmployee = MonthlySalary & {
    employee: {
        id: string;
        name: string;
        department: string | null;
        position: string | null;
        avatar: string | null;
        tax_code?: string | null;
        insurance_number?: string | null;
    } | null;
    // Payslip properties (optional as they might be null)
    payslip_number?: string | null;
    exported_count?: number | null;
    last_exported_at?: string | null;
    finalized_by_name?: string | null;
};

export async function getMonthlySalaries(month: string, branchId?: string): Promise<MonthlySalaryWithEmployee[]> {
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

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as MonthlySalaryWithEmployee[];
}

export async function saveMonthlySalary(salaryData: MonthlySalaryInsert): Promise<MonthlySalary> {
    // Upsert based on unique constraint (employee_id, month, branch_id typically, or just employee_id + month)
    // Assuming unique index on (employee_id, month) exists or we handle conflict
    const { data, error } = await supabase
        .from('monthly_salaries')
        .upsert(salaryData, { onConflict: 'employee_id, month' })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function saveMonthlySalariesBulk(salaries: MonthlySalaryInsert[]): Promise<MonthlySalary[]> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .upsert(salaries, { onConflict: 'employee_id, month' })
        .select();

    if (error) throw error;
    return data || [];
}

export async function getEmployeeSalaryHistory(employeeId: string): Promise<MonthlySalaryWithEmployee[]> {
    const { data, error } = await supabase
        .from('monthly_salaries')
        .select(`
            *,
            employee:employees(id, name, department, position, avatar)
        `)
        .eq('employee_id', employeeId)
        .eq('is_finalized', true)
        .order('month', { ascending: false });

    if (error) throw error;
    return (data || []) as unknown as MonthlySalaryWithEmployee[];
}
