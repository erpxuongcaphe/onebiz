import { supabase } from '../supabase';

// =====================================================
// Types
// =====================================================
export type LeaveType = {
    id: string;
    name: string;
    description: string | null;
    color: string;
    default_days_per_year: number;
    is_paid: boolean;
    requires_approval: boolean;
    is_active: boolean;
    created_at: string;
};

export type LeaveBalance = {
    id: string;
    employee_id: string;
    leave_type_id: string;
    year: number;
    total_days: number;
    used_days: number;
    pending_days: number;
    created_at: string;
    updated_at: string;
    // Joined fields
    leave_type?: LeaveType;
    employee?: { id: string; name: string };
};

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type LeaveRequest = {
    id: string;
    employee_id: string;
    leave_type_id: string;
    start_date: string;
    end_date: string;
    total_days: number;
    is_half_day: boolean;
    half_day_period: 'morning' | 'afternoon' | null;
    reason: string | null;
    status: LeaveRequestStatus;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    created_at: string;
    updated_at: string;
    // Joined fields
    leave_type?: LeaveType;
    employee?: { id: string; name: string; department: string };
    reviewer?: { id: string; full_name: string };
};

export type CreateLeaveRequest = {
    employee_id: string;
    leave_type_id: string;
    start_date: string;
    end_date: string;
    total_days: number;
    is_half_day?: boolean;
    half_day_period?: 'morning' | 'afternoon';
    reason?: string;
};

// =====================================================
// Leave Types CRUD
// =====================================================
export async function getLeaveTypes(): Promise<LeaveType[]> {
    const { data, error } = await supabase
        .from('leave_types')
        .select('*')
        .eq('is_active', true)
        .order('name');

    if (error) throw error;
    return (data || []) as unknown as LeaveType[];
}

// Get ALL leave types including inactive (for admin)
export async function getAllLeaveTypes(): Promise<LeaveType[]> {
    const { data, error } = await supabase
        .from('leave_types')
        .select('*')
        .order('name');

    if (error) throw error;
    return (data || []) as unknown as LeaveType[];
}

export async function deleteLeaveType(id: string): Promise<void> {
    const { error } = await supabase
        .from('leave_types')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

export async function createLeaveType(leaveType: Partial<LeaveType>): Promise<LeaveType> {
    const { data, error } = await supabase
        .from('leave_types')
        .insert(leaveType as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as LeaveType;
}

export async function updateLeaveType(id: string, updates: Partial<LeaveType>): Promise<LeaveType> {
    const { data, error } = await supabase
        .from('leave_types')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as LeaveType;
}

// =====================================================
// Leave Balances
// =====================================================
export async function getLeaveBalances(employeeId?: string, year?: number): Promise<LeaveBalance[]> {
    let query = supabase
        .from('leave_balances')
        .select(`
            *,
            leave_type:leave_types(*),
            employee:employees(id, name)
        `)
        .order('year', { ascending: false });

    if (employeeId) {
        query = query.eq('employee_id', employeeId);
    }
    if (year) {
        query = query.eq('year', year);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as LeaveBalance[];
}

export async function initializeLeaveBalance(
    employeeId: string,
    leaveTypeId: string,
    year: number,
    totalDays: number
): Promise<LeaveBalance> {
    const { data, error } = await supabase
        .from('leave_balances')
        .upsert({
            employee_id: employeeId,
            leave_type_id: leaveTypeId,
            year,
            total_days: totalDays,
            used_days: 0,
            pending_days: 0
        }, { onConflict: 'employee_id,leave_type_id,year' })
        .select()
        .single();

    if (error) throw error;
    return data as unknown as LeaveBalance;
}

// =====================================================
// Leave Requests CRUD
// =====================================================
export async function getLeaveRequests(filters?: {
    employeeId?: string;
    status?: LeaveRequestStatus;
    startDate?: string;
    endDate?: string;
}): Promise<LeaveRequest[]> {
    let query = supabase
        .from('leave_requests')
        .select(`
            *,
            leave_type:leave_types(*),
            employee:employees(id, name, department),
            reviewer:users!leave_requests_reviewed_by_fkey(id, full_name)
        `)
        .order('created_at', { ascending: false });

    if (filters?.employeeId) {
        query = query.eq('employee_id', filters.employeeId);
    }
    if (filters?.status) {
        query = query.eq('status', filters.status);
    }
    if (filters?.startDate) {
        query = query.gte('start_date', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('end_date', filters.endDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as LeaveRequest[];
}

export async function getLeaveRequestById(id: string): Promise<LeaveRequest | null> {
    const { data, error } = await supabase
        .from('leave_requests')
        .select(`
            *,
            leave_type:leave_types(*),
            employee:employees(id, name, department),
            reviewer:users!leave_requests_reviewed_by_fkey(id, full_name)
        `)
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data as unknown as LeaveRequest;
}

export async function createLeaveRequest(request: CreateLeaveRequest): Promise<LeaveRequest> {
    const { data, error } = await supabase
        .from('leave_requests')
        .insert({
            ...request,
            status: 'pending'
        })
        .select(`
            *,
            leave_type:leave_types(*),
            employee:employees(id, name, department)
        `)
        .single();

    if (error) throw error;
    return data as unknown as LeaveRequest;
}

export async function approveLeaveRequest(
    id: string,
    reviewerId: string,
    note?: string
): Promise<LeaveRequest> {
    const { data, error } = await supabase
        .from('leave_requests')
        .update({
            status: 'approved',
            reviewed_by: reviewerId,
            reviewed_at: new Date().toISOString(),
            review_note: note || null,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as LeaveRequest;
}

export async function rejectLeaveRequest(
    id: string,
    reviewerId: string,
    note: string
): Promise<LeaveRequest> {
    const { data, error } = await supabase
        .from('leave_requests')
        .update({
            status: 'rejected',
            reviewed_by: reviewerId,
            reviewed_at: new Date().toISOString(),
            review_note: note,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as LeaveRequest;
}

export async function cancelLeaveRequest(id: string): Promise<LeaveRequest> {
    const { data, error } = await supabase
        .from('leave_requests')
        .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as LeaveRequest;
}

// =====================================================
// Helper Functions
// =====================================================
export function calculateLeaveDays(
    startDate: string,
    endDate: string,
    isHalfDay: boolean = false
): number {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isHalfDay) return 0.5;

    let days = 0;
    const current = new Date(start);

    while (current <= end) {
        const dayOfWeek = current.getDay();
        // Skip weekends (0=Sunday, 6=Saturday)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            days++;
        }
        current.setDate(current.getDate() + 1);
    }

    return days;
}

export function getStatusLabel(status: LeaveRequestStatus): string {
    const labels: Record<LeaveRequestStatus, string> = {
        pending: 'Chờ duyệt',
        approved: 'Đã duyệt',
        rejected: 'Từ chối',
        cancelled: 'Đã hủy'
    };
    return labels[status];
}

export function getStatusColor(status: LeaveRequestStatus): string {
    const colors: Record<LeaveRequestStatus, string> = {
        pending: 'bg-amber-100 text-amber-800',
        approved: 'bg-green-100 text-green-800',
        rejected: 'bg-red-100 text-red-800',
        cancelled: 'bg-slate-100 text-slate-600'
    };
    return colors[status];
}
