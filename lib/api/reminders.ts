// Reminder System API
// Functions for creating reminder notifications based on pending items

import { supabase } from '../supabase';
import { createBulkNotifications, NotificationType } from './notifications';

// Key to track when we last ran reminders (per session)
const REMINDER_SESSION_KEY = 'hrm_last_reminder_check';

/**
 * Check if we should run reminder check (once per hour)
 */
function shouldRunReminderCheck(): boolean {
    const lastCheck = sessionStorage.getItem(REMINDER_SESSION_KEY);
    if (!lastCheck) return true;

    const hourMs = 60 * 60 * 1000;
    return Date.now() - parseInt(lastCheck) > hourMs;
}

/**
 * Mark that we've run reminder check
 */
function markReminderCheckRun(): void {
    sessionStorage.setItem(REMINDER_SESSION_KEY, Date.now().toString());
}

/**
 * Get managers/admins who can approve leave requests
 */
async function getApproverUserIds(): Promise<string[]> {
    const { data, error } = await supabase
        .from('users')
        .select('id')
        .in('role', ['admin', 'branch_manager']);

    if (error) throw error;
    return (data || []).map(u => u.id);
}

/**
 * Check for pending leave requests and create notifications
 */
export async function checkPendingLeaveRequests(): Promise<number> {
    const { data: pending, error } = await supabase
        .from('leave_requests')
        .select('id, employee_id, employees(name)')
        .eq('status', 'pending');

    if (error) throw error;

    const count = (pending || []).length;
    if (count === 0) return 0;

    // Get approvers
    const approverIds = await getApproverUserIds();
    if (approverIds.length === 0) return 0;

    // Create notifications for each approver
    const notifications = approverIds.map(userId => ({
        user_id: userId,
        type: 'leave_request' as NotificationType,
        title: 'Có đơn nghỉ phép chờ duyệt',
        message: `Có ${count} đơn xin nghỉ phép đang chờ phê duyệt`,
        link: '/dashboard/leaves',
        metadata: { count, type: 'leave_reminder' }
    }));

    await createBulkNotifications(notifications);
    return count;
}

/**
 * Check for pending attendance approvals
 */
export async function checkPendingAttendance(): Promise<number> {
    const { data: pending, error } = await supabase
        .from('attendance')
        .select('id')
        .eq('status', 'pending');

    if (error) throw error;

    const count = (pending || []).length;
    if (count === 0) return 0;

    // Get approvers
    const approverIds = await getApproverUserIds();
    if (approverIds.length === 0) return 0;

    // Create notifications for each approver
    const notifications = approverIds.map(userId => ({
        user_id: userId,
        type: 'attendance_reminder' as NotificationType,
        title: 'Có công chờ duyệt',
        message: `Có ${count} bản ghi chấm công đang chờ duyệt`,
        link: '/dashboard/approval',
        metadata: { count, type: 'attendance_reminder' }
    }));

    await createBulkNotifications(notifications);
    return count;
}

/**
 * Check for pending OT requests (overtime hours without approval)
 */
export async function checkPendingOT(): Promise<number> {
    const { data: pending, error } = await supabase
        .from('attendance')
        .select('id')
        .gt('overtime_hours', 0)
        .eq('ot_approved', false);

    if (error) throw error;

    const count = (pending || []).length;
    if (count === 0) return 0;

    // Get approvers
    const approverIds = await getApproverUserIds();
    if (approverIds.length === 0) return 0;

    // Create notifications for accountants/admins
    const notifications = approverIds.map(userId => ({
        user_id: userId,
        type: 'attendance_reminder' as NotificationType,
        title: 'Có OT chờ duyệt',
        message: `Có ${count} bản ghi tăng ca đang chờ phê duyệt`,
        link: '/dashboard/approval',
        metadata: { count, type: 'ot_reminder' }
    }));

    await createBulkNotifications(notifications);
    return count;
}

/**
 * Run all reminder checks
 * Call this on dashboard load - will auto-throttle to once per hour
 */
export async function runReminderChecks(): Promise<{
    skipped: boolean;
    leaveCount?: number;
    attendanceCount?: number;
    otCount?: number;
}> {
    // Check if we should run (throttle to once per hour)
    if (!shouldRunReminderCheck()) {
        return { skipped: true };
    }

    try {
        const [leaveCount, attendanceCount, otCount] = await Promise.all([
            checkPendingLeaveRequests().catch(() => 0),
            checkPendingAttendance().catch(() => 0),
            checkPendingOT().catch(() => 0)
        ]);

        markReminderCheckRun();

        return {
            skipped: false,
            leaveCount,
            attendanceCount,
            otCount
        };
    } catch (error) {
        console.error('Error running reminder checks:', error);
        return { skipped: false };
    }
}
