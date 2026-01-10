import { supabase } from '../supabase';
import { DbUser, DbUserInsert, DbUserUpdate, UserRole } from '../database.types';

// Application User type (without password_hash for client-side)
export type User = {
    id: string;
    username: string;
    email: string;
    fullName: string;
    role: UserRole;
    employeeId: string | null;
    isActive: boolean;
    createdAt: string;
};

// Convert DB user to app user (camelCase + remove sensitive data)
function toAppUser(dbUser: DbUser): User {
    return {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        fullName: dbUser.full_name || '',
        role: dbUser.role as UserRole,
        employeeId: dbUser.employee_id,
        isActive: dbUser.is_active,
        createdAt: dbUser.created_at || '',
    };
}

// Get all users
export async function getUsers(): Promise<User[]> {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('id', { ascending: true });

    if (error) {
        console.error('Error fetching users:', error);
        throw error;
    }

    return ((data as DbUser[]) || []).map(toAppUser);
}

// Get user by ID
export async function getUserById(id: string): Promise<User | null> {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        console.error('Error fetching user:', error);
        return null;
    }

    return data ? toAppUser(data as DbUser) : null;
}

// Create new user
export async function createUser(user: {
    id: string;
    username: string;
    email: string;
    password: string;
    fullName: string;
    role: UserRole;
    employeeId: string | null;
    isActive: boolean;
}): Promise<User> {
    // In production, password should be hashed server-side
    // For now, we'll store a simple hash (NOT secure - use proper auth in production)
    const dbUser: DbUserInsert = {
        id: user.id,
        username: user.username,
        email: user.email,
        password_hash: btoa(user.password), // Base64 encoding (NOT secure - placeholder only)
        full_name: user.fullName,
        role: user.role,
        employee_id: user.employeeId,
        is_active: user.isActive,
    };

    const { data, error } = await supabase
        .from('users')
        .insert(dbUser as never)
        .select()
        .single();

    if (error) {
        console.error('Error creating user:', error);
        throw error;
    }

    return toAppUser(data as DbUser);
}

// Update user
export async function updateUser(id: string, updates: Partial<{
    email: string;
    fullName: string;
    role: UserRole;
    employeeId: string | null;
    isActive: boolean;
}>): Promise<User> {
    const dbUpdates: DbUserUpdate = {};
    if (updates.email !== undefined) dbUpdates.email = updates.email;
    if (updates.fullName !== undefined) dbUpdates.full_name = updates.fullName;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.employeeId !== undefined) dbUpdates.employee_id = updates.employeeId;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

    const { data, error } = await supabase
        .from('users')
        .update(dbUpdates as never)
        .eq('id', id)
        .select()
        .single();

    if (error) {
        console.error('Error updating user:', error);
        throw error;
    }

    return toAppUser(data as DbUser);
}

// Delete user
export async function deleteUser(id: string): Promise<void> {
    const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error deleting user:', error);
        throw error;
    }
}

// Authenticate user
export async function authenticateUser(username: string, password: string): Promise<User | null> {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .eq('is_active', true)
        .single();

    if (error || !data) {
        console.error('Authentication failed: user not found');
        return null;
    }

    const dbUser = data as DbUser;
    // Check password (Base64 decode - NOT secure, placeholder only)
    const storedPassword = atob(dbUser.password_hash);
    if (storedPassword !== password) {
        console.error('Authentication failed: incorrect password');
        return null;
    }

    return toAppUser(dbUser);
}

// Get user by username
export async function getUserByUsername(username: string): Promise<User | null> {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('username', username)
        .single();

    if (error) {
        return null;
    }

    return data ? toAppUser(data as DbUser) : null;
}
