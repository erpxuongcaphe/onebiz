-- Salary Configuration Table
-- Store configurations for different pay types (hourly/monthly)

CREATE TABLE IF NOT EXISTS salary_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pay_type VARCHAR(20) NOT NULL CHECK (pay_type IN ('hourly', 'monthly')),
    config_key VARCHAR(100) NOT NULL,
    config_value TEXT,
    description VARCHAR(255),
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(pay_type, config_key)
);

-- Insert default configurations for Monthly employees
INSERT INTO salary_configs (pay_type, config_key, config_value, description, sort_order) VALUES
    ('monthly', 'base_salary', '0', 'Lương cơ bản (VND/tháng)', 1),
    ('monthly', 'lunch_allowance', '30000', 'Hỗ trợ cơm trưa (VND/ngày đủ công)', 2),
    ('monthly', 'transport_allowance', '0', 'Hỗ trợ xăng xe (VND/tháng)', 3),
    ('monthly', 'phone_allowance', '0', 'Hỗ trợ điện thoại (VND/tháng)', 4),
    ('monthly', 'other_allowance', '0', 'Hỗ trợ khác (VND/tháng)', 5),
    ('monthly', 'kpi_bonus', '0', 'Thưởng KPI (VND/tháng, nhập tay)', 6),
    ('monthly', 'has_insurance', '1', 'Có đóng BHXH (1=Có, 0=Không)', 9),
    ('monthly', 'bhxh_percent', '8', 'BHXH (% lương đóng BH)', 10),
    ('monthly', 'bhyt_percent', '1.5', 'BHYT (% lương đóng BH)', 11),
    ('monthly', 'bhtn_percent', '1', 'BHTN (% lương đóng BH)', 12),
    ('monthly', 'dependents_count', '0', 'Số người phụ thuộc (cho thuế TNCN)', 13),
    ('monthly', 'min_hours_for_lunch', '7', 'Số giờ tối thiểu để tính hỗ trợ cơm', 14)
ON CONFLICT (pay_type, config_key) DO NOTHING;

-- Insert default configurations for Hourly employees  
INSERT INTO salary_configs (pay_type, config_key, config_value, description, sort_order) VALUES
    ('hourly', 'hourly_rate', '0', 'Mức lương giờ cơ bản (VND/giờ)', 1),
    ('hourly', 'ot_rate_weekday', '1.5', 'Hệ số OT ngày thường', 2),
    ('hourly', 'ot_rate_weekend', '2', 'Hệ số OT cuối tuần', 3),
    ('hourly', 'ot_rate_holiday', '3', 'Hệ số OT ngày lễ', 4),
    ('hourly', 'night_shift_allowance', '0', 'Hỗ trợ ca đêm (VND/ca)', 5),
    ('hourly', 'attendance_bonus', '0', 'Thưởng chuyên cần (VND/tháng)', 6),
    ('hourly', 'has_insurance', '0', 'Có đóng BHXH (1=Có, 0=Không)', 9),
    ('hourly', 'bhxh_percent', '8', 'BHXH (% lương đóng BH)', 10),
    ('hourly', 'bhyt_percent', '1.5', 'BHYT (% lương đóng BH)', 11),
    ('hourly', 'bhtn_percent', '1', 'BHTN (% lương đóng BH)', 12)
ON CONFLICT (pay_type, config_key) DO NOTHING;

-- Enable RLS
ALTER TABLE salary_configs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Everyone can read
DROP POLICY IF EXISTS "salary_configs_read_all" ON salary_configs;
CREATE POLICY "salary_configs_read_all" ON salary_configs
    FOR SELECT USING (true);

-- Admin/Accountant can insert/update/delete
DROP POLICY IF EXISTS "salary_configs_admin_manage" ON salary_configs;

DROP POLICY IF EXISTS "salary_configs_insert" ON salary_configs;
CREATE POLICY "salary_configs_insert" ON salary_configs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid()::text 
            AND users.role IN ('admin', 'accountant')
        )
    );

DROP POLICY IF EXISTS "salary_configs_update" ON salary_configs;
CREATE POLICY "salary_configs_update" ON salary_configs
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid()::text 
            AND users.role IN ('admin', 'accountant')
        )
    );

DROP POLICY IF EXISTS "salary_configs_delete" ON salary_configs;
CREATE POLICY "salary_configs_delete" ON salary_configs
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid()::text 
            AND users.role IN ('admin', 'accountant')
        )
    );

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_salary_configs_pay_type ON salary_configs(pay_type);
-- Fix RLS policies for salary_configs
-- The previous policies relied on auth.uid() which is not set in the current custom auth implementation
-- We will relax the policies to allow the application to function until full Auth migration

-- Drop strict policies
DROP POLICY IF EXISTS "salary_configs_admin_manage" ON salary_configs;
DROP POLICY IF EXISTS "salary_configs_insert" ON salary_configs;
DROP POLICY IF EXISTS "salary_configs_update" ON salary_configs;
DROP POLICY IF EXISTS "salary_configs_delete" ON salary_configs;

-- Create permissive policies (matching the current application security model)
-- Enable full access for all operations
CREATE POLICY "salary_configs_full_access" ON salary_configs
    FOR ALL
    USING (true)
    WITH CHECK (true);
-- Add salary details to employees table
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS kpi_target BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lunch_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS transport_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS phone_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS other_allowance BIGINT DEFAULT 0;

-- Comment on columns
COMMENT ON COLUMN employees.kpi_target IS 'Mục tiêu KPI (VND)';
COMMENT ON COLUMN employees.lunch_allowance IS 'Hỗ trợ cơm trưa (VND/ngày)';
COMMENT ON COLUMN employees.transport_allowance IS 'Hỗ trợ xăng xe (VND/tháng)';
COMMENT ON COLUMN employees.phone_allowance IS 'Hỗ trợ điện thoại (VND/tháng)';
COMMENT ON COLUMN employees.other_allowance IS 'Hỗ trợ khác (VND/tháng)';
-- Monthly Salaries Table
-- Stores editable salary data for each employee per month

CREATE TABLE IF NOT EXISTS monthly_salaries (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL, -- YYYY-MM format
    
    -- Base salary (can override employee's default)
    base_salary BIGINT,
    hourly_rate BIGINT,
    hours_worked DECIMAL(5,2) DEFAULT 0,
    
    -- Allowances (editable)
    lunch_allowance BIGINT DEFAULT 0,
    transport_allowance BIGINT DEFAULT 0,
    phone_allowance BIGINT DEFAULT 0,
    other_allowance BIGINT DEFAULT 0,
    
    -- KPI
    kpi_target BIGINT DEFAULT 0,
    kpi_percent INT DEFAULT 100,
    
    -- Bonuses / Penalties
    bonus BIGINT DEFAULT 0,
    penalty BIGINT DEFAULT 0,
    bonus_note TEXT,
    
    -- Deductions (can override calculated values)
    insurance_deduction BIGINT,
    pit_deduction BIGINT,
    
    -- Calculated totals (stored for reporting)
    gross_salary BIGINT DEFAULT 0,
    net_salary BIGINT DEFAULT 0,
    
    -- Status
    is_finalized BOOLEAN DEFAULT false,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(employee_id, month)
);

-- Enable RLS
ALTER TABLE monthly_salaries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "monthly_salaries_read" ON monthly_salaries;
CREATE POLICY "monthly_salaries_read" ON monthly_salaries
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "monthly_salaries_all" ON monthly_salaries;
CREATE POLICY "monthly_salaries_all" ON monthly_salaries
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_employee_month ON monthly_salaries(employee_id, month);
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_month ON monthly_salaries(month);
-- Granular Permission System
-- Tables for managing fine-grained user permissions

-- Permission template by role (default permissions for each role)
CREATE TABLE IF NOT EXISTS permissions_template (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role, permission_code)
);

-- User-specific permission overrides
CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL,
  granted BOOLEAN DEFAULT true,
  assigned_by TEXT REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, permission_code)
);

-- Enable RLS
ALTER TABLE permissions_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only admins can manage permissions
CREATE POLICY "Admins can read permission templates" ON permissions_template
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage permission templates" ON permissions_template
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND role = 'admin')
  );

CREATE POLICY "Users can read own permissions" ON user_permissions
  FOR SELECT USING (user_id = auth.uid()::text OR 
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND role = 'admin'));

CREATE POLICY "Admins can manage user permissions" ON user_permissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid()::text AND role = 'admin')
  );

-- Seed default permissions for Admin (full access)
INSERT INTO permissions_template (role, permission_code) VALUES
  ('admin', 'view_dashboard'),
  ('admin', 'view_personnel'),
  ('admin', 'manage_personnel'),
  ('admin', 'view_timekeeping'),
  ('admin', 'manage_timekeeping'),
  ('admin', 'manual_checkin'),
  ('admin', 'view_schedules'),
  ('admin', 'manage_schedules'),
  ('admin', 'view_salary'),
  ('admin', 'manage_salary'),
  ('admin', 'view_branches'),
  ('admin', 'manage_branches'),
  ('admin', 'view_users'),
  ('admin', 'manage_users'),
  ('admin', 'manage_permissions'),
  ('admin', 'view_settings'),
  ('admin', 'manage_settings')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Seed default permissions for Accountant
INSERT INTO permissions_template (role, permission_code) VALUES
  ('accountant', 'view_dashboard'),
  ('accountant', 'view_personnel'),
  ('accountant', 'view_timekeeping'),
  ('accountant', 'manage_timekeeping'),
  ('accountant', 'view_schedules'),
  ('accountant', 'view_salary'),
  ('accountant', 'manage_salary')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Seed default permissions for Branch Manager
INSERT INTO permissions_template (role, permission_code) VALUES
  ('branch_manager', 'view_dashboard'),
  ('branch_manager', 'view_personnel'),
  ('branch_manager', 'manage_personnel'),
  ('branch_manager', 'view_timekeeping'),
  ('branch_manager', 'manage_timekeeping'),
  ('branch_manager', 'manual_checkin'),
  ('branch_manager', 'view_schedules'),
  ('branch_manager', 'manage_schedules'),
  ('branch_manager', 'view_branches')
ON CONFLICT (role, permission_code) DO NOTHING;

-- Seed default permissions for Member (basic access)
INSERT INTO permissions_template (role, permission_code) VALUES
  ('member', 'view_dashboard'),
  ('member', 'view_schedules')
ON CONFLICT (role, permission_code) DO NOTHING;
-- Create system_configs table
create table if not exists public.system_configs (
    key text primary key,
    value jsonb not null,
    description text,
    group_name text, -- 'payroll', 'system', 'attendance'
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_by uuid references auth.users(id)
);

-- Enable RLS
alter table public.system_configs enable row level security;

-- Policies
create policy "Enable read access for all authenticated users" on public.system_configs
    for select
    using (auth.role() = 'authenticated');

create policy "Enable write access for admins and accountants" on public.system_configs
    for all
    using (
        exists (
            select 1 from public.users
            where users.id = auth.uid()::text
            and users.role in ('admin', 'accountant')
        )
    );

-- Seed Data for Payroll
insert into public.system_configs (key, value, description, group_name)
values 
    ('payroll.tax.personal_deduction', '11000000', 'Mức giảm trừ gia cảnh bản thân (VND)', 'payroll'),
    ('payroll.tax.dependent_deduction', '4400000', 'Mức giảm trừ người phụ thuộc (VND)', 'payroll'),
    ('payroll.insurance.employee_rate', '0.105', 'Tỷ lệ đóng BHXH người lao động (10.5%)', 'payroll'),
    ('payroll.insurance.employer_rate', '0.215', 'Tỷ lệ đóng BHXH người sử dụng lao động (21.5%)', 'payroll'),
    ('payroll.ot.weekday_multiplier', '1.5', 'Hệ số lương OT ngày thường', 'payroll'),
    ('payroll.ot.weekend_multiplier', '2.0', 'Hệ số lương OT ngày cuối tuần', 'payroll'),
    ('payroll.ot.holiday_multiplier', '3.0', 'Hệ số lương OT ngày lễ', 'payroll')
on conflict (key) do update 
set value = excluded.value, description = excluded.description;
-- Fix RLS policies for user_permissions table
-- The app uses custom authentication, not Supabase Auth, so auth.uid() won't work

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins can manage permission templates" ON permissions_template;
DROP POLICY IF EXISTS "Users can read own permissions" ON user_permissions;
DROP POLICY IF EXISTS "Admins can manage user permissions" ON user_permissions;

-- Create permissive policies (access control is handled at app level)
CREATE POLICY "Allow all access to permissions_template" ON permissions_template FOR ALL USING (true);
CREATE POLICY "Allow all access to user_permissions" ON user_permissions FOR ALL USING (true);
-- Shift Registration System
-- Allow hourly employees to register for shifts each week

-- Main registrations table
CREATE TABLE IF NOT EXISTS shift_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_id UUID REFERENCES shifts(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by TEXT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  week_start DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, branch_id, shift_date, shift_id)
);

-- Registration window settings per branch
CREATE TABLE IF NOT EXISTS registration_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  registration_start_day INT DEFAULT 4 CHECK (registration_start_day BETWEEN 0 AND 6),
  registration_start_hour INT DEFAULT 21 CHECK (registration_start_hour BETWEEN 0 AND 23),
  registration_end_day INT DEFAULT 5 CHECK (registration_end_day BETWEEN 0 AND 6),
  registration_end_hour INT DEFAULT 21 CHECK (registration_end_hour BETWEEN 0 AND 23),
  weeks_ahead INT DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(branch_id)
);

-- Enable RLS
ALTER TABLE shift_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_settings ENABLE ROW LEVEL SECURITY;

-- Permissive policies (app-level access control)
CREATE POLICY "Allow all access to shift_registrations" ON shift_registrations FOR ALL USING (true);
CREATE POLICY "Allow all access to registration_settings" ON registration_settings FOR ALL USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shift_registrations_employee ON shift_registrations(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_registrations_branch ON shift_registrations(branch_id);
CREATE INDEX IF NOT EXISTS idx_shift_registrations_week ON shift_registrations(week_start);
CREATE INDEX IF NOT EXISTS idx_shift_registrations_status ON shift_registrations(status);

-- Insert default global settings (null branch_id = default for all)
INSERT INTO registration_settings (branch_id, registration_start_day, registration_start_hour, registration_end_day, registration_end_hour, weeks_ahead)
VALUES (NULL, 4, 21, 5, 21, 1)
ON CONFLICT DO NOTHING;
-- Add is_closed column to registration_settings
-- This allows managers to manually close registration early

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT false;

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS closed_by TEXT;
-- ============================================
-- ACTIVITY LOGS TABLE
-- Lịch sử thao tác trên hệ thống
-- ============================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,        -- Ai thực hiện
    user_name VARCHAR(100),              -- Tên người thực hiện
    user_role VARCHAR(20),               -- Role của người thực hiện
    action VARCHAR(20) NOT NULL,         -- create, update, delete
    entity_type VARCHAR(50) NOT NULL,    -- employee, user, branch, shift, attendance, etc.
    entity_id VARCHAR(100),              -- ID của đối tượng
    entity_name VARCHAR(200),            -- Tên/label của đối tượng
    details JSONB,                       -- Chi tiết thay đổi (old/new values)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS policy - all access (filtering done at application layer)
DROP POLICY IF EXISTS "Enable all access for activity_logs" ON activity_logs;
CREATE POLICY "Enable all access for activity_logs" ON activity_logs FOR ALL USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity_type ON activity_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_role ON activity_logs(user_role);

-- Comments
COMMENT ON TABLE activity_logs IS 'Lịch sử thao tác trên hệ thống';
COMMENT ON COLUMN activity_logs.action IS 'Loại thao tác: create, update, delete';
COMMENT ON COLUMN activity_logs.entity_type IS 'Loại đối tượng: employee, user, branch, shift, attendance, salary...';
COMMENT ON COLUMN activity_logs.details IS 'Chi tiết thay đổi dạng JSON';
-- Payslip System Enhancement
-- 1. Payslip templates for each branch
-- 2. Additional fields for monthly_salaries

-- ==========================================
-- 1. PAYSLIP TEMPLATES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS payslip_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    
    -- Company Information
    company_name TEXT NOT NULL,
    company_address TEXT,
    company_phone TEXT,
    company_email TEXT,
    company_tax_code TEXT,
    logo_url TEXT,
    
    -- Custom text
    header_text TEXT,
    footer_text TEXT,
    
    -- Settings
    is_default BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One template per branch max
    UNIQUE(branch_id)
);

-- Enable RLS
ALTER TABLE payslip_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "payslip_templates_read" ON payslip_templates;
CREATE POLICY "payslip_templates_read" ON payslip_templates
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "payslip_templates_all" ON payslip_templates;
CREATE POLICY "payslip_templates_all" ON payslip_templates
    FOR ALL USING (true) WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_payslip_templates_branch ON payslip_templates(branch_id);

-- ==========================================
-- 2. ADD COLUMNS TO MONTHLY_SALARIES
-- ==========================================

-- Work time details
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS work_days INT DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS regular_hours DECIMAL(6,2) DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS ot_hours DECIMAL(6,2) DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS late_count INT DEFAULT 0;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS early_leave_count INT DEFAULT 0;

-- Finalization info
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS finalized_by UUID;

-- Branch reference for template lookup
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- Index for finalized lookup
CREATE INDEX IF NOT EXISTS idx_monthly_salaries_finalized ON monthly_salaries(is_finalized, month);

-- ==========================================
-- 3. DEFAULT TEMPLATE (if no branch-specific)
-- ==========================================
INSERT INTO payslip_templates (branch_id, company_name, company_address, is_default)
VALUES (NULL, 'Công ty TNHH HRM', 'Địa chỉ công ty', true)
ON CONFLICT DO NOTHING;
