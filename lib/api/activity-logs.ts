// Activity Logs API
import { supabase } from '../supabaseClient';
import { UserRole } from '../database.types';

// Types
export type ActivityAction = 'create' | 'update' | 'delete';

export type ActivityLog = {
    id: string;
    user_id: string;
    user_name: string | null;
    user_role: UserRole | null;
    action: ActivityAction;
    entity_type: string;
    entity_id: string | null;
    entity_name: string | null;
    details: Record<string, unknown> | null;
    created_at: string;
};

export type LogActivityInput = {
    userId: string;
    userName: string;
    userRole: UserRole;
    action: ActivityAction;
    entityType: string;
    entityId?: string;
    entityName?: string;
    details?: Record<string, unknown>;
};

// Role hierarchy levels (higher = more privilege)
const roleLevel: Record<UserRole, number> = {
    admin: 4,
    accountant: 3,
    branch_manager: 2,
    member: 1
};

// Get roles that a user can view based on their role
function getVisibleRoles(currentRole: UserRole): UserRole[] {
    const level = roleLevel[currentRole];
    return (Object.entries(roleLevel) as [UserRole, number][])
        .filter(([, l]) => l <= level)
        .map(([role]) => role);
}

// Log an activity
export async function logActivity(input: LogActivityInput): Promise<void> {
    try {
        const { error } = await supabase
            .from('activity_logs')
            .insert({
                user_id: input.userId,
                user_name: input.userName,
                user_role: input.userRole,
                action: input.action,
                entity_type: input.entityType,
                entity_id: input.entityId || null,
                entity_name: input.entityName || null,
                details: input.details || null
            } as never);

        if (error) {
            console.error('Error logging activity:', error);
        }
    } catch (err) {
        console.error('Failed to log activity:', err);
        // Don't throw - logging should not break main operations
    }
}

// Get activity logs with role-based filtering
export async function getActivityLogs(
    currentUserRole: UserRole,
    limit: number = 10
): Promise<ActivityLog[]> {
    // Members cannot view activity logs
    if (currentUserRole === 'member') {
        return [];
    }

    const visibleRoles = getVisibleRoles(currentUserRole);

    const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .in('user_role', visibleRoles)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('Error fetching activity logs:', error);
        throw error;
    }

    return (data || []) as ActivityLog[];
}

// Get activity log details by ID
export async function getActivityLogById(
    id: string,
    currentUserRole: UserRole
): Promise<ActivityLog | null> {
    // Members cannot view activity logs
    if (currentUserRole === 'member') {
        return null;
    }

    const visibleRoles = getVisibleRoles(currentUserRole);

    const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('id', id)
        .in('user_role', visibleRoles)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        console.error('Error fetching activity log:', error);
        throw error;
    }

    return data as ActivityLog;
}

// Get activity logs with pagination
export async function getActivityLogsPaginated(
    currentUserRole: UserRole,
    page: number = 1,
    pageSize: number = 20
): Promise<{ logs: ActivityLog[]; total: number }> {
    // Members cannot view activity logs
    if (currentUserRole === 'member') {
        return { logs: [], total: 0 };
    }

    const visibleRoles = getVisibleRoles(currentUserRole);
    const offset = (page - 1) * pageSize;

    // Get count
    const { count, error: countError } = await supabase
        .from('activity_logs')
        .select('*', { count: 'exact', head: true })
        .in('user_role', visibleRoles);

    if (countError) {
        console.error('Error counting activity logs:', countError);
        throw countError;
    }

    // Get data
    const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .in('user_role', visibleRoles)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

    if (error) {
        console.error('Error fetching activity logs:', error);
        throw error;
    }

    return {
        logs: (data || []) as ActivityLog[],
        total: count || 0
    };
}

// Helper to format entity type for display
export function formatEntityType(entityType: string): string {
    const typeMap: Record<string, string> = {
        employee: 'Nhân viên',
        user: 'Tài khoản',
        branch: 'Chi nhánh',
        shift: 'Ca làm việc',
        attendance: 'Chấm công',
        salary: 'Lương',
        schedule: 'Lịch làm việc',
        category: 'Danh mục',
        permission: 'Phân quyền'
    };
    return typeMap[entityType] || entityType;
}

// Helper to format action for display
export function formatAction(action: ActivityAction): { label: string; icon: string; color: string } {
    const actionMap: Record<ActivityAction, { label: string; icon: string; color: string }> = {
        create: { label: 'Thêm mới', icon: '➕', color: 'text-green-600' },
        update: { label: 'Cập nhật', icon: '✏️', color: 'text-blue-600' },
        delete: { label: 'Xóa', icon: '🗑️', color: 'text-red-600' }
    };
    return actionMap[action];
}
