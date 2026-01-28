import { supabase } from '../supabaseClient';
import { UserRole } from '../database.types';

// All available permission codes - granular permissions for each action
export const ALL_PERMISSIONS = [
    // Tổng quan
    { code: 'view_dashboard', label: 'Xem Tổng quan', group: 'Tổng quan' },

    // Nhân sự
    { code: 'view_personnel', label: 'Xem danh sách nhân viên', group: 'Nhân sự' },
    { code: 'add_personnel', label: 'Thêm nhân viên mới', group: 'Nhân sự' },
    { code: 'edit_personnel', label: 'Sửa thông tin nhân viên', group: 'Nhân sự' },
    { code: 'delete_personnel', label: 'Xóa nhân viên', group: 'Nhân sự' },
    { code: 'export_personnel', label: 'Xuất dữ liệu nhân viên', group: 'Nhân sự' },

    // Chấm công
    { code: 'view_timekeeping', label: 'Xem bảng chấm công', group: 'Chấm công' },
    { code: 'view_all_timekeeping', label: 'Xem chấm công của tất cả nhân viên', group: 'Chấm công' },
    { code: 'approve_timekeeping', label: 'Duyệt chấm công', group: 'Chấm công' },
    { code: 'reject_timekeeping', label: 'Từ chối chấm công', group: 'Chấm công' },
    { code: 'manual_checkin', label: 'Chấm công thủ công', group: 'Chấm công' },
    { code: 'edit_attendance', label: 'Sửa giờ chấm công', group: 'Chấm công' },
    { code: 'export_timekeeping', label: 'Xuất bảng chấm công', group: 'Chấm công' },

    // Lịch làm việc
    { code: 'view_schedules', label: 'Xem lịch làm việc', group: 'Lịch làm việc' },
    { code: 'view_all_schedules', label: 'Xem lịch của tất cả nhân viên', group: 'Lịch làm việc' },
    { code: 'add_schedules', label: 'Tạo lịch làm việc', group: 'Lịch làm việc' },
    { code: 'edit_schedules', label: 'Sửa lịch làm việc', group: 'Lịch làm việc' },
    { code: 'delete_schedules', label: 'Xóa lịch làm việc', group: 'Lịch làm việc' },

    // Lương
    { code: 'view_salary', label: 'Xem bảng lương', group: 'Lương' },
    { code: 'edit_salary', label: 'Chỉnh sửa cấu hình lương', group: 'Lương' },
    { code: 'calculate_salary', label: 'Tính lương', group: 'Lương' },
    { code: 'export_salary', label: 'Xuất bảng lương', group: 'Lương' },

    // Chi nhánh
    { code: 'view_branches', label: 'Xem chi nhánh', group: 'Chi nhánh' },
    { code: 'add_branches', label: 'Thêm chi nhánh', group: 'Chi nhánh' },
    { code: 'edit_branches', label: 'Sửa chi nhánh', group: 'Chi nhánh' },
    { code: 'delete_branches', label: 'Xóa chi nhánh', group: 'Chi nhánh' },

    // Quản trị
    { code: 'view_users', label: 'Xem tài khoản', group: 'Quản trị' },
    { code: 'add_users', label: 'Thêm tài khoản', group: 'Quản trị' },
    { code: 'edit_users', label: 'Sửa tài khoản', group: 'Quản trị' },
    { code: 'delete_users', label: 'Xóa tài khoản', group: 'Quản trị' },
    { code: 'manage_permissions', label: 'Phân quyền chi tiết', group: 'Quản trị' },
    { code: 'view_settings', label: 'Xem cài đặt hệ thống', group: 'Quản trị' },
    { code: 'edit_settings', label: 'Sửa cài đặt hệ thống', group: 'Quản trị' },
] as const;

export type PermissionCode = typeof ALL_PERMISSIONS[number]['code'];

// Permission template record
export type PermissionTemplate = {
    id: string;
    role: string;
    permission_code: string;
    created_at: string;
};

// User permission override record
export type UserPermission = {
    id: string;
    user_id: string;
    permission_code: string;
    granted: boolean;
    assigned_by?: string;
    assigned_at: string;
};

// Get default permissions by role from template
export async function getDefaultPermissionsByRole(role: UserRole): Promise<string[]> {
    const { data, error } = await supabase
        .from('permissions_template')
        .select('permission_code')
        .eq('role', role);

    if (error) {
        console.error('Error fetching permission template:', error);
        return [];
    }

    return ((data || []) as { permission_code: string }[]).map(p => p.permission_code);
}

// Get user's specific permission overrides
export async function getUserPermissionOverrides(userId: string): Promise<UserPermission[]> {
    const { data, error } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', userId);

    if (error) {
        console.error('Error fetching user permissions:', error);
        return [];
    }

    return (data || []) as UserPermission[];
}

// Get effective permissions for a user (merge role template + overrides)
export async function getEffectivePermissions(userId: string, role: UserRole): Promise<string[]> {
    // Get role template
    const templatePermissions = await getDefaultPermissionsByRole(role);

    // Get user overrides
    const overrides = await getUserPermissionOverrides(userId);

    // Build effective permissions set
    const effectiveSet = new Set(templatePermissions);

    for (const override of overrides) {
        if (override.granted) {
            effectiveSet.add(override.permission_code);
        } else {
            effectiveSet.delete(override.permission_code);
        }
    }

    return Array.from(effectiveSet);
}

// Set a specific permission for a user (override)
export async function setUserPermission(
    userId: string,
    permissionCode: string,
    granted: boolean,
    assignedBy: string
): Promise<void> {
    const { error } = await supabase
        .from('user_permissions')
        .upsert({
            user_id: userId,
            permission_code: permissionCode,
            granted,
            assigned_by: assignedBy,
            assigned_at: new Date().toISOString()
        } as never, {
            onConflict: 'user_id,permission_code'
        });

    if (error) {
        console.error('Error setting user permission:', error);
        throw error;
    }
}

// Remove a specific permission override (revert to role default)
export async function removeUserPermissionOverride(
    userId: string,
    permissionCode: string
): Promise<void> {
    const { error } = await supabase
        .from('user_permissions')
        .delete()
        .eq('user_id', userId)
        .eq('permission_code', permissionCode);

    if (error) {
        console.error('Error removing permission override:', error);
        throw error;
    }
}

// Reset all permission overrides for a user (revert to role defaults)
export async function resetUserPermissions(userId: string): Promise<void> {
    const { error } = await supabase
        .from('user_permissions')
        .delete()
        .eq('user_id', userId);

    if (error) {
        console.error('Error resetting user permissions:', error);
        throw error;
    }
}

// Bulk update user permissions
export async function bulkUpdateUserPermissions(
    userId: string,
    permissions: { code: string; granted: boolean | null }[], // null = remove override
    assignedBy: string
): Promise<void> {
    for (const perm of permissions) {
        if (perm.granted === null) {
            await removeUserPermissionOverride(userId, perm.code);
        } else {
            await setUserPermission(userId, perm.code, perm.granted, assignedBy);
        }
    }
}
