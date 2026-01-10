import { supabase } from '../supabase';
import { Employee, EmployeeInsert, EmployeeUpdate } from '../database.types';

// Re-export Employee for convenience
export type { Employee, EmployeeInsert, EmployeeUpdate };

// Get all employees
export async function getEmployees(): Promise<Employee[]> {
    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        console.error('Error fetching employees:', error);
        throw error;
    }

    return (data as Employee[]) || [];
}

// Get employee by ID
export async function getEmployeeById(id: string): Promise<Employee | null> {
    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching employee:', error);
        return null;
    }

    return data as Employee;
}

// Create new employee
export async function createEmployee(employee: EmployeeInsert): Promise<Employee> {
    console.log('[createEmployee] Attempting to insert:', JSON.stringify(employee, null, 2));

    const { data, error } = await supabase
        .from('employees')
        .insert(employee as never)
        .select()
        .single();

    if (error) {
        console.error('[createEmployee] Supabase error:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint
        });
        // Create a more descriptive error
        const enhancedError = new Error(`DB Error: ${error.message} (Code: ${error.code})`);
        (enhancedError as Error & { originalError: typeof error }).originalError = error;
        throw enhancedError;
    }

    console.log('[createEmployee] Success:', data);
    return data as Employee;
}

// Update employee
export async function updateEmployee(id: string, updates: EmployeeUpdate): Promise<Employee> {
    const { data, error } = await supabase
        .from('employees')
        .update({ ...updates, updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating employee:', error);
        throw error;
    }

    return data as Employee;
}

// Delete employee
export async function deleteEmployee(id: string): Promise<void> {
    const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting employee:', error);
        throw error;
    }
}

// Get employees by department
export async function getEmployeesByDepartment(department: string): Promise<Employee[]> {
    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('department', department)
        .order('name', { ascending: true });

    if (error) {
        console.error('Error fetching employees by department:', error);
        throw error;
    }

    return (data as Employee[]) || [];
}

// Search employees
export async function searchEmployees(query: string): Promise<Employee[]> {
    const { data, error } = await supabase
        .from('employees')
        .select('*')
        .or(`name.ilike.%${query}%,email.ilike.%${query}%,id.ilike.%${query}%`)
        .order('name', { ascending: true });

    if (error) {
        console.error('Error searching employees:', error);
        throw error;
    }

    return (data as Employee[]) || [];
}

// Generate next Employee ID
export async function getNextEmployeeId(): Promise<string> {
    const { data, error } = await supabase
        .from('employees')
        .select('id')
        .like('id', 'XCP%')
        .order('id', { ascending: false })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
        console.error('Error fetching last ID:', error);
        return 'XCP00001';
    }

    if (!data) {
        return 'XCP00001';
    }

    const lastId = (data as { id: string }).id;
    // Extract number part
    const numPart = parseInt(lastId.replace('XCP', ''));
    if (isNaN(numPart)) return 'XCP00001';

    const nextNum = numPart + 1;
    if (nextNum > 99999) {
        throw new Error('Employee ID limit reached (99999)');
    }

    return `XCP${String(nextNum).padStart(5, '0')}`;
}

// Check if employee attributes exist
export async function checkEmployeeExistence(
    field: 'id' | 'identity_card' | 'phone',
    value: string,
    excludeId?: string
): Promise<boolean> {
    let query = supabase
        .from('employees')
        .select('id')
        .eq(field, value);

    if (excludeId) {
        query = query.neq('id', excludeId);
    }

    const { data, error } = await query;

    if (error) {
        console.error(`Error checking ${field}:`, error);
        return false;
    }

    return data && data.length > 0;
}

// Check multiple employee IDs and return existing ones
export async function checkExistingEmployeeIds(ids: string[]): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return [];

    const { data, error } = await supabase
        .from('employees')
        .select('id, name')
        .in('id', ids);

    if (error) {
        console.error('Error checking existing employees:', error);
        return [];
    }

    return (data as { id: string; name: string }[]) || [];
}

// Check for duplicate employees by ID or CCCD
export type DuplicateEmployee = {
    id: string;
    name: string;
    reason: 'id' | 'cccd';
    existingId?: string;
    existingName?: string;
};

export async function checkDuplicateEmployees(
    employees: { id: string; name: string; identity_card?: string }[]
): Promise<DuplicateEmployee[]> {
    if (employees.length === 0) return [];

    const duplicates: DuplicateEmployee[] = [];

    // Extract IDs
    const ids = employees.map(e => e.id);

    // Check duplicate IDs
    if (ids.length > 0) {
        const { data: existingByIds } = await supabase
            .from('employees')
            .select('id, name')
            .in('id', ids);

        if (existingByIds && existingByIds.length > 0) {
            for (const existing of existingByIds) {
                const emp = employees.find(e => e.id === existing.id);
                if (emp) {
                    duplicates.push({
                        id: emp.id,
                        name: emp.name,
                        reason: 'id',
                        existingId: existing.id,
                        existingName: existing.name
                    });
                }
            }
        }
    }

    // Check duplicate CCCDs (only for those not already flagged as duplicate)
    const duplicateIds = new Set(duplicates.map(d => d.id));
    const employeesWithCccd = employees.filter(e =>
        e.identity_card &&
        e.identity_card.trim() !== '' &&
        !duplicateIds.has(e.id)
    );

    if (employeesWithCccd.length > 0) {
        const cccdToCheck = employeesWithCccd
            .map(e => e.identity_card!)
            .filter(c => c.trim() !== '');

        if (cccdToCheck.length > 0) {
            const { data: existingByCccd } = await supabase
                .from('employees')
                .select('id, name, identity_card')
                .in('identity_card', cccdToCheck);

            if (existingByCccd && existingByCccd.length > 0) {
                for (const existing of existingByCccd) {
                    const emp = employeesWithCccd.find(e => e.identity_card === existing.identity_card);
                    if (emp && !duplicateIds.has(emp.id)) {
                        duplicates.push({
                            id: emp.id,
                            name: emp.name,
                            reason: 'cccd',
                            existingId: existing.id,
                            existingName: existing.name
                        });
                    }
                }
            }
        }
    }

    return duplicates;
}
