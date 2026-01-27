-- Migration: Sync permission codes with application code
-- This migration updates permissions_template to match ALL_PERMISSIONS in lib/api/user-permissions.ts

-- First, clear old permission codes that don't match the new granular system
DELETE FROM permissions_template WHERE permission_code IN (
    'manage_personnel',
    'manage_timekeeping',
    'manage_schedules',
    'manage_salary',
    'manage_branches',
    'manage_users',
    'manage_settings'
);

-- =============================================
-- ADMIN: Full access to all permissions
-- =============================================
INSERT INTO permissions_template (role, permission_code) VALUES
    -- Tổng quan
    ('admin', 'view_dashboard'),

    -- Nhân sự
    ('admin', 'view_personnel'),
    ('admin', 'add_personnel'),
    ('admin', 'edit_personnel'),
    ('admin', 'delete_personnel'),
    ('admin', 'export_personnel'),

    -- Chấm công
    ('admin', 'view_timekeeping'),
    ('admin', 'view_all_timekeeping'),
    ('admin', 'approve_timekeeping'),
    ('admin', 'reject_timekeeping'),
    ('admin', 'manual_checkin'),
    ('admin', 'edit_attendance'),
    ('admin', 'export_timekeeping'),

    -- Lịch làm việc
    ('admin', 'view_schedules'),
    ('admin', 'view_all_schedules'),
    ('admin', 'add_schedules'),
    ('admin', 'edit_schedules'),
    ('admin', 'delete_schedules'),

    -- Lương
    ('admin', 'view_salary'),
    ('admin', 'edit_salary'),
    ('admin', 'calculate_salary'),
    ('admin', 'export_salary'),

    -- Chi nhánh
    ('admin', 'view_branches'),
    ('admin', 'add_branches'),
    ('admin', 'edit_branches'),
    ('admin', 'delete_branches'),

    -- Quản trị
    ('admin', 'view_users'),
    ('admin', 'add_users'),
    ('admin', 'edit_users'),
    ('admin', 'delete_users'),
    ('admin', 'manage_permissions'),
    ('admin', 'view_settings'),
    ('admin', 'edit_settings')
ON CONFLICT (role, permission_code) DO NOTHING;

-- =============================================
-- BRANCH_MANAGER: Manage their branch team
-- =============================================
INSERT INTO permissions_template (role, permission_code) VALUES
    -- Tổng quan
    ('branch_manager', 'view_dashboard'),

    -- Nhân sự
    ('branch_manager', 'view_personnel'),
    ('branch_manager', 'add_personnel'),
    ('branch_manager', 'edit_personnel'),

    -- Chấm công
    ('branch_manager', 'view_timekeeping'),
    ('branch_manager', 'view_all_timekeeping'),
    ('branch_manager', 'approve_timekeeping'),
    ('branch_manager', 'reject_timekeeping'),
    ('branch_manager', 'manual_checkin'),
    ('branch_manager', 'edit_attendance'),

    -- Lịch làm việc
    ('branch_manager', 'view_schedules'),
    ('branch_manager', 'view_all_schedules'),
    ('branch_manager', 'add_schedules'),
    ('branch_manager', 'edit_schedules'),
    ('branch_manager', 'delete_schedules'),

    -- Chi nhánh (chỉ xem)
    ('branch_manager', 'view_branches')
ON CONFLICT (role, permission_code) DO NOTHING;

-- =============================================
-- ACCOUNTANT: View and manage salary/timekeeping
-- =============================================
INSERT INTO permissions_template (role, permission_code) VALUES
    -- Tổng quan
    ('accountant', 'view_dashboard'),

    -- Nhân sự (chỉ xem)
    ('accountant', 'view_personnel'),

    -- Chấm công
    ('accountant', 'view_timekeeping'),
    ('accountant', 'view_all_timekeeping'),
    ('accountant', 'approve_timekeeping'),
    ('accountant', 'export_timekeeping'),

    -- Lịch làm việc (chỉ xem)
    ('accountant', 'view_schedules'),
    ('accountant', 'view_all_schedules'),

    -- Lương (full access)
    ('accountant', 'view_salary'),
    ('accountant', 'edit_salary'),
    ('accountant', 'calculate_salary'),
    ('accountant', 'export_salary')
ON CONFLICT (role, permission_code) DO NOTHING;

-- =============================================
-- MEMBER: Basic access (view own data only)
-- =============================================
INSERT INTO permissions_template (role, permission_code) VALUES
    -- Tổng quan
    ('member', 'view_dashboard'),

    -- Lịch làm việc (chỉ của mình)
    ('member', 'view_schedules'),

    -- Chấm công (chỉ của mình)
    ('member', 'view_timekeeping')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Note: Members do NOT get view_all_timekeeping or view_all_schedules
-- They can only see their own records (filtered at app level)
