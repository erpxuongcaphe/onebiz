-- Migration: Add view_all permissions for granular access control
-- This adds permissions to control who can see all employees' data vs only their own

-- Admin: can view all timekeeping and all schedules
INSERT INTO permissions_template (role, permission_code) VALUES
  ('admin', 'view_all_timekeeping'),
  ('admin', 'view_all_schedules')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Accountant: can view all timekeeping (for salary calculation)
INSERT INTO permissions_template (role, permission_code) VALUES
  ('accountant', 'view_all_timekeeping')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Branch Manager: can view all timekeeping and all schedules (for their team)
INSERT INTO permissions_template (role, permission_code) VALUES
  ('branch_manager', 'view_all_timekeeping'),
  ('branch_manager', 'view_all_schedules')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Member: has view_schedules (own schedule only) - ensure it exists
INSERT INTO permissions_template (role, permission_code) VALUES
  ('member', 'view_schedules'),
  ('member', 'view_timekeeping')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Note: Members do NOT get view_all_timekeeping or view_all_schedules
-- They can only see their own records
