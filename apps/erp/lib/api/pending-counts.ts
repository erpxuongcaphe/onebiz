import { supabase } from '../supabase';

// =====================================================
// Types
// =====================================================
export type PendingCounts = {
    leaveRequests: number;
    attendance: number;
    shiftRegistrations: number;
    total: number;
};

// =====================================================
// Get Pending Counts
// =====================================================
export async function getPendingCounts(
    userRole: string,
    branchId?: string
): Promise<PendingCounts> {
    // Only admin, accountant, and branch_manager can see pending counts
    if (!['admin', 'accountant', 'branch_manager'].includes(userRole)) {
        return { leaveRequests: 0, attendance: 0, shiftRegistrations: 0, total: 0 };
    }

    let leaveRequests = 0;
    let attendance = 0;
    let shiftRegistrations = 0;

    try {
        // 1. Count pending leave requests
        if (['admin', 'branch_manager'].includes(userRole)) {
            let leaveQuery = supabase
                .from('leave_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            // Branch manager can only see their branch's requests
            if (userRole === 'branch_manager' && branchId) {
                leaveQuery = leaveQuery.eq('branch_id', branchId);
            }

            const { count: leaveCount } = await leaveQuery;
            leaveRequests = leaveCount || 0;
        }

        // 2. Count pending attendance records
        if (['admin', 'accountant', 'branch_manager'].includes(userRole)) {
            let attendanceQuery = supabase
                .from('attendance')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            if (userRole === 'branch_manager' && branchId) {
                // Get employees from this branch first
                const { data: branchEmployees } = await supabase
                    .from('employees')
                    .select('id')
                    .eq('branch_id', branchId);

                if (branchEmployees && branchEmployees.length > 0) {
                    const employeeIds = branchEmployees.map(e => e.id);
                    attendanceQuery = attendanceQuery.in('employee_id', employeeIds);
                }
            }

            const { count: attendanceCount } = await attendanceQuery;
            attendance = attendanceCount || 0;
        }

        // 3. Count pending shift registrations
        if (['admin', 'branch_manager'].includes(userRole)) {
            let shiftQuery = supabase
                .from('shift_registrations')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'pending');

            if (userRole === 'branch_manager' && branchId) {
                shiftQuery = shiftQuery.eq('branch_id', branchId);
            }

            const { count: shiftCount } = await shiftQuery;
            shiftRegistrations = shiftCount || 0;
        }
    } catch (error) {
        console.error('Error fetching pending counts:', error);
    }

    return {
        leaveRequests,
        attendance,
        shiftRegistrations,
        total: leaveRequests + attendance + shiftRegistrations
    };
}
