-- Migration: Add gender column to employees table
-- This allows storing employee gender information

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male'
CHECK (gender IN ('male', 'female', 'other'));

-- Add comment for documentation
COMMENT ON COLUMN employees.gender IS 'Employee gender: male, female, or other';
-- Migration: Add tax_id and social_insurance_id columns to employees table
-- This allows storing employee's personal tax code (MST cá nhân) and social insurance ID (mã số BHXH)

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS tax_id TEXT,
ADD COLUMN IF NOT EXISTS social_insurance_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN employees.tax_id IS 'Personal Tax ID (Mã số thuế cá nhân)';
COMMENT ON COLUMN employees.social_insurance_id IS 'Social Insurance ID (Mã số BHXH)';
-- Migration: Make email column optional (nullable) in employees table

ALTER TABLE employees
ALTER COLUMN email DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN employees.email IS 'Employee email address (optional)';
-- 1. Add new Foreign Key columns
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id);

-- 2. Migrate existing data (Department)
UPDATE employees
SET department_id = departments.id
FROM departments
WHERE employees.department = departments.name;

-- 3. Migrate existing data (Position)
UPDATE employees 
SET position_id = positions.id
FROM positions
WHERE employees.position = positions.name;

-- 4. Create index for performance
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_position_id ON employees(position_id);
-- Make email column optional (allow NULL)
ALTER TABLE employees ALTER COLUMN email DROP NOT NULL;
-- Add kpi_bonus column to monthly_salaries table to store the actual monetary value
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS kpi_bonus numeric DEFAULT 0;

-- Comment on column for clarity
COMMENT ON COLUMN monthly_salaries.kpi_bonus IS 'Actual monetary bonus received based on KPI performance, distinct from the kpi_target (goal)';-- Add tax_code and insurance_number columns to employees table
-- These columns are needed for payslip export functionality

ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax_code VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_number VARCHAR(20);

-- Add comments for clarity
COMMENT ON COLUMN employees.tax_code IS 'Mã số thuế cá nhân';
COMMENT ON COLUMN employees.insurance_number IS 'Mã số bảo hiểm xã hội';
-- Fix finalized_by column type to match users.id (VARCHAR instead of UUID)
-- The users table uses VARCHAR(20) for id, but finalized_by was incorrectly defined as UUID

ALTER TABLE monthly_salaries 
ALTER COLUMN finalized_by TYPE VARCHAR(20) USING finalized_by::VARCHAR(20);

-- Add comment for clarity
COMMENT ON COLUMN monthly_salaries.finalized_by IS 'User ID who finalized this payroll (VARCHAR to match users.id)';
-- Add standard_work_days and detailed work info to monthly_salaries
-- Date: 2026-01-04
-- Author: Assistant

ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS standard_work_days NUMERIC DEFAULT 26,
ADD COLUMN IF NOT EXISTS actual_work_days NUMERIC,
ADD COLUMN IF NOT EXISTS paid_leave_days NUMERIC;

COMMENT ON COLUMN monthly_salaries.standard_work_days IS 'Ngày công chuẩn của tháng (dùng để tính lương ngày)';
COMMENT ON COLUMN monthly_salaries.actual_work_days IS 'Ngày đi làm thực tế';
COMMENT ON COLUMN monthly_salaries.paid_leave_days IS 'Ngày nghỉ phép có lương';
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
