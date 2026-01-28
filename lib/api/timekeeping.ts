/* eslint-disable @typescript-eslint/no-explicit-any */
// Branch and Shift API functions
import { supabase } from '../supabaseClient';

// Types
export type Branch = {
    id: string;
    name: string;
    address?: string;
    is_office: boolean;
    is_active: boolean;
    qr_token?: string;
    latitude?: number;
    longitude?: number;
    radius?: number; // meters, default 50
    created_at: string;
    updated_at: string;
};

export type Shift = {
    id: string;
    branch_id: string;
    name: string;
    start_time: string;
    end_time: string;
    hourly_rate: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export type AttendanceRecord = {
    id: string;
    employee_id: string;
    branch_id?: string;
    shift_id?: string;
    schedule_id?: string;
    date: string;
    check_in?: string;
    check_out?: string;
    hours_worked?: number;
    overtime_hours?: number;
    // New OT fields
    scheduled_hours?: number;      // Hours based on shift (capped)
    actual_raw_hours?: number;     // Actual check_out - check_in
    ot_requested_hours?: number;   // Pending OT hours
    ot_approved?: boolean;         // OT approval status
    ot_approved_by?: string;       // Who approved
    ot_approved_at?: string;       // When approved
    status: 'pending' | 'approved' | 'ontime' | 'late' | 'early_leave' | 'absent' | 'rejected';
    notes?: string;
    checked_by?: string;
    approved_by?: string;
    approved_at?: string;
    created_at: string;
    updated_at: string;
};

// ============ BRANCHES ============

export async function getBranches(): Promise<Branch[]> {
    const { data, error } = await supabase
        .from('branches')
        .select('*')
        .order('is_office', { ascending: false })
        .order('name');

    if (error) throw error;
    return (data || []) as unknown as Branch[];
}

export async function createBranch(branch: { name: string; address?: string; is_office: boolean }): Promise<Branch> {
    const { data, error } = await supabase
        .from('branches')
        .insert(branch as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Branch;
}

export async function updateBranch(id: string, updates: Partial<Branch>): Promise<Branch> {
    const { data, error } = await supabase
        .from('branches')
        .update({ ...updates, updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Branch;
}

export async function deleteBranch(id: string): Promise<void> {
    const { error } = await supabase
        .from('branches')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// ============ SHIFTS ============

export async function getShifts(branchId?: string): Promise<Shift[]> {
    let query = supabase.from('shifts').select('*').order('start_time');

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as Shift[];
}

export async function createShift(shift: {
    branch_id: string;
    name: string;
    start_time: string;
    end_time: string;
    hourly_rate?: number
}): Promise<Shift> {
    const { data, error } = await supabase
        .from('shifts')
        .insert(shift as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Shift;
}

export async function updateShift(id: string, updates: Partial<Shift>): Promise<Shift> {
    const { data, error } = await supabase
        .from('shifts')
        .update({ ...updates, updated_at: new Date().toISOString() } as never)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Shift;
}

export async function deleteShift(id: string): Promise<void> {
    const { error } = await supabase
        .from('shifts')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// ============ ATTENDANCE ============

export async function getAttendanceRecords(filters?: {
    date?: string;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    employeeId?: string
}): Promise<AttendanceRecord[]> {
    let query = supabase.from('attendance_records').select('*').order('check_in', { ascending: false });

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
    return (data || []) as unknown as AttendanceRecord[];
}

export async function checkIn(employeeId: string, branchId?: string, shiftId?: string): Promise<AttendanceRecord> {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const { data, error } = await supabase
        .from('attendance_records')
        .insert({
            employee_id: employeeId,
            branch_id: branchId,
            shift_id: shiftId,
            date: today,
            check_in: now.toISOString(),
            status: 'pending'
        } as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}

export async function checkOut(recordId: string): Promise<AttendanceRecord> {
    const now = new Date();

    // First get the record to calculate hours
    const { data: record } = await supabase
        .from('attendance_records')
        .select('check_in')
        .eq('id', recordId)
        .single();

    let hoursWorked = 0;
    const recordData = record as { check_in?: string } | null;
    if (recordData?.check_in) {
        const checkInTime = new Date(recordData.check_in);
        hoursWorked = (now.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
    }

    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            check_out: now.toISOString(),
            hours_worked: Math.round(hoursWorked * 100) / 100,
            updated_at: now.toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}

export async function updateAttendanceStatus(recordId: string, status: AttendanceRecord['status']): Promise<AttendanceRecord> {
    const { data, error } = await supabase
        .from('attendance_records')
        .update({ status, updated_at: new Date().toISOString() } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}

// Update attendance record (for admin to edit check-in/check-out times)
export async function updateAttendanceRecord(recordId: string, updates: {
    check_in?: string;
    check_out?: string;
    notes?: string;
    status?: AttendanceRecord['status'];
}): Promise<AttendanceRecord> {
    // First, fetch the existing record to get current values
    const { data: existingRecord, error: fetchError } = await supabase
        .from('attendance_records')
        .select('check_in, check_out, shift_id, ot_approved, overtime_hours')
        .eq('id', recordId)
        .single();

    if (fetchError) throw fetchError;

    const existing = existingRecord as {
        check_in?: string;
        check_out?: string;
        shift_id?: string;
        ot_approved?: boolean;
        overtime_hours?: number;
    } | null;

    // Determine final check_in and check_out times
    const finalCheckIn = updates.check_in ?? existing?.check_in;
    const finalCheckOut = updates.check_out ?? existing?.check_out;

    // Calculate hours
    let hoursWorked: number | undefined;
    let scheduledHours: number | undefined;
    let actualRawHours: number | undefined;
    let otRequestedHours: number | undefined;

    if (finalCheckIn && finalCheckOut) {
        const checkInTime = new Date(finalCheckIn);
        const checkOutTime = new Date(finalCheckOut);

        // Try to fetch shift details if shift_id exists
        let shiftDetails = null;
        if (existing?.shift_id) {
            const { data: shift } = await supabase
                .from('shifts')
                .select('start_time, end_time')
                .eq('id', existing.shift_id)
                .single();
            shiftDetails = shift;
        }

        if (shiftDetails) {
            // Use shift-based calculation
            const settings = await getOfficeSettings();
            const lunchStart = settings['lunch_start_time'] || '12:00';
            const lunchEnd = settings['lunch_end_time'] || '13:30';

            const calc = calculateShiftBasedHours(
                checkInTime,
                checkOutTime,
                shiftDetails.start_time,
                shiftDetails.end_time,
                8, // Default max hours
                lunchStart,
                lunchEnd
            );
            scheduledHours = calc.scheduledHours;
            actualRawHours = calc.actualRawHours;
            otRequestedHours = calc.otRequestedHours;

            // If OT is already approved, we include it? 
            // When editing time, we should strictly rely on the new calculation.
            // If the previous record had approved OT, changing time might change that OT.
            // Safe approach: Update 'hours_worked' to scheduled + (existing approved OT logic?)
            // Actually, if we edit time, we should reset explicit OT logic or recalculate.
            // Let's set hours_worked = scheduledHours (base). 
            // If OT was approved, it needs Re-approval usually. 
            // But to avoid losing data, let's say:
            hoursWorked = scheduledHours;

            // If there was specifically "Manual OT" (overtime_hours > 0 and ot_requested_hours differ?), 
            // it's hard to distinguish.
            // But typically hours_worked = scheduled + overtime.
            if (existing?.ot_approved && existing?.overtime_hours) {
                hoursWorked += existing.overtime_hours;
            }
        } else {
            // No shift, simple calculation
            hoursWorked = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
            hoursWorked = Math.round(hoursWorked * 100) / 100;
        }

        // Cap reasonable limits
        if (hoursWorked && hoursWorked > 24) hoursWorked = 24;
        if (hoursWorked && hoursWorked < 0) hoursWorked = 0;
    }

    const updateData: Record<string, unknown> = {
        ...updates,
        updated_at: new Date().toISOString()
    };

    if (hoursWorked !== undefined) updateData.hours_worked = hoursWorked;
    if (scheduledHours !== undefined) updateData.scheduled_hours = scheduledHours;
    if (actualRawHours !== undefined) updateData.actual_raw_hours = actualRawHours;
    if (otRequestedHours !== undefined) {
        updateData.ot_requested_hours = otRequestedHours;
        // If we are changing time, and we have a new OT request amount available, 
        // we might want to un-approve if it was approved? 
        // Or if the user (Admin) is editing, maybe just leave it provided they manage OT separately.
        // But the user reported "hours not jumping".
    }

    const { data, error } = await supabase
        .from('attendance_records')
        .update(updateData as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}

// ============ QR ATTENDANCE ============

// Generate a random QR token for a branch
function generateRandomToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Generate or regenerate QR token for a branch
export async function generateQRToken(branchId: string): Promise<Branch> {
    const newToken = generateRandomToken();

    const { data, error } = await supabase
        .from('branches')
        .update({ qr_token: newToken, updated_at: new Date().toISOString() } as never)
        .eq('id', branchId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as Branch;
}

// Get branch by QR token
export async function getBranchByQRToken(qrToken: string): Promise<Branch | null> {
    const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('qr_token', qrToken)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        throw error;
    }
    return data as unknown as Branch;
}

// ============ GPS DISTANCE CALCULATION ============

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @returns Distance in meters
 */
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in meters
}

// ============ WORK SCHEDULES ============

export type WorkSchedule = {
    id: string;
    employee_id: string;
    branch_id?: string;
    shift_id?: string;
    date: string;
    status: 'scheduled' | 'completed' | 'absent' | 'cancelled';
    custom_start?: string;
    custom_end?: string;
    notes?: string;
    created_by?: string;
    created_at: string;
    updated_at: string;
};

// Get work schedule for an employee on a specific date
export async function getWorkSchedule(employeeId: string, date: string): Promise<WorkSchedule | null> {
    const { data, error } = await supabase
        .from('work_schedules')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('date', date)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null; // Not found
        console.error('Error fetching schedule:', error);
        return null;
    }
    return data as unknown as WorkSchedule;
}

// Create work schedule
export async function createWorkSchedule(schedule: {
    employee_id: string;
    branch_id?: string;
    shift_id?: string;
    date: string;
    custom_start?: string;
    custom_end?: string;
    notes?: string;
    created_by?: string;
}): Promise<WorkSchedule> {
    const { data, error } = await supabase
        .from('work_schedules')
        .insert(schedule as never)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as WorkSchedule;
}

// Get all work schedules with filters
export async function getWorkSchedules(filters?: {
    employeeId?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
}): Promise<WorkSchedule[]> {
    let query = supabase.from('work_schedules').select('*').order('date', { ascending: true });

    if (filters?.employeeId) {
        query = query.eq('employee_id', filters.employeeId);
    }
    if (filters?.branchId) {
        query = query.eq('branch_id', filters.branchId);
    }
    if (filters?.startDate) {
        query = query.gte('date', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('date', filters.endDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as unknown as WorkSchedule[];
}

// Delete work schedule
export async function deleteWorkSchedule(id: string): Promise<void> {
    const { error } = await supabase
        .from('work_schedules')
        .delete()
        .eq('id', id);

    if (error) throw error;
}

// Get office settings
export async function getOfficeSettings(): Promise<{ [key: string]: string }> {
    try {
        const { data, error } = await (supabase as any)
            .from('office_settings')
            .select('*');

        if (error) {
            console.warn('office_settings table error:', error);
            // Return defaults if table doesn't exist
            return {
                'work_days': '1,2,3,4,5,6',
                'office_start_time': '08:00',
                'office_end_time': '17:30'
            };
        }

        const settings: { [key: string]: string } = {};
        (data || []).forEach((s: { key: string; value: string }) => {
            settings[s.key] = s.value;
        });

        // Return defaults if no settings found
        if (Object.keys(settings).length === 0) {
            return {
                'work_days': '1,2,3,4,5,6',
                'office_start_time': '08:00',
                'office_end_time': '17:30'
            };
        }

        return settings;
    } catch (err) {
        console.warn('getOfficeSettings error:', err);
        return {
            'work_days': '1,2,3,4,5,6',
            'office_start_time': '08:00',
            'office_end_time': '17:30'
        };
    }
}

// Auto-generate work schedules for monthly employees
export async function autoGenerateSchedules(
    startDate: string,
    endDate: string,
    createdBy: string,
    employeeIds?: string[] // Optional: specific employees, if empty = all monthly employees
): Promise<{ created: number; skipped: number }> {
    // 1. Get office settings
    const settings = await getOfficeSettings();
    const workDays = (settings['work_days'] || '1,2,3,4,5,6').split(',').map(Number);

    // 2. Get monthly employees with their branch
    let employeeQuery = supabase
        .from('employees')
        .select('id, branch_id, employee_type')
        .in('employee_type', ['full_time_monthly', 'probation', 'intern'])
        .eq('status', 'active');

    // Filter by specific employee IDs if provided
    if (employeeIds && employeeIds.length > 0) {
        employeeQuery = employeeQuery.in('id', employeeIds);
    }

    const { data: employeesData, error: empError } = await employeeQuery;

    if (empError) throw empError;

    const employees = (employeesData || []) as Array<{ id: string; branch_id: string | null; employee_type: string }>;

    if (employees.length === 0) {
        return { created: 0, skipped: 0 };
    }

    // 3. Get office branches and their shifts
    const { data: branches, error: branchError } = await supabase
        .from('branches')
        .select('id')
        .eq('is_office', true);

    if (branchError) throw branchError;

    const officeBranchIds = new Set((branches || []).map((b: { id: string }) => b.id));

    // If no office branches, return early
    if (officeBranchIds.size === 0) {
        console.log('No office branches found');
        return { created: 0, skipped: 0 };
    }

    // 4. Get shifts for office branches (Giờ hành chính)
    const { data: shifts, error: shiftError } = await supabase
        .from('shifts')
        .select('id, branch_id, name')
        .in('branch_id', Array.from(officeBranchIds));

    if (shiftError) throw shiftError;

    // Map branch to shift
    const branchShiftMap: { [branchId: string]: string } = {};
    (shifts || []).forEach((s: { id: string; branch_id: string | null; name: string }) => {
        if (!s.branch_id) return;
        // Prefer "Giờ hành chính" shift
        if (s.name === 'Giờ hành chính' || !branchShiftMap[s.branch_id]) {
            branchShiftMap[s.branch_id] = s.id;
        }
    });

    // 5. Generate dates between startDate and endDate
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
        const dayOfWeek = current.getDay(); // 0 = Sunday, 1 = Monday, etc.
        if (workDays.includes(dayOfWeek)) {
            dates.push(current.toISOString().split('T')[0]);
        }
        current.setDate(current.getDate() + 1);
    }

    // 6. Create schedules for each monthly employee for each work day
    let created = 0;
    let skipped = 0;

    for (const emp of employees) {
        // Only for employees at office branches
        if (!emp.branch_id || !officeBranchIds.has(emp.branch_id)) {
            continue;
        }

        const shiftId = branchShiftMap[emp.branch_id];

        for (const date of dates) {
            // Check if schedule already exists
            const { data: existing } = await supabase
                .from('work_schedules')
                .select('id')
                .eq('employee_id', emp.id)
                .eq('date', date)
                .limit(1);

            if (existing && existing.length > 0) {
                skipped++;
                continue;
            }

            // Create schedule
            const { error: insertError } = await supabase
                .from('work_schedules')
                .insert({
                    employee_id: emp.id,
                    branch_id: emp.branch_id,
                    shift_id: shiftId,
                    date: date,
                    status: 'scheduled',
                    created_by: createdBy
                } as never);

            if (!insertError) {
                created++;
            } else {
                skipped++;
            }
        }
    }

    return { created, skipped };
}

export async function checkInByQR(
    userId: string,
    qrToken: string,
    userLocation?: { lat: number; lng: number }
): Promise<{
    success: boolean;
    message: string;
    record?: AttendanceRecord;
    branch?: Branch;
    action?: 'check_in' | 'check_out';
    distance?: number;
}> {
    // Find branch by QR token
    const branch = await getBranchByQRToken(qrToken);
    if (!branch) {
        return { success: false, message: 'Mã QR không hợp lệ hoặc chi nhánh không tồn tại.' };
    }

    // GPS validation - REQUIRED if branch has coordinates
    if (branch.latitude && branch.longitude) {
        // Branch has GPS configured - require user location
        if (!userLocation) {
            return {
                success: false,
                message: 'Vui lòng cấp quyền GPS để chấm công. Không thể xác minh vị trí của bạn.'
            };
        }

        const distance = calculateDistance(
            userLocation.lat,
            userLocation.lng,
            branch.latitude,
            branch.longitude
        );
        const allowedRadius = branch.radius || 50; // Default 50 meters

        if (distance > allowedRadius) {
            return {
                success: false,
                message: `Bạn đang ở quá xa chi nhánh (${Math.round(distance)}m). Vui lòng đến gần hơn (trong vòng ${allowedRadius}m) để chấm công.`,
                distance: Math.round(distance)
            };
        }
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // First, check if this userId is actually a User (from users table) that has a linked employee
    // This is important for looking up work_schedules which are stored by employee_id
    let employeeIdForSchedule: string = userId;
    const { data: userData } = await supabase
        .from('users')
        .select('employee_id')
        .eq('id', userId)
        .single();

    if (userData && (userData as any).employee_id) {
        employeeIdForSchedule = (userData as any).employee_id;
    }

    // Check if user already has a check-in today at this branch without check-out
    const { data: existingRecords } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('employee_id', userId)
        .eq('branch_id', branch.id)
        .eq('date', today)
        .is('check_out', null)
        .order('check_in', { ascending: false })
        .limit(1);


    const records = existingRecords as AttendanceRecord[] | null;

    // Fetch shifts for this branch to check late/early
    const branchShifts = await getShifts(branch.id);
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

    // Find matching shift (shift that covers current time)
    const matchingShift = branchShifts.find(shift => {
        return currentTime >= shift.start_time.slice(0, 5) || currentTime <= shift.end_time.slice(0, 5);
    }) || branchShifts[0]; // Default to first shift if no match

    if (records && records.length > 0) {
        // User has an open check-in, so this is a check-out
        const record = records[0];
        const checkInTime = new Date(record.check_in!);

        // Calculate shift start/end times
        let shiftStartTime: Date | null = null;
        let shiftEndTime: Date | null = null;

        if (record.shift_id) {
            const shift = branchShifts.find(s => s.id === record.shift_id);
            if (shift) {
                const [startHour, startMin] = shift.start_time.split(':').map(Number);
                const [endHour, endMin] = shift.end_time.split(':').map(Number);

                shiftStartTime = new Date(checkInTime);
                shiftStartTime.setHours(startHour, startMin, 0, 0);
                shiftEndTime = new Date(checkInTime);
                shiftEndTime.setHours(endHour, endMin, 0, 0);

                // Handle overnight shifts
                if (shiftEndTime < shiftStartTime) {
                    shiftEndTime.setDate(shiftEndTime.getDate() + 1);
                }
            }
        } else if (matchingShift) {
            const [startHour, startMin] = matchingShift.start_time.split(':').map(Number);
            const [endHour, endMin] = matchingShift.end_time.split(':').map(Number);

            shiftStartTime = new Date(checkInTime);
            shiftStartTime.setHours(startHour, startMin, 0, 0);
            shiftEndTime = new Date(checkInTime);
            shiftEndTime.setHours(endHour, endMin, 0, 0);
        }

        // Calculate hours worked using centralized logic
        let hoursWorked = 0;

        let sStartStr = '08:00';
        let sEndStr = '17:30';
        let hasShift = false;

        if (record.shift_id) {
            const shift = branchShifts.find(s => s.id === record.shift_id);
            if (shift) {
                sStartStr = shift.start_time;
                sEndStr = shift.end_time;
                hasShift = true;
            }
        } else if (matchingShift) {
            sStartStr = matchingShift.start_time;
            sEndStr = matchingShift.end_time;
            hasShift = true;
        }

        if (hasShift) {
            const settings = await getOfficeSettings();
            const lunchStart = settings['lunch_start_time'] || '12:00';
            const lunchEnd = settings['lunch_end_time'] || '13:30';

            const calc = calculateShiftBasedHours(
                checkInTime,
                now,
                sStartStr.slice(0, 5),
                sEndStr.slice(0, 5),
                8,
                lunchStart,
                lunchEnd
            );
            hoursWorked = calc.scheduledHours;
        } else {
            // No shift found, calculation based on raw checking time (simple diff)
            hoursWorked = Math.max(0, (now.getTime() - checkInTime.getTime()) / (1000 * 60 * 60));
        }

        // Check for early check-out (only this requires approval)
        let status: AttendanceRecord['status'] = 'approved';
        let earlyLeaveMinutes = 0;

        if (shiftEndTime) {
            const diffMinutes = (shiftEndTime.getTime() - now.getTime()) / (1000 * 60);
            if (diffMinutes > 15) { // More than 15 minutes early
                status = 'pending'; // Về sớm cần duyệt
                earlyLeaveMinutes = Math.round(diffMinutes);
            }
        }

        // NOTE: OT is NOT calculated automatically
        // Manager will add OT manually via manualOT or updateAttendanceHours functions
        const overtimeHours = 0; // Always 0, OT added manually

        const { data: updatedRecord, error } = await supabase
            .from('attendance_records')
            .update({
                check_out: now.toISOString(),
                hours_worked: Math.round(hoursWorked * 100) / 100,
                overtime_hours: overtimeHours,
                status: status,
                updated_at: now.toISOString()
            } as never)
            .eq('id', record.id)
            .select()
            .single();

        if (error) throw error;

        // Build message
        let message = `Check-out thành công tại ${branch.name}. Số giờ làm: ${hoursWorked.toFixed(2)} giờ.`;
        if (earlyLeaveMinutes > 0) {
            message = `⚠️ Bạn về sớm ${earlyLeaveMinutes} phút - cần quản lý duyệt. ${message}`;
        }
        if (shiftEndTime && now > shiftEndTime) {
            const lateMinutes = Math.round((now.getTime() - shiftEndTime.getTime()) / (1000 * 60));
            message = `✅ Check-out thành công. Bạn ở lại thêm ${lateMinutes} phút (OT cần quản lý chấm thủ công).`;
        }

        return {
            success: true,
            message,
            record: updatedRecord as AttendanceRecord,
            branch,
            action: 'check_out'
        };
    } else {
        // No open check-in, create new check-in

        // Check if employee has a schedule for today
        const todaySchedule = await getWorkSchedule(employeeIdForSchedule, today);
        const hasSchedule = !!todaySchedule;

        // Check for late check-in
        // Default: no schedule = pending, has schedule & on-time = approved, late = pending
        let status: AttendanceRecord['status'] = 'pending';
        let lateMinutes = 0;
        let scheduleShiftId: string | undefined;
        let isLate = false;

        if (todaySchedule && todaySchedule.shift_id) {
            scheduleShiftId = todaySchedule.shift_id;
            // Get shift times from schedule
            const shift = branchShifts.find(s => s.id === todaySchedule.shift_id);
            if (shift) {
                const [startHour, startMin] = shift.start_time.split(':').map(Number);
                const shiftStart = new Date(now);
                shiftStart.setHours(startHour, startMin, 0, 0);

                const diffMinutes = (now.getTime() - shiftStart.getTime()) / (1000 * 60);
                if (diffMinutes > 15) { // More than 15 minutes late
                    isLate = true;
                    lateMinutes = Math.round(diffMinutes);
                }
                // Early check-in (diffMinutes < 0) is fine, will be approved
                // Hours will be calculated from shift start, not check-in time
            }
        } else if (matchingShift) {
            const [startHour, startMin] = matchingShift.start_time.split(':').map(Number);
            const shiftStart = new Date(now);
            shiftStart.setHours(startHour, startMin, 0, 0);

            const diffMinutes = (now.getTime() - shiftStart.getTime()) / (1000 * 60);
            if (diffMinutes > 15) { // More than 15 minutes late
                isLate = true;
                lateMinutes = Math.round(diffMinutes);
            }
        }

        // Auto-approve only if has schedule AND on-time
        if (hasSchedule && !isLate) {
            status = 'approved';
        }

        const { data: newRecord, error } = await supabase
            .from('attendance_records')
            .insert({
                employee_id: userId,
                branch_id: branch.id,
                shift_id: scheduleShiftId || matchingShift?.id,
                schedule_id: todaySchedule?.id,
                date: today,
                check_in: now.toISOString(),
                status: status
            } as never)
            .select()
            .single();

        if (error) throw error;

        // Build message with late warning and schedule status
        let message = `Check-in thành công tại ${branch.name}.`;
        if (!hasSchedule) {
            message = `📋 Bạn không có lịch hôm nay - cần quản lý duyệt. ${message}`;
        }
        if (isLate) {
            message = `⚠️ Bạn đi trễ ${lateMinutes} phút - cần quản lý duyệt. ${message}`;
        }

        return {
            success: true,
            message,
            record: newRecord as AttendanceRecord,
            branch,
            action: 'check_in'
        };
    }
}

// ============ APPROVAL FUNCTIONS ============

// Get pending attendance records for approval
export async function getPendingRecords(branchId?: string): Promise<AttendanceRecord[]> {
    let query = supabase
        .from('attendance_records')
        .select('*')
        .eq('status', 'pending')
        .order('date', { ascending: false });

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as AttendanceRecord[];
}

// Approve attendance record
export async function approveRecord(recordId: string, approvedBy: string): Promise<AttendanceRecord> {
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            status: 'approved',
            approved_by: approvedBy,
            approved_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as AttendanceRecord;
}

// Reject attendance record
export async function rejectRecord(recordId: string, approvedBy: string, notes?: string): Promise<AttendanceRecord> {
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            status: 'rejected',
            approved_by: approvedBy,
            approved_at: new Date().toISOString(),
            notes: notes || 'Bị từ chối',
            updated_at: new Date().toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as AttendanceRecord;
}

// Get rejected attendance records
export async function getRejectedRecords(branchId?: string): Promise<AttendanceRecord[]> {
    let query = supabase
        .from('attendance_records')
        .select('*')
        .eq('status', 'rejected')
        .order('date', { ascending: false });

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as AttendanceRecord[];
}

// Re-approve a rejected attendance record
export async function reApproveRecord(recordId: string, approvedBy: string, notes?: string): Promise<AttendanceRecord> {
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            status: 'approved',
            approved_by: approvedBy,
            approved_at: new Date().toISOString(),
            notes: notes ? `Đã duyệt lại: ${notes}` : 'Đã duyệt lại',
            updated_at: new Date().toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as AttendanceRecord;
}

// Manual attendance check-in by admin/manager
export async function manualCheckIn(params: {
    employeeId: string;
    branchId: string;
    date: string;
    checkIn: string;
    checkOut?: string;
    notes: string;
    createdBy: string;
}): Promise<AttendanceRecord> {
    const { employeeId, branchId, date, checkIn, checkOut, notes, createdBy } = params;

    // Calculate hours worked if check-out is provided
    let hoursWorked: number | undefined;
    if (checkOut) {
        const start = new Date(`${date}T${checkIn}:00`);
        const end = new Date(`${date}T${checkOut}:00`);
        hoursWorked = Math.round(((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 100) / 100;
    }

    const { data, error } = await supabase
        .from('attendance_records')
        .insert({
            employee_id: employeeId,
            branch_id: branchId,
            date: date,
            check_in: new Date(`${date}T${checkIn}:00`).toISOString(),
            check_out: checkOut ? new Date(`${date}T${checkOut}:00`).toISOString() : null,
            hours_worked: hoursWorked,
            status: 'approved',
            notes: `[Chấm công thủ công] ${notes}`,
            approved_by: createdBy,
            approved_at: new Date().toISOString()
        } as never)
        .select()
        .single();

    if (error) throw error;
    return data as AttendanceRecord;
}

// Update attendance hours (for branch manager)
export async function updateAttendanceHours(
    recordId: string,
    hoursWorked: number,
    overtimeHours: number,
    updatedBy: string,
    notes?: string
): Promise<AttendanceRecord> {
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            hours_worked: hoursWorked,
            overtime_hours: overtimeHours,
            notes: notes ? `[Đã sửa] ${notes}` : undefined,
            checked_by: updatedBy,
            updated_at: new Date().toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as AttendanceRecord;
}

// ============ SHIFT-BASED HOURS CALCULATION ============

// Helper function to calculate shift-based hours
export function calculateShiftBasedHours(
    checkIn: Date,
    checkOut: Date,
    shiftStart: string, // "HH:MM" format
    shiftEnd: string,   // "HH:MM" format
    maxHoursPerDay: number = 8,
    lunchStart: string = '12:00',
    lunchEnd: string = '13:30'
): { scheduledHours: number; actualRawHours: number; otRequestedHours: number } {
    // Parse shift times
    const [startHour, startMin] = shiftStart.split(':').map(Number);
    const [endHour, endMin] = shiftEnd.split(':').map(Number);

    // Create shift boundaries for the check-in date
    const shiftStartTime = new Date(checkIn);
    shiftStartTime.setHours(startHour, startMin, 0, 0);

    const shiftEndTime = new Date(checkIn);
    shiftEndTime.setHours(endHour, endMin, 0, 0);

    // Handle overnight shifts
    if (shiftEndTime <= shiftStartTime) {
        shiftEndTime.setDate(shiftEndTime.getDate() + 1);
    }

    // Parse lunch times
    const [lunchStartHour, lunchStartMin] = lunchStart.split(':').map(Number);
    const [lunchEndHour, lunchEndMin] = lunchEnd.split(':').map(Number);

    const lunchStartTime = new Date(checkIn);
    lunchStartTime.setHours(lunchStartHour, lunchStartMin, 0, 0);

    const lunchEndTime = new Date(checkIn);
    lunchEndTime.setHours(lunchEndHour, lunchEndMin, 0, 0);

    // Calculate actual raw hours (total time clocked)
    const actualRawHours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);

    // Calculate scheduled hours (capped to shift boundaries)
    const effectiveStart = checkIn > shiftStartTime ? checkIn : shiftStartTime;
    const effectiveEnd = checkOut < shiftEndTime ? checkOut : shiftEndTime;

    let scheduledHours = 0;
    if (effectiveEnd > effectiveStart) {
        scheduledHours = (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60);

        // Deduct lunch if it falls within the worked period
        // Determine overlap between [effectiveStart, effectiveEnd] and [lunchStartTime, lunchEndTime]
        const overlapStart = effectiveStart > lunchStartTime ? effectiveStart : lunchStartTime;
        const overlapEnd = effectiveEnd < lunchEndTime ? effectiveEnd : lunchEndTime;

        if (overlapEnd > overlapStart) {
            const lunchDeduction = (overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60);
            scheduledHours -= lunchDeduction;
        }
    }

    // Cap to max hours per day
    scheduledHours = Math.min(scheduledHours, maxHoursPerDay);

    // Calculate OT requested (actual - scheduled, if positive)
    let otRequestedHours = actualRawHours - scheduledHours;
    otRequestedHours = otRequestedHours > 0 ? otRequestedHours : 0;

    return {
        scheduledHours: Math.round(scheduledHours * 100) / 100,
        actualRawHours: Math.round(actualRawHours * 100) / 100,
        otRequestedHours: Math.round(otRequestedHours * 100) / 100
    };
}

// Check out with shift-based hours calculation
export async function checkOutWithShiftCalc(
    recordId: string,
    shiftStart?: string,
    shiftEnd?: string,
    maxHoursPerDay: number = 8
): Promise<AttendanceRecord> {
    const now = new Date();

    // Get the existing record
    const { data: record, error: fetchError } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('id', recordId)
        .single();

    if (fetchError) throw fetchError;

    const recordData = record as AttendanceRecord;
    if (!recordData.check_in) {
        throw new Error('No check-in time found');
    }

    const checkIn = new Date(recordData.check_in);

    // Calculate hours
    let scheduledHours: number;
    let actualRawHours: number;
    let otRequestedHours: number;

    if (shiftStart && shiftEnd) {
        // Use shift-based calculation
        const settings = await getOfficeSettings();
        const lunchStart = settings['lunch_start_time'] || '12:00';
        const lunchEnd = settings['lunch_end_time'] || '13:30';

        const calc = calculateShiftBasedHours(checkIn, now, shiftStart, shiftEnd, maxHoursPerDay, lunchStart, lunchEnd);
        scheduledHours = calc.scheduledHours;
        actualRawHours = calc.actualRawHours;
        otRequestedHours = calc.otRequestedHours;
    } else {
        // Fallback: just calculate raw hours, cap at max
        actualRawHours = (now.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
        actualRawHours = Math.round(actualRawHours * 100) / 100;
        scheduledHours = Math.min(actualRawHours, maxHoursPerDay);
        otRequestedHours = actualRawHours > maxHoursPerDay ? actualRawHours - maxHoursPerDay : 0;
    }

    // Update the record
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            check_out: now.toISOString(),
            hours_worked: scheduledHours,
            scheduled_hours: scheduledHours,
            actual_raw_hours: actualRawHours,
            ot_requested_hours: otRequestedHours,
            ot_approved: false,
            updated_at: now.toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}

// ============ OT APPROVAL ============

// Get attendance records with pending OT
export async function getPendingOTRecords(filters?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
}): Promise<AttendanceRecord[]> {
    let query = supabase
        .from('attendance_records')
        .select('*')
        .gt('ot_requested_hours', 0)
        .eq('ot_approved', false)
        .order('date', { ascending: false });

    if (filters?.startDate && filters?.endDate) {
        query = query.gte('date', filters.startDate).lte('date', filters.endDate);
    }
    if (filters?.branchId) {
        query = query.eq('branch_id', filters.branchId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as AttendanceRecord[];
}

// Approve OT for a record
export async function approveOvertime(
    recordId: string,
    approvedBy: string,
    approvedHours?: number // Optional: approve partial OT hours
): Promise<AttendanceRecord> {
    const now = new Date();

    // Get current record to check OT hours
    const { data: record } = await supabase
        .from('attendance_records')
        .select('ot_requested_hours, hours_worked')
        .eq('id', recordId)
        .single();

    const currentRecord = record as { ot_requested_hours?: number; hours_worked?: number } | null;
    const finalOTHours = approvedHours ?? currentRecord?.ot_requested_hours ?? 0;

    // Update record with approved OT
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            ot_approved: true,
            ot_approved_by: approvedBy,
            ot_approved_at: now.toISOString(),
            overtime_hours: finalOTHours,
            // Add approved OT to total hours_worked
            hours_worked: (currentRecord?.hours_worked || 0) + finalOTHours,
            updated_at: now.toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}

// Reject OT for a record
export async function rejectOvertime(
    recordId: string,
    rejectedBy: string,
    reason?: string
): Promise<AttendanceRecord> {
    const now = new Date();

    // Get current notes
    const { data: record } = await supabase
        .from('attendance_records')
        .select('notes')
        .eq('id', recordId)
        .single();

    const currentNotes = (record as { notes?: string } | null)?.notes || '';
    const newNotes = reason
        ? `${currentNotes}\n[OT từ chối] ${reason}`.trim()
        : currentNotes;

    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            ot_approved: false,
            ot_requested_hours: 0, // Reset OT request
            overtime_hours: 0,
            notes: newNotes,
            updated_at: now.toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}

// Add OT manually (for manager to assign OT hours to an employee)
export async function addManualOT(
    recordId: string,
    otHours: number,
    addedBy: string,
    reason?: string
): Promise<AttendanceRecord> {
    const now = new Date();

    // Get current record
    const { data: record, error: fetchError } = await supabase
        .from('attendance_records')
        .select('hours_worked, notes')
        .eq('id', recordId)
        .single();

    if (fetchError) throw fetchError;

    const currentRecord = record as { hours_worked?: number; notes?: string } | null;
    const currentNotes = currentRecord?.notes || '';
    const newNotes = reason
        ? `${currentNotes}\n[OT ${otHours}h - ${reason}]`.trim()
        : `${currentNotes}\n[OT ${otHours}h]`.trim();

    // Update record with OT
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            ot_requested_hours: otHours,
            ot_approved: true, // Auto-approve since manager is adding it
            ot_approved_by: addedBy,
            ot_approved_at: now.toISOString(),
            overtime_hours: otHours,
            // Add OT to total hours
            hours_worked: (currentRecord?.hours_worked || 0) + otHours,
            notes: newNotes,
            updated_at: now.toISOString()
        } as never)
        .eq('id', recordId)
        .select()
        .single();

    if (error) throw error;
    return data as unknown as AttendanceRecord;
}
