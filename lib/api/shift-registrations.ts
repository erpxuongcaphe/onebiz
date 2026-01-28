// Shift Registration API functions
import { supabase } from '../supabaseClient';

export interface ShiftRegistration {
    id: string;
    employee_id: string;
    branch_id: string;
    shift_date: string;
    shift_id: string | null;
    status: 'pending' | 'approved' | 'rejected';
    registered_at: string;
    approved_by?: string;
    approved_at?: string;
    notes?: string;
    week_start: string;
    created_at: string;
    // Joined fields
    employee_name?: string;
    branch_name?: string;
    shift_name?: string;
    shift_start?: string;
    shift_end?: string;
}

export interface RegistrationSettings {
    id: string;
    branch_id: string | null;
    registration_start_day: number;
    registration_start_hour: number;
    registration_end_day: number;
    registration_end_hour: number;
    weeks_ahead: number;
    is_active: boolean;
    is_closed?: boolean;
    closed_at?: string;
    closed_by?: string;
}

// Get registration settings for a branch (or global default)
export async function getRegistrationSettings(branchId?: string): Promise<RegistrationSettings | null> {
    // Try branch-specific first
    if (branchId) {
        const { data } = await supabase
            .from('registration_settings')
            .select('*')
            .eq('branch_id', branchId)
            .single();
        if (data) return data as RegistrationSettings;
    }

    // Fall back to global default
    const { data } = await supabase
        .from('registration_settings')
        .select('*')
        .is('branch_id', null)
        .single();

    return data as RegistrationSettings | null;
}

// Check if registration window is currently open (also checks manual close)
export function isRegistrationOpen(settings: RegistrationSettings): boolean {
    // If manually closed, return false
    if (settings.is_closed) {
        return false;
    }

    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday
    const currentHour = now.getHours();

    const startDay = settings.registration_start_day;
    const startHour = settings.registration_start_hour;
    const endDay = settings.registration_end_day;
    const endHour = settings.registration_end_hour;

    // Simple check: is current time within window?
    // This handles same-week windows (e.g., Thu 21:00 - Fri 21:00)
    if (startDay === endDay) {
        return currentDay === startDay && currentHour >= startHour && currentHour < endHour;
    }

    if (currentDay === startDay) {
        return currentHour >= startHour;
    }
    if (currentDay === endDay) {
        return currentHour < endHour;
    }
    if (startDay < endDay) {
        return currentDay > startDay && currentDay < endDay;
    }

    return false;
}

// Close registration manually (manager action)
export async function closeRegistration(settingsId: string, closedBy: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('registration_settings')
        .update({
            is_closed: true,
            closed_at: new Date().toISOString(),
            closed_by: closedBy
        })
        .eq('id', settingsId);

    if (error) throw error;
}

// Reopen registration (manager action)
export async function reopenRegistration(settingsId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('registration_settings')
        .update({
            is_closed: false,
            closed_at: null,
            closed_by: null
        })
        .eq('id', settingsId);

    if (error) throw error;
}

// Get the start of target week (Monday) for registration
export function getTargetWeekStart(settings: RegistrationSettings): Date {
    const now = new Date();
    const currentDay = now.getDay();
    const diff = currentDay === 0 ? -6 : 1 - currentDay; // Get to Monday

    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    monday.setHours(0, 0, 0, 0);

    // Add weeks_ahead
    monday.setDate(monday.getDate() + (settings.weeks_ahead * 7));

    return monday;
}

// Get available shifts for registration (for a specific week)
export async function getAvailableShiftsForRegistration(branchId: string, weekStart: Date): Promise<{ date: string; shifts: { id: string; name: string; start_time: string; end_time: string }[] }[]> {
    // Get shifts for this branch
    const { data: shiftsData } = await supabase
        .from('shifts')
        .select('*')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .order('start_time');

    const shifts = (shiftsData || []) as { id: string; name: string; start_time: string; end_time: string }[];
    if (shifts.length === 0) return [];

    // Generate dates for the week (Mon-Sun)
    const result = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];

        result.push({
            date: dateStr,
            shifts: shifts.map(s => ({
                id: s.id,
                name: s.name,
                start_time: s.start_time,
                end_time: s.end_time
            }))
        });
    }

    return result;
}

// Get employee's registrations for a week
export async function getMyRegistrations(employeeId: string, weekStart: string): Promise<ShiftRegistration[]> {
    const { data, error } = await supabase
        .from('shift_registrations')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('week_start', weekStart);

    if (error) throw error;
    return (data || []) as ShiftRegistration[];
}

// Register for shifts (bulk) - with overlap validation
export async function registerForShifts(
    employeeId: string,
    registrations: { branchId: string; shiftDate: string; shiftId: string }[],
    weekStart: string
): Promise<void> {
    if (registrations.length === 0) return;

    // Fetch shift details for all shifts being registered
    const shiftIds = [...new Set(registrations.map(r => r.shiftId))];
    const { data: shiftsData } = await supabase
        .from('shifts')
        .select('id, name, start_time, end_time')
        .in('id', shiftIds);

    const shiftsMap = new Map((shiftsData || []).map(s => [s.id, s]));

    // Group registrations by date and check for overlaps
    const byDate: Record<string, { shiftId: string; start_time: string; end_time: string; name: string }[]> = {};
    for (const reg of registrations) {
        const shift = shiftsMap.get(reg.shiftId);
        if (!shift) continue;

        if (!byDate[reg.shiftDate]) {
            byDate[reg.shiftDate] = [];
        }
        byDate[reg.shiftDate].push({
            shiftId: reg.shiftId,
            start_time: shift.start_time,
            end_time: shift.end_time,
            name: shift.name
        });
    }

    // Check for overlaps within each date
    for (const [date, shifts] of Object.entries(byDate)) {
        for (let i = 0; i < shifts.length; i++) {
            for (let j = i + 1; j < shifts.length; j++) {
                const s1 = shifts[i];
                const s2 = shifts[j];

                // Simple overlap check
                const start1 = parseTimeToMinutes(s1.start_time);
                const end1 = parseTimeToMinutes(s1.end_time);
                const start2 = parseTimeToMinutes(s2.start_time);
                const end2 = parseTimeToMinutes(s2.end_time);

                if (start1 < end2 && end1 > start2) {
                    throw new Error(`Ca "${s1.name}" trùng giờ với "${s2.name}" trong ngày ${date}`);
                }
            }
        }
    }

    const records = registrations.map(r => ({
        employee_id: employeeId,
        branch_id: r.branchId,
        shift_date: r.shiftDate,
        shift_id: r.shiftId,
        week_start: weekStart,
        status: 'pending',
        registered_at: new Date().toISOString()
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('shift_registrations')
        .upsert(records, { onConflict: 'employee_id,branch_id,shift_date,shift_id' });

    if (error) throw error;
}

// Helper to parse time string to minutes
function parseTimeToMinutes(time: string): number {
    const parts = time.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// Cancel registration
export async function cancelRegistration(registrationId: string): Promise<void> {
    const { error } = await supabase
        .from('shift_registrations')
        .delete()
        .eq('id', registrationId)
        .eq('status', 'pending'); // Can only cancel pending

    if (error) throw error;
}

// Get all registrations for a branch/week (for manager view)
export async function getRegistrationsForApproval(
    branchId: string,
    weekStart: string
): Promise<ShiftRegistration[]> {
    const { data, error } = await supabase
        .from('shift_registrations')
        .select(`
            *,
            users!shift_registrations_employee_id_fkey(full_name),
            shifts(name, start_time, end_time)
        `)
        .eq('branch_id', branchId)
        .eq('week_start', weekStart)
        .order('registered_at', { ascending: true }); // First-come first-served

    if (error) {
        console.error('Error fetching registrations:', error);
        // Fallback without joins
        const { data: fallbackData } = await supabase
            .from('shift_registrations')
            .select('*')
            .eq('branch_id', branchId)
            .eq('week_start', weekStart)
            .order('registered_at', { ascending: true });
        return (fallbackData || []) as ShiftRegistration[];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []).map((r: any) => ({
        ...r,
        employee_name: r.users?.full_name,
        shift_name: r.shifts?.name,
        shift_start: r.shifts?.start_time,
        shift_end: r.shifts?.end_time
    })) as ShiftRegistration[];
}

// Approve/reject registrations
export async function updateRegistrationStatus(
    ids: string[],
    status: 'approved' | 'rejected',
    approvedBy: string
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('shift_registrations')
        .update({
            status,
            approved_by: approvedBy,
            approved_at: new Date().toISOString()
        })
        .in('id', ids);

    if (error) throw error;
}

// Create schedules from approved registrations
export async function createSchedulesFromApproved(
    branchId: string,
    weekStart: string
): Promise<number> {
    // Get approved registrations
    const { data: approvedData } = await supabase
        .from('shift_registrations')
        .select('*')
        .eq('branch_id', branchId)
        .eq('week_start', weekStart)
        .eq('status', 'approved');

    const approved = (approvedData || []) as { employee_id: string; branch_id: string; shift_date: string; shift_id: string }[];
    if (approved.length === 0) return 0;

    // Create schedule records
    const scheduleRecords = approved.map(r => ({
        employee_id: r.employee_id,
        branch_id: r.branch_id,
        date: r.shift_date,
        shift_id: r.shift_id,
        status: 'scheduled',
        notes: 'Từ đăng ký ca'
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
        .from('schedules')
        .upsert(scheduleRecords, { onConflict: 'employee_id,date' });

    if (error) {
        console.error('Error creating schedules:', error);
        throw error;
    }

    return approved.length;
}
