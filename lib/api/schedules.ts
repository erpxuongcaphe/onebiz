// Work Schedule API functions
import { supabase } from '../supabaseClient';

// Types
export type WorkSchedule = {
    id: string;
    employee_id: string;
    branch_id?: string;
    shift_id?: string;
    date: string;
    status: 'scheduled' | 'completed' | 'absent' | 'cancelled';
    notes?: string;
    created_by?: string;
    created_at: string;
    updated_at: string;
};

export type AttendancePermission = {
    id: string;
    user_id: string;
    branch_id?: string;
    can_check_attendance: boolean;
    assigned_by?: string;
    created_at: string;
    updated_at: string;
};

// Extended types with joins
export type ScheduleWithDetails = WorkSchedule & {
    employee_name?: string;
    branch_name?: string;
    shift_name?: string;
    shift_start?: string;
    shift_end?: string;
};

// ============ WORK SCHEDULES ============

export async function getSchedules(filters?: {
    date?: string;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    employeeId?: string;
}): Promise<WorkSchedule[]> {
    let query = supabase.from('work_schedules').select('*').order('date');

    if (filters?.date) {
        query = query.eq('date', filters.date);
    }
    if (filters?.startDate && filters?.endDate) {
        query = query.gte('date', filters.startDate).lte('date', filters.endDate);
    }
    if (filters?.branchId) {
        query = query.eq('branch_id', filters.branchId);
    }
    if (filters?.employeeId) {
        query = query.eq('employee_id', filters.employeeId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as WorkSchedule[];
}

export async function createSchedule(schedule: {
    employee_id: string;
    branch_id?: string;
    shift_id?: string;
    date: string;
    created_by?: string;
    notes?: string;
}): Promise<WorkSchedule> {
    const { data, error } = await supabase
        .from('work_schedules')
        .insert({ ...schedule, status: 'scheduled' } as never)
        .select()
        .single();

    if (error) throw error;
    return data as WorkSchedule;
}

export async function createBulkSchedules(schedules: {
    employee_id: string;
    branch_id?: string;
    shift_id?: string;
    date: string;
    created_by?: string;
}[]): Promise<WorkSchedule[]> {
    const schedulesWithStatus = schedules.map(s => ({ ...s, status: 'scheduled' }));

    const { data, error } = await supabase
        .from('work_schedules')
        .upsert(schedulesWithStatus as never[], { onConflict: 'employee_id,date' })
        .select();

    if (error) throw error;
    return (data || []) as WorkSchedule[];
}

export async function updateSchedule(id: string, updates: Partial<WorkSchedule>): Promise<WorkSchedule> {
    const { data, error } = await supabase
        .from('work_schedules')
        .update({ ...updates, updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as WorkSchedule;
}

export async function deleteSchedule(id: string): Promise<void> {
    const { error } = await supabase
        .from('work_schedules')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// ============ ATTENDANCE PERMISSIONS ============

export async function getAttendancePermissions(branchId?: string): Promise<AttendancePermission[]> {
    let query = supabase.from('attendance_permissions').select('*');

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as AttendancePermission[];
}

export async function getUserPermissions(userId: string): Promise<AttendancePermission[]> {
    const { data, error } = await supabase
        .from('attendance_permissions')
        .select('*')
        .eq('user_id', userId);

    if (error) throw error;
    return (data || []) as AttendancePermission[];
}

export async function grantPermission(permission: {
    user_id: string;
    branch_id?: string;
    can_check_attendance: boolean;
    assigned_by?: string;
}): Promise<AttendancePermission> {
    const { data, error } = await supabase
        .from('attendance_permissions')
        .upsert(permission as never, { onConflict: 'user_id,branch_id' })
        .select()
        .single();

    if (error) throw error;
    return data as AttendancePermission;
}

export async function revokePermission(id: string): Promise<void> {
    const { error } = await supabase
        .from('attendance_permissions')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

export async function canUserCheckAttendance(userId: string, branchId?: string): Promise<boolean> {
    let query = supabase
        .from('attendance_permissions')
        .select('can_check_attendance')
        .eq('user_id', userId)
        .eq('can_check_attendance', true);

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data } = await query;
    return (data && data.length > 0) ?? false;
}

// ============ SCHEDULE-BASED ATTENDANCE ============

export async function checkInBySchedule(
    scheduleId: string,
    checkedBy: string
): Promise<{ schedule: WorkSchedule; attendance: unknown }> {
    const now = new Date();

    // Get the schedule
    const { data: schedule, error: scheduleError } = await supabase
        .from('work_schedules')
        .select('*')
        .eq('id', scheduleId)
        .single();

    if (scheduleError) throw scheduleError;

    // Create attendance record
    const { data: attendance, error: attendanceError } = await supabase
        .from('attendance_records')
        .insert({
            employee_id: (schedule as WorkSchedule).employee_id,
            branch_id: (schedule as WorkSchedule).branch_id,
            shift_id: (schedule as WorkSchedule).shift_id,
            schedule_id: scheduleId,
            date: (schedule as WorkSchedule).date,
            check_in: now.toISOString(),
            status: 'ontime',
            checked_by: checkedBy
        } as never)
        .select()
        .single();

    if (attendanceError) throw attendanceError;

    return { schedule: schedule as WorkSchedule, attendance };
}

export async function checkOutBySchedule(
    scheduleId: string,
    checkedBy: string
): Promise<{ schedule: WorkSchedule; attendance: unknown }> {
    const now = new Date();

    // Get attendance record for this schedule
    const { data: existingAttendance } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('schedule_id', scheduleId)
        .single();

    if (!existingAttendance) {
        throw new Error('Chưa check-in cho ca này');
    }

    const attendanceData = existingAttendance as { id: string; check_in?: string };

    // Calculate hours worked
    let hoursWorked = 0;
    if (attendanceData.check_in) {
        hoursWorked = (now.getTime() - new Date(attendanceData.check_in).getTime()) / (1000 * 60 * 60);
    }

    // Update attendance with check-out
    const { data: attendance, error: attendanceError } = await supabase
        .from('attendance_records')
        .update({
            check_out: now.toISOString(),
            hours_worked: Math.round(hoursWorked * 100) / 100,
            checked_by: checkedBy,
            updated_at: now.toISOString()
        } as never)
        .eq('id', attendanceData.id)
        .select()
        .single();

    if (attendanceError) throw attendanceError;

    // Update schedule status
    const { data: schedule, error: scheduleError } = await supabase
        .from('work_schedules')
        .update({ status: 'completed', updated_at: now.toISOString() } as never)
        .eq('id', scheduleId)
        .select()
        .single();

    if (scheduleError) throw scheduleError;

    return { schedule: schedule as WorkSchedule, attendance };
}
