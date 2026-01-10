// Department and Position API functions
import { supabase } from '../supabase';

// Department types (inline until database.types.ts is updated)
export type Department = {
    id: string;
    name: string;
    description?: string;
    created_at: string;
    updated_at: string;
};

export type Position = {
    id: string;
    name: string;
    department_id?: string;
    description?: string;
    created_at: string;
    updated_at: string;
};

// Department CRUD
export async function getDepartments(): Promise<Department[]> {
    const { data, error } = await supabase
        .from('departments')
        .select('*')
        .order('name');

    if (error) throw error;
    return (data || []) as unknown as Department[];
}

export async function createDepartment(name: string, description?: string): Promise<Department> {
    const { data, error } = await supabase
        .from('departments')
        .insert({ name, description } as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Department;
}

export async function updateDepartment(id: string, updates: { name?: string; description?: string }): Promise<Department> {
    const { data, error } = await supabase
        .from('departments')
        .update({ ...updates, updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Department;
}

export async function deleteDepartment(id: string): Promise<void> {
    const { error } = await supabase
        .from('departments')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// Position CRUD
export async function getPositions(): Promise<Position[]> {
    const { data, error } = await supabase
        .from('positions')
        .select('*')
        .order('name');

    if (error) throw error;
    return (data || []) as unknown as Position[];
}

export async function createPosition(name: string, department_id?: string, description?: string): Promise<Position> {
    const { data, error } = await supabase
        .from('positions')
        .insert({ name, department_id, description } as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Position;
}

export async function updatePosition(id: string, updates: { name?: string; department_id?: string; description?: string }): Promise<Position> {
    const { data, error } = await supabase
        .from('positions')
        .update({ ...updates, updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Position;
}

export async function deletePosition(id: string): Promise<void> {
    const { error } = await supabase
        .from('positions')
        .delete()
        .eq('id', id);

    if (error) throw error;
}
