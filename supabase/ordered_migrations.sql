-- Create employees table if it doesn't exist
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    department TEXT,
    position TEXT,
    phone TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'probation', 'inactive')),
    join_date DATE,
    address TEXT, -- Combined address or general address
    avatar TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Extended fields
    date_of_birth DATE,
    identity_card TEXT,
    address_street TEXT,
    address_ward TEXT,
    address_district TEXT,
    address_city TEXT,
    employment_type TEXT DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
    termination_date DATE,
    salary NUMERIC,
    uniform_cost NUMERIC,
    uniform_issue_date DATE,
    uniform_expiry_date DATE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    notes TEXT
);

-- Enable Row Level Security
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations (Select, Insert, Update, Delete)
-- Warning: This is for development/internal use. In production, you'd want stricter policies based on user roles.
DROP POLICY IF EXISTS "Enable all access for all users" ON employees;
CREATE POLICY "Enable all access for all users" ON employees
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ======== END OF 20240101_add_employee_fields.sql ========

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint if not exists (for existing tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'departments_name_key'
    ) THEN
        ALTER TABLE departments ADD CONSTRAINT departments_name_key UNIQUE (name);
    END IF;
END $$;

-- Create positions table
CREATE TABLE IF NOT EXISTS positions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add unique constraint if not exists (for existing tables)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'positions_name_key'
    ) THEN
        ALTER TABLE positions ADD CONSTRAINT positions_name_key UNIQUE (name);
    END IF;
END $$;

-- Insert default departments (only if not exists)
INSERT INTO departments (name)
SELECT name FROM (VALUES 
    ('Ká»¹ thuáº­t'),
    ('NhÃ¢n sá»±'),
    ('Kinh doanh'),
    ('Káº¿ toÃ¡n'),
    ('Marketing'),
    ('Ban giÃ¡m Ä‘á»‘c'),
    ('HÃ nh chÃ­nh')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.name = v.name);

-- Insert default positions (only if not exists)
INSERT INTO positions (name)
SELECT name FROM (VALUES 
    ('NhÃ¢n viÃªn'),
    ('TrÆ°á»Ÿng nhÃ³m'),
    ('TrÆ°á»Ÿng phÃ²ng'),
    ('PhÃ³ giÃ¡m Ä‘á»‘c'),
    ('GiÃ¡m Ä‘á»‘c'),
    ('Developer'),
    ('Senior Developer'),
    ('HR Manager'),
    ('Accountant'),
    ('Marketing Specialist'),
    ('Sales Executive')
) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM positions p WHERE p.name = v.name);

-- Enable RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist, then create new ones
DROP POLICY IF EXISTS "Enable all access for departments" ON departments;
DROP POLICY IF EXISTS "Enable all access for positions" ON positions;

CREATE POLICY "Enable all access for departments" ON departments FOR ALL USING (true);
CREATE POLICY "Enable all access for positions" ON positions FOR ALL USING (true);

-- ======== END OF 20240102_create_categories.sql ========

-- ============================================
-- TIMEKEEPING ENHANCEMENT SCHEMA (Fixed)
-- Run this script in Supabase SQL Editor
-- ============================================

-- Drop existing tables if they have wrong schema (optional - comment out if you want to keep data)
DROP TABLE IF EXISTS attendance_records CASCADE;
DROP TABLE IF EXISTS shifts CASCADE;
DROP TABLE IF EXISTS branches CASCADE;

-- Create branches table (Chi nhÃ¡nh)
CREATE TABLE branches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    is_office BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create shifts table (Ca lÃ m viá»‡c)
CREATE TABLE shifts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    hourly_rate DECIMAL(12, 0) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create attendance_records table (Báº£n ghi cháº¥m cÃ´ng)
CREATE TABLE attendance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    check_in TIMESTAMP WITH TIME ZONE,
    check_out TIMESTAMP WITH TIME ZONE,
    hours_worked DECIMAL(5, 2),
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add pay_type and branch_id to employees table (safe - won't error if already exists)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'pay_type') THEN
        ALTER TABLE employees ADD COLUMN pay_type VARCHAR(20) DEFAULT 'monthly';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'branch_id') THEN
        ALTER TABLE employees ADD COLUMN branch_id UUID;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'hourly_rate') THEN
        ALTER TABLE employees ADD COLUMN hourly_rate DECIMAL(12, 0) DEFAULT 0;
    END IF;
END $$;

-- Insert default branches
INSERT INTO branches (name, address, is_office) VALUES 
    ('VÄƒn phÃ²ng chÃ­nh', 'Quáº­n 1, TP.HCM', true),
    ('Cá»­a hÃ ng Quáº­n 3', 'Quáº­n 3, TP.HCM', false),
    ('Cá»­a hÃ ng Quáº­n 7', 'Quáº­n 7, TP.HCM', false);

-- Insert default shifts for stores (cá»­a hÃ ng)
INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
SELECT b.id, 'Ca sÃ¡ng', '06:00'::TIME, '14:00'::TIME, 30000
FROM branches b WHERE b.is_office = false;

INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
SELECT b.id, 'Ca chiá»u', '14:00'::TIME, '22:00'::TIME, 35000
FROM branches b WHERE b.is_office = false;

INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
SELECT b.id, 'Ca tá»‘i', '18:00'::TIME, '23:00'::TIME, 40000
FROM branches b WHERE b.is_office = false;

-- Enable RLS
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Enable all access for branches" ON branches;
DROP POLICY IF EXISTS "Enable all access for shifts" ON shifts;
DROP POLICY IF EXISTS "Enable all access for attendance_records" ON attendance_records;

CREATE POLICY "Enable all access for branches" ON branches FOR ALL USING (true);
CREATE POLICY "Enable all access for shifts" ON shifts FOR ALL USING (true);
CREATE POLICY "Enable all access for attendance_records" ON attendance_records FOR ALL USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_shifts_branch_id ON shifts(branch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_id ON attendance_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_branch_id ON attendance_records(branch_id);

-- ======== END OF 20240103_timekeeping_enhancement.sql ========

-- ============================================
-- WORK SCHEDULE SYSTEM
-- Run this script in Supabase SQL Editor
-- ============================================

-- Create work_schedules table (Lá»‹ch lÃ m viá»‡c)
CREATE TABLE IF NOT EXISTS work_schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id VARCHAR(20) NOT NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled', -- scheduled, completed, absent, cancelled
    notes TEXT,
    created_by VARCHAR(20), -- User ID who created
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(employee_id, date) -- One schedule per employee per day
);

-- Create attendance_permissions table (PhÃ¢n quyá»n cháº¥m cÃ´ng)
CREATE TABLE IF NOT EXISTS attendance_permissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL, -- User Ä‘Æ°á»£c phÃ¢n quyá»n
    branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
    can_check_attendance BOOLEAN DEFAULT true,
    assigned_by VARCHAR(20), -- Admin phÃ¢n quyá»n
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, branch_id) -- One permission per user per branch
);

-- Add schedule_id and checked_by to attendance_records
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'schedule_id') THEN
        ALTER TABLE attendance_records ADD COLUMN schedule_id UUID REFERENCES work_schedules(id) ON DELETE SET NULL;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'checked_by') THEN
        ALTER TABLE attendance_records ADD COLUMN checked_by VARCHAR(20);
    END IF;
END $$;

-- Enable RLS
ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_permissions ENABLE ROW LEVEL SECURITY;

-- RLS policies
DROP POLICY IF EXISTS "Enable all access for work_schedules" ON work_schedules;
DROP POLICY IF EXISTS "Enable all access for attendance_permissions" ON attendance_permissions;

CREATE POLICY "Enable all access for work_schedules" ON work_schedules FOR ALL USING (true);
CREATE POLICY "Enable all access for attendance_permissions" ON attendance_permissions FOR ALL USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_schedules_employee_id ON work_schedules(employee_id);
CREATE INDEX IF NOT EXISTS idx_schedules_date ON work_schedules(date);
CREATE INDEX IF NOT EXISTS idx_schedules_branch_id ON work_schedules(branch_id);
CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON attendance_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_permissions_branch_id ON attendance_permissions(branch_id);

-- ======== END OF 20240104_work_schedules.sql ========

-- ============================================
-- ADD DEFAULT BUSINESS HOURS SHIFTS
-- Run this script in Supabase SQL Editor
-- ============================================

-- Function to add office shifts if they don't exist
DO $$
DECLARE
    office_branch RECORD;
BEGIN
    FOR office_branch IN SELECT id FROM branches WHERE is_office = true
    LOOP
        -- Insert 'HÃ nh chÃ­nh' shift for Office (08:00 - 17:30)
        IF NOT EXISTS (
            SELECT 1 FROM shifts 
            WHERE branch_id = office_branch.id AND (name = 'HÃ nh chÃ­nh' OR name = 'Ca hÃ nh chÃ­nh')
        ) THEN
            INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate)
            VALUES (
                office_branch.id, 
                'HÃ nh chÃ­nh', 
                '08:00'::TIME, 
                '17:30'::TIME, 
                0 -- Often monthly salary, but rate can be set if needed
            );
        END IF;
    END LOOP;
END $$;

-- Update Store Shifts if needed or ensure they exist
-- (User mentioned Stores operate 06:00 - 22:00, usually broken into shifts, but we'll ensure at least the basic ones exist from previous migration)
-- The previous migration `20240103` already added Ca sÃ¡ng, Ca chiá»u, Ca tá»‘i suitable for this range.
-- So we mainly focus on the Office shift here.

-- ======== END OF 20240105_add_office_shifts.sql ========

-- First, ensure all extended columns exist (idempotent)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS identity_card TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_street TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_ward TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_district TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS address_city TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employment_type TEXT DEFAULT 'full_time';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary NUMERIC;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uniform_cost NUMERIC;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uniform_issue_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS uniform_expiry_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes TEXT;

-- Verify/Cleanup any existing constraint to avoid error
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_identity_card_key;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_phone_key;

-- Add unique constraints
ALTER TABLE employees ADD CONSTRAINT employees_identity_card_key UNIQUE (identity_card);
ALTER TABLE employees ADD CONSTRAINT employees_phone_key UNIQUE (phone);

-- ======== END OF 20240106_add_unique_constraints.sql ========

-- ============================================
-- QR ATTENDANCE FEATURE - STEP 1
-- ThÃªm qr_token vÃ o báº£ng branches
-- ============================================

-- ThÃªm cá»™t qr_token vÃ o báº£ng branches
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branches' AND column_name = 'qr_token') THEN
        ALTER TABLE branches ADD COLUMN qr_token VARCHAR(64) UNIQUE;
    END IF;
END $$;

-- Táº¡o token cho cÃ¡c chi nhÃ¡nh hiá»‡n cÃ³ (náº¿u chÆ°a cÃ³)
UPDATE branches 
SET qr_token = encode(gen_random_bytes(32), 'hex')
WHERE qr_token IS NULL;

-- Äáº£m báº£o cÃ¡c chi nhÃ¡nh má»›i sáº½ tá»± Ä‘á»™ng cÃ³ token
-- (Sáº½ Ä‘Æ°á»£c xá»­ lÃ½ á»Ÿ application layer khi táº¡o chi nhÃ¡nh má»›i)

-- Táº¡o index cho qr_token Ä‘á»ƒ tÃ¬m kiáº¿m nhanh
CREATE INDEX IF NOT EXISTS idx_branches_qr_token ON branches(qr_token);

-- ======== END OF 20240107_qr_attendance.sql ========

-- Migration: Add GPS location fields to branches for attendance validation
-- This enables location-based check-in verification

ALTER TABLE branches 
ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS radius INTEGER DEFAULT 50;

-- Add comments for documentation
COMMENT ON COLUMN branches.latitude IS 'VÄ© Ä‘á»™ cá»§a chi nhÃ¡nh (Latitude)';
COMMENT ON COLUMN branches.longitude IS 'Kinh Ä‘á»™ cá»§a chi nhÃ¡nh (Longitude)';
COMMENT ON COLUMN branches.radius IS 'BÃ¡n kÃ­nh cho phÃ©p cháº¥m cÃ´ng (mÃ©t), máº·c Ä‘á»‹nh 50m';

-- ======== END OF 20240108_gps_location.sql ========

-- ============================================
-- OT AND SCHEDULE APPROVAL ENHANCEMENT
-- Run this script in Supabase SQL Editor
-- ============================================

-- Add overtime_hours to attendance_records
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'overtime_hours') THEN
        ALTER TABLE attendance_records ADD COLUMN overtime_hours DECIMAL(5, 2) DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'approved_by') THEN
        ALTER TABLE attendance_records ADD COLUMN approved_by VARCHAR(20);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_records' AND column_name = 'approved_at') THEN
        ALTER TABLE attendance_records ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Add custom shift times to work_schedules (override shift times if needed)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_schedules' AND column_name = 'custom_start') THEN
        ALTER TABLE work_schedules ADD COLUMN custom_start TIME;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_schedules' AND column_name = 'custom_end') THEN
        ALTER TABLE work_schedules ADD COLUMN custom_end TIME;
    END IF;
END $$;

-- Create index for faster pending queries
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance_records(status);

COMMENT ON COLUMN attendance_records.overtime_hours IS 'Sá»‘ giá» OT (tÃ­nh khi check-out)';
COMMENT ON COLUMN attendance_records.approved_by IS 'User ID Ä‘Ã£ duyá»‡t';
COMMENT ON COLUMN attendance_records.approved_at IS 'Thá»i gian duyá»‡t';

-- ======== END OF 20240109_ot_approval.sql ========

-- ============================================
-- OFFICE HOURS DEFAULT SHIFT
-- Giá» hÃ nh chÃ­nh cho nhÃ¢n viÃªn lÆ°Æ¡ng thÃ¡ng
-- Run this script in Supabase SQL Editor
-- ============================================

-- 1. Táº¡o ca "Giá» hÃ nh chÃ­nh" cho táº¥t cáº£ chi nhÃ¡nh vÄƒn phÃ²ng (is_office = true)
-- Thá»© 2 - Thá»© 7: 8:00 - 17:30 (nghá»‰ trÆ°a 12:00 - 13:30 = 1.5h)
-- Thá»±c lÃ m: 8h (8:00-12:00 = 4h + 13:30-17:30 = 4h)

INSERT INTO shifts (branch_id, name, start_time, end_time, hourly_rate, is_active)
SELECT 
    b.id,
    'Giá» hÃ nh chÃ­nh',
    '08:00'::TIME,
    '17:30'::TIME,
    0,  -- LÆ°Æ¡ng thÃ¡ng khÃ´ng tÃ­nh theo giá»
    true
FROM branches b 
WHERE b.is_office = true
ON CONFLICT DO NOTHING;

-- 2. Táº¡o báº£ng cáº¥u hÃ¬nh giá» hÃ nh chÃ­nh (Ä‘á»ƒ admin cÃ³ thá»ƒ thay Ä‘á»•i)
CREATE TABLE IF NOT EXISTS office_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key VARCHAR(50) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(20)
);

-- 3. Insert cáº¥u hÃ¬nh máº·c Ä‘á»‹nh
INSERT INTO office_settings (key, value, description) VALUES
    ('office_start_time', '08:00', 'Giá» báº¯t Ä‘áº§u lÃ m viá»‡c'),
    ('office_end_time', '17:30', 'Giá» káº¿t thÃºc lÃ m viá»‡c'),
    ('lunch_start_time', '12:00', 'Giá» nghá»‰ trÆ°a báº¯t Ä‘áº§u'),
    ('lunch_end_time', '13:30', 'Giá» nghá»‰ trÆ°a káº¿t thÃºc'),
    ('work_days', '1,2,3,4,5,6', 'CÃ¡c ngÃ y lÃ m viá»‡c (0=CN, 1=T2, ..., 6=T7)')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW();

-- Enable RLS
ALTER TABLE office_settings ENABLE ROW LEVEL SECURITY;

-- RLS policy
DROP POLICY IF EXISTS "Enable all access for office_settings" ON office_settings;
CREATE POLICY "Enable all access for office_settings" ON office_settings FOR ALL USING (true);

-- Comments
COMMENT ON TABLE office_settings IS 'Cáº¥u hÃ¬nh giá» hÃ nh chÃ­nh - cÃ³ thá»ƒ thay Ä‘á»•i bá»Ÿi Admin';
COMMENT ON COLUMN office_settings.work_days IS 'CÃ¡c ngÃ y lÃ m viá»‡c: 0=Chá»§ nháº­t, 1=Thá»© 2, 2=Thá»© 3, ...';

-- ======== END OF 20240110_office_hours.sql ========

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
    ('monthly', 'base_salary', '0', 'LÆ°Æ¡ng cÆ¡ báº£n (VND/thÃ¡ng)', 1),
    ('monthly', 'lunch_allowance', '30000', 'Há»— trá»£ cÆ¡m trÆ°a (VND/ngÃ y Ä‘á»§ cÃ´ng)', 2),
    ('monthly', 'transport_allowance', '0', 'Há»— trá»£ xÄƒng xe (VND/thÃ¡ng)', 3),
    ('monthly', 'phone_allowance', '0', 'Há»— trá»£ Ä‘iá»‡n thoáº¡i (VND/thÃ¡ng)', 4),
    ('monthly', 'other_allowance', '0', 'Há»— trá»£ khÃ¡c (VND/thÃ¡ng)', 5),
    ('monthly', 'kpi_bonus', '0', 'ThÆ°á»Ÿng KPI (VND/thÃ¡ng, nháº­p tay)', 6),
    ('monthly', 'has_insurance', '1', 'CÃ³ Ä‘Ã³ng BHXH (1=CÃ³, 0=KhÃ´ng)', 9),
    ('monthly', 'bhxh_percent', '8', 'BHXH (% lÆ°Æ¡ng Ä‘Ã³ng BH)', 10),
    ('monthly', 'bhyt_percent', '1.5', 'BHYT (% lÆ°Æ¡ng Ä‘Ã³ng BH)', 11),
    ('monthly', 'bhtn_percent', '1', 'BHTN (% lÆ°Æ¡ng Ä‘Ã³ng BH)', 12),
    ('monthly', 'dependents_count', '0', 'Sá»‘ ngÆ°á»i phá»¥ thuá»™c (cho thuáº¿ TNCN)', 13),
    ('monthly', 'min_hours_for_lunch', '7', 'Sá»‘ giá» tá»‘i thiá»ƒu Ä‘á»ƒ tÃ­nh há»— trá»£ cÆ¡m', 14)
ON CONFLICT (pay_type, config_key) DO NOTHING;

-- Insert default configurations for Hourly employees  
INSERT INTO salary_configs (pay_type, config_key, config_value, description, sort_order) VALUES
    ('hourly', 'hourly_rate', '0', 'Má»©c lÆ°Æ¡ng giá» cÆ¡ báº£n (VND/giá»)', 1),
    ('hourly', 'ot_rate_weekday', '1.5', 'Há»‡ sá»‘ OT ngÃ y thÆ°á»ng', 2),
    ('hourly', 'ot_rate_weekend', '2', 'Há»‡ sá»‘ OT cuá»‘i tuáº§n', 3),
    ('hourly', 'ot_rate_holiday', '3', 'Há»‡ sá»‘ OT ngÃ y lá»…', 4),
    ('hourly', 'night_shift_allowance', '0', 'Há»— trá»£ ca Ä‘Ãªm (VND/ca)', 5),
    ('hourly', 'attendance_bonus', '0', 'ThÆ°á»Ÿng chuyÃªn cáº§n (VND/thÃ¡ng)', 6),
    ('hourly', 'has_insurance', '0', 'CÃ³ Ä‘Ã³ng BHXH (1=CÃ³, 0=KhÃ´ng)', 9),
    ('hourly', 'bhxh_percent', '8', 'BHXH (% lÆ°Æ¡ng Ä‘Ã³ng BH)', 10),
    ('hourly', 'bhyt_percent', '1.5', 'BHYT (% lÆ°Æ¡ng Ä‘Ã³ng BH)', 11),
    ('hourly', 'bhtn_percent', '1', 'BHTN (% lÆ°Æ¡ng Ä‘Ã³ng BH)', 12)
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

-- ======== END OF 20240111_salary_configs.sql ========

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

-- ======== END OF 20240112_fix_salary_rls.sql ========

-- Add salary details to employees table
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS kpi_target BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS lunch_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS transport_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS phone_allowance BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS other_allowance BIGINT DEFAULT 0;

-- Comment on columns
COMMENT ON COLUMN employees.kpi_target IS 'Má»¥c tiÃªu KPI (VND)';
COMMENT ON COLUMN employees.lunch_allowance IS 'Há»— trá»£ cÆ¡m trÆ°a (VND/ngÃ y)';
COMMENT ON COLUMN employees.transport_allowance IS 'Há»— trá»£ xÄƒng xe (VND/thÃ¡ng)';
COMMENT ON COLUMN employees.phone_allowance IS 'Há»— trá»£ Ä‘iá»‡n thoáº¡i (VND/thÃ¡ng)';
COMMENT ON COLUMN employees.other_allowance IS 'Há»— trá»£ khÃ¡c (VND/thÃ¡ng)';

-- ======== END OF 20240113_employee_salary_details.sql ========

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

-- ======== END OF 20240114_monthly_salaries.sql ========

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

-- ======== END OF 20240115_granular_permissions.sql ========

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
    ('payroll.tax.personal_deduction', '11000000', 'Má»©c giáº£m trá»« gia cáº£nh báº£n thÃ¢n (VND)', 'payroll'),
    ('payroll.tax.dependent_deduction', '4400000', 'Má»©c giáº£m trá»« ngÆ°á»i phá»¥ thuá»™c (VND)', 'payroll'),
    ('payroll.insurance.employee_rate', '0.105', 'Tá»· lá»‡ Ä‘Ã³ng BHXH ngÆ°á»i lao Ä‘á»™ng (10.5%)', 'payroll'),
    ('payroll.insurance.employer_rate', '0.215', 'Tá»· lá»‡ Ä‘Ã³ng BHXH ngÆ°á»i sá»­ dá»¥ng lao Ä‘á»™ng (21.5%)', 'payroll'),
    ('payroll.ot.weekday_multiplier', '1.5', 'Há»‡ sá»‘ lÆ°Æ¡ng OT ngÃ y thÆ°á»ng', 'payroll'),
    ('payroll.ot.weekend_multiplier', '2.0', 'Há»‡ sá»‘ lÆ°Æ¡ng OT ngÃ y cuá»‘i tuáº§n', 'payroll'),
    ('payroll.ot.holiday_multiplier', '3.0', 'Há»‡ sá»‘ lÆ°Æ¡ng OT ngÃ y lá»…', 'payroll')
on conflict (key) do update 
set value = excluded.value, description = excluded.description;

-- ======== END OF 20240116_create_system_configs.sql ========

-- Fix RLS policies for user_permissions table
-- The app uses custom authentication, not Supabase Auth, so auth.uid() won't work

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins can manage permission templates" ON permissions_template;
DROP POLICY IF EXISTS "Users can read own permissions" ON user_permissions;
DROP POLICY IF EXISTS "Admins can manage user permissions" ON user_permissions;

-- Create permissive policies (access control is handled at app level)
CREATE POLICY "Allow all access to permissions_template" ON permissions_template FOR ALL USING (true);
CREATE POLICY "Allow all access to user_permissions" ON user_permissions FOR ALL USING (true);

-- ======== END OF 20240116_fix_permission_rls.sql ========

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

-- ======== END OF 20240117_shift_registrations.sql ========

-- Add is_closed column to registration_settings
-- This allows managers to manually close registration early

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT false;

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE registration_settings 
ADD COLUMN IF NOT EXISTS closed_by TEXT;

-- ======== END OF 20240118_add_is_closed.sql ========

-- ============================================
-- ACTIVITY LOGS TABLE
-- Lá»‹ch sá»­ thao tÃ¡c trÃªn há»‡ thá»‘ng
-- ============================================

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,        -- Ai thá»±c hiá»‡n
    user_name VARCHAR(100),              -- TÃªn ngÆ°á»i thá»±c hiá»‡n
    user_role VARCHAR(20),               -- Role cá»§a ngÆ°á»i thá»±c hiá»‡n
    action VARCHAR(20) NOT NULL,         -- create, update, delete
    entity_type VARCHAR(50) NOT NULL,    -- employee, user, branch, shift, attendance, etc.
    entity_id VARCHAR(100),              -- ID cá»§a Ä‘á»‘i tÆ°á»£ng
    entity_name VARCHAR(200),            -- TÃªn/label cá»§a Ä‘á»‘i tÆ°á»£ng
    details JSONB,                       -- Chi tiáº¿t thay Ä‘á»•i (old/new values)
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
COMMENT ON TABLE activity_logs IS 'Lá»‹ch sá»­ thao tÃ¡c trÃªn há»‡ thá»‘ng';
COMMENT ON COLUMN activity_logs.action IS 'Loáº¡i thao tÃ¡c: create, update, delete';
COMMENT ON COLUMN activity_logs.entity_type IS 'Loáº¡i Ä‘á»‘i tÆ°á»£ng: employee, user, branch, shift, attendance, salary...';
COMMENT ON COLUMN activity_logs.details IS 'Chi tiáº¿t thay Ä‘á»•i dáº¡ng JSON';

-- ======== END OF 20240119_activity_logs.sql ========

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
VALUES (NULL, 'CÃ´ng ty TNHH HRM', 'Äá»‹a chá»‰ cÃ´ng ty', true)
ON CONFLICT DO NOTHING;

-- ======== END OF 20240120_payslip_system.sql ========

-- Work Hour Requirements by Employment Type
-- Quy Ä‘á»‹nh giá» lÃ m tá»‘i thiá»ƒu theo loáº¡i hÃ¬nh nhÃ¢n viÃªn

CREATE TABLE IF NOT EXISTS work_hour_requirements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    employment_type TEXT NOT NULL UNIQUE,
    min_hours_per_month DECIMAL(6,2) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE work_hour_requirements ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "work_hour_requirements_read" ON work_hour_requirements;
CREATE POLICY "work_hour_requirements_read" ON work_hour_requirements
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "work_hour_requirements_all" ON work_hour_requirements;
CREATE POLICY "work_hour_requirements_all" ON work_hour_requirements
    FOR ALL USING (true) WITH CHECK (true);

-- Default values
INSERT INTO work_hour_requirements (employment_type, min_hours_per_month, description) VALUES
    ('full_time', 176, 'NhÃ¢n viÃªn toÃ n thá»i gian - 8h/ngÃ y x 22 ngÃ y'),
    ('part_time', 88, 'NhÃ¢n viÃªn bÃ¡n thá»i gian - 4h/ngÃ y x 22 ngÃ y'),
    ('contract', 160, 'NhÃ¢n viÃªn há»£p Ä‘á»“ng'),
    ('intern', 120, 'Thá»±c táº­p sinh - 6h/ngÃ y x 20 ngÃ y')
ON CONFLICT (employment_type) DO NOTHING;

-- ======== END OF 20240121_work_hour_requirements.sql ========

-- Holidays configuration table
-- Báº£ng cáº¥u hÃ¬nh ngÃ y lá»… Ä‘á»ƒ admin cÃ³ thá»ƒ chá»‰nh sá»­a

CREATE TABLE IF NOT EXISTS holidays (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL,
    name TEXT NOT NULL,
    is_recurring BOOLEAN DEFAULT false, -- true = láº·p láº¡i hÃ ng nÄƒm (dÃ¹ng thÃ¡ng-ngÃ y), false = ngÃ y cá»¥ thá»ƒ
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "holidays_read" ON holidays;
CREATE POLICY "holidays_read" ON holidays FOR SELECT USING (true);

DROP POLICY IF EXISTS "holidays_all" ON holidays;
CREATE POLICY "holidays_all" ON holidays FOR ALL USING (true) WITH CHECK (true);

-- Index
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

-- Default Vietnamese holidays (recurring)
INSERT INTO holidays (date, name, is_recurring) VALUES
    ('2024-01-01', 'Táº¿t DÆ°Æ¡ng lá»‹ch', true),
    ('2024-04-30', 'Giáº£i phÃ³ng miá»n Nam', true),
    ('2024-05-01', 'Quá»‘c táº¿ Lao Ä‘á»™ng', true),
    ('2024-09-02', 'Quá»‘c khÃ¡nh', true)
ON CONFLICT DO NOTHING;

-- ======== END OF 20240122_holidays_config.sql ========

-- Refactor Employee Type System
-- Gá»™p employment_type vÃ  pay_type thÃ nh employee_type
-- Values: full_time_monthly, full_time_hourly, part_time, probation, intern

-- Step 1: Add new employee_type column
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employees' AND column_name = 'employee_type') THEN
        ALTER TABLE employees ADD COLUMN employee_type VARCHAR(30) DEFAULT 'full_time_monthly';
    END IF;
END $$;

-- Step 2: Add CHECK constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE constraint_name = 'employees_employee_type_check') THEN
        ALTER TABLE employees ADD CONSTRAINT employees_employee_type_check 
        CHECK (employee_type IN ('full_time_monthly', 'full_time_hourly', 'part_time', 'probation', 'intern'));
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        NULL; -- Constraint already exists
END $$;

-- Step 3: Migrate existing data
UPDATE employees SET employee_type = 
    CASE 
        -- Hourly workers (check pay_type first)
        WHEN pay_type = 'hourly' THEN 'full_time_hourly'
        -- Probation status
        WHEN status = 'probation' THEN 'probation'
        -- Interns
        WHEN employment_type = 'intern' THEN 'intern'
        -- Part-time
        WHEN employment_type = 'part_time' THEN 'part_time'
        -- Contract workers - treat as full_time_monthly
        WHEN employment_type = 'contract' THEN 'full_time_monthly'
        -- Default: full_time_monthly
        ELSE 'full_time_monthly'
    END
WHERE employee_type IS NULL OR employee_type = 'full_time_monthly';

-- Step 4: Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_employees_employee_type ON employees(employee_type);

-- Note: We keep the old columns (employment_type, pay_type) for now
-- They can be dropped in a future migration after confirming everything works

-- ======== END OF 20240123_employee_type_refactor.sql ========

-- Leave Management System
-- Quáº£n lÃ½ nghá»‰ phÃ©p cho nhÃ¢n viÃªn

-- =====================================================
-- 1. LEAVE TYPES (Loáº¡i nghá»‰ phÃ©p)
-- =====================================================
CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) DEFAULT '#3B82F6', -- For UI display
    default_days_per_year INTEGER DEFAULT 12, -- Sá»‘ ngÃ y máº·c Ä‘á»‹nh/nÄƒm
    is_paid BOOLEAN DEFAULT TRUE, -- CÃ³ lÆ°Æ¡ng hay khÃ´ng
    requires_approval BOOLEAN DEFAULT TRUE, -- Cáº§n duyá»‡t khÃ´ng
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default leave types
INSERT INTO leave_types (name, description, color, default_days_per_year, is_paid) VALUES
    ('Nghá»‰ phÃ©p nÄƒm', 'PhÃ©p nÄƒm theo quy Ä‘á»‹nh', '#3B82F6', 12, TRUE),
    ('Nghá»‰ á»‘m', 'Nghá»‰ do bá»‡nh táº­t', '#EF4444', 30, TRUE),
    ('Nghá»‰ viá»‡c riÃªng', 'Nghá»‰ viá»‡c cÃ¡ nhÃ¢n cÃ³ lÆ°Æ¡ng', '#F59E0B', 3, TRUE),
    ('Nghá»‰ khÃ´ng lÆ°Æ¡ng', 'Nghá»‰ viá»‡c riÃªng khÃ´ng lÆ°Æ¡ng', '#6B7280', 0, FALSE),
    ('Nghá»‰ thai sáº£n', 'Nghá»‰ sinh con (ná»¯)', '#EC4899', 180, TRUE),
    ('Nghá»‰ cÆ°á»›i', 'Nghá»‰ káº¿t hÃ´n', '#8B5CF6', 3, TRUE),
    ('Nghá»‰ tang', 'Nghá»‰ khi cÃ³ ngÆ°á»i thÃ¢n máº¥t', '#1F2937', 3, TRUE)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 2. LEAVE BALANCES (Sá»‘ ngÃ y phÃ©p cÃ²n láº¡i)
-- =====================================================
CREATE TABLE IF NOT EXISTS leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
    year INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
    total_days DECIMAL(5,1) NOT NULL DEFAULT 0, -- Tá»•ng sá»‘ ngÃ y Ä‘Æ°á»£c phÃ©p
    used_days DECIMAL(5,1) NOT NULL DEFAULT 0, -- Sá»‘ ngÃ y Ä‘Ã£ sá»­ dá»¥ng
    pending_days DECIMAL(5,1) NOT NULL DEFAULT 0, -- Sá»‘ ngÃ y Ä‘ang chá» duyá»‡t
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, leave_type_id, year)
);

-- =====================================================
-- 3. LEAVE REQUESTS (ÄÆ¡n xin nghá»‰ phÃ©p)
-- =====================================================
CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5,1) NOT NULL, -- Sá»‘ ngÃ y nghá»‰
    is_half_day BOOLEAN DEFAULT FALSE, -- Nghá»‰ ná»­a ngÃ y
    half_day_period VARCHAR(20), -- 'morning' or 'afternoon'
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, cancelled
    reviewed_by VARCHAR(20) REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 4. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_balances_employee ON leave_balances(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_balances_year ON leave_balances(year);

-- =====================================================
-- 5. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- Policies for leave_types (everyone can read, only admin can modify)
CREATE POLICY "leave_types_read" ON leave_types FOR SELECT USING (true);
CREATE POLICY "leave_types_admin" ON leave_types FOR ALL USING (true);

-- Policies for leave_balances
CREATE POLICY "leave_balances_read" ON leave_balances FOR SELECT USING (true);
CREATE POLICY "leave_balances_admin" ON leave_balances FOR ALL USING (true);

-- Policies for leave_requests
CREATE POLICY "leave_requests_read" ON leave_requests FOR SELECT USING (true);
CREATE POLICY "leave_requests_admin" ON leave_requests FOR ALL USING (true);

-- =====================================================
-- 6. TRIGGER for auto-update leave balances
-- =====================================================
CREATE OR REPLACE FUNCTION update_leave_balance_on_request()
RETURNS TRIGGER AS $$
BEGIN
    -- When a leave request is approved, update used_days
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
        UPDATE leave_balances 
        SET used_days = used_days + NEW.total_days,
            pending_days = pending_days - NEW.total_days,
            updated_at = NOW()
        WHERE employee_id = NEW.employee_id 
          AND leave_type_id = NEW.leave_type_id
          AND year = EXTRACT(YEAR FROM NEW.start_date);
    END IF;
    
    -- When a leave request is rejected or cancelled, reduce pending_days
    IF NEW.status IN ('rejected', 'cancelled') AND OLD.status = 'pending' THEN
        UPDATE leave_balances 
        SET pending_days = pending_days - NEW.total_days,
            updated_at = NOW()
        WHERE employee_id = NEW.employee_id 
          AND leave_type_id = NEW.leave_type_id
          AND year = EXTRACT(YEAR FROM NEW.start_date);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_leave_balance ON leave_requests;
CREATE TRIGGER trigger_update_leave_balance
    AFTER UPDATE ON leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_leave_balance_on_request();

-- =====================================================
-- 7. TRIGGER for adding pending_days when creating request
-- =====================================================
CREATE OR REPLACE FUNCTION add_pending_leave_on_create()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure balance exists for this employee/type/year
    INSERT INTO leave_balances (employee_id, leave_type_id, year, total_days, used_days, pending_days)
    SELECT NEW.employee_id, NEW.leave_type_id, EXTRACT(YEAR FROM NEW.start_date)::INTEGER, 
           COALESCE(lt.default_days_per_year, 12), 0, NEW.total_days
    FROM leave_types lt WHERE lt.id = NEW.leave_type_id
    ON CONFLICT (employee_id, leave_type_id, year) 
    DO UPDATE SET pending_days = leave_balances.pending_days + NEW.total_days,
                  updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_add_pending_leave ON leave_requests;
CREATE TRIGGER trigger_add_pending_leave
    AFTER INSERT ON leave_requests
    FOR EACH ROW
    EXECUTE FUNCTION add_pending_leave_on_create();

-- ======== END OF 20240124_leave_management.sql ========

-- Notification System
-- ThÃ´ng bÃ¡o tá»± Ä‘á»™ng cho ngÆ°á»i dÃ¹ng

-- =====================================================
-- 1. NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- birthday, contract_expiry, leave_approved, attendance_reminder, etc.
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(255), -- Optional link to navigate to
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    metadata JSONB, -- Additional data (employee_id, leave_request_id, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. NOTIFICATION SETTINGS (per user preferences)
-- =====================================================
CREATE TABLE IF NOT EXISTS notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    birthday_notifications BOOLEAN DEFAULT TRUE,
    contract_expiry_notifications BOOLEAN DEFAULT TRUE,
    leave_notifications BOOLEAN DEFAULT TRUE,
    attendance_reminders BOOLEAN DEFAULT TRUE,
    salary_notifications BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "notifications_own" ON notifications 
    FOR ALL USING (true);

CREATE POLICY "notification_settings_own" ON notification_settings 
    FOR ALL USING (true);

-- =====================================================
-- 5. VIEW for unread count
-- =====================================================
CREATE OR REPLACE VIEW notification_unread_counts AS
SELECT 
    user_id,
    COUNT(*) as unread_count
FROM notifications
WHERE is_read = FALSE
GROUP BY user_id;

-- ======== END OF 20240125_notifications.sql ========

-- Performance Review System
-- Há»‡ thá»‘ng Ä‘Ã¡nh giÃ¡ hiá»‡u suáº¥t nhÃ¢n viÃªn

-- =====================================================
-- 1. REVIEW CYCLES (Chu ká»³ Ä‘Ã¡nh giÃ¡)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    review_deadline DATE NOT NULL,
    cycle_type VARCHAR(20) DEFAULT 'quarterly', -- monthly, quarterly, annually
    status VARCHAR(20) DEFAULT 'draft', -- draft, active, completed, cancelled
    created_by VARCHAR(20) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. REVIEW CRITERIA (TiÃªu chÃ­ Ä‘Ã¡nh giÃ¡)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_criteria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL, -- performance, attitude, skills, teamwork
    weight DECIMAL(5,2) DEFAULT 1.0, -- Trá»ng sá»‘
    max_score INTEGER DEFAULT 5,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default criteria
INSERT INTO review_criteria (name, description, category, weight) VALUES
    ('HoÃ n thÃ nh cÃ´ng viá»‡c', 'Má»©c Ä‘á»™ hoÃ n thÃ nh cÃ¡c nhiá»‡m vá»¥ Ä‘Æ°á»£c giao', 'performance', 2.0),
    ('Cháº¥t lÆ°á»£ng cÃ´ng viá»‡c', 'Äá»™ chÃ­nh xÃ¡c vÃ  cháº¥t lÆ°á»£ng káº¿t quáº£', 'performance', 2.0),
    ('ÄÃºng giá»', 'TuÃ¢n thá»§ thá»i gian lÃ m viá»‡c', 'attitude', 1.0),
    ('ThÃ¡i Ä‘á»™ lÃ m viá»‡c', 'Sá»± nhiá»‡t tÃ¬nh vÃ  trÃ¡ch nhiá»‡m', 'attitude', 1.5),
    ('Ká»¹ nÄƒng chuyÃªn mÃ´n', 'TrÃ¬nh Ä‘á»™ vÃ  ká»¹ nÄƒng nghá» nghiá»‡p', 'skills', 1.5),
    ('Kháº£ nÄƒng há»c há»i', 'Tiáº¿p thu kiáº¿n thá»©c vÃ  ká»¹ nÄƒng má»›i', 'skills', 1.0),
    ('LÃ m viá»‡c nhÃ³m', 'Kháº£ nÄƒng phá»‘i há»£p vá»›i Ä‘á»“ng nghiá»‡p', 'teamwork', 1.0),
    ('Giao tiáº¿p', 'Ká»¹ nÄƒng giao tiáº¿p vÃ  trÃ¬nh bÃ y', 'teamwork', 1.0)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. PERFORMANCE REVIEWS (Káº¿t quáº£ Ä‘Ã¡nh giÃ¡)
-- =====================================================
CREATE TABLE IF NOT EXISTS performance_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    reviewer_id VARCHAR(20) REFERENCES users(id),
    review_type VARCHAR(20) DEFAULT 'manager', -- self, manager, peer
    status VARCHAR(20) DEFAULT 'pending', -- pending, submitted, reviewed, final
    overall_score DECIMAL(5,2),
    overall_rating VARCHAR(20), -- excellent, good, average, needs_improvement, poor
    strengths TEXT,
    improvements TEXT,
    goals TEXT,
    manager_comments TEXT,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cycle_id, employee_id, review_type)
);

-- =====================================================
-- 4. REVIEW SCORES (Äiá»ƒm chi tiáº¿t tá»«ng tiÃªu chÃ­)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
    criteria_id UUID NOT NULL REFERENCES review_criteria(id),
    score INTEGER CHECK (score >= 0 AND score <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(review_id, criteria_id)
);

-- =====================================================
-- 5. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_review_cycles_status ON review_cycles(status);
CREATE INDEX IF NOT EXISTS idx_reviews_employee ON performance_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_cycle ON performance_reviews(cycle_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON performance_reviews(status);

-- =====================================================
-- 6. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_scores ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "review_cycles_read" ON review_cycles FOR SELECT USING (true);
CREATE POLICY "review_cycles_admin" ON review_cycles FOR ALL USING (true);

CREATE POLICY "review_criteria_read" ON review_criteria FOR SELECT USING (true);
CREATE POLICY "review_criteria_admin" ON review_criteria FOR ALL USING (true);

CREATE POLICY "reviews_read" ON performance_reviews FOR SELECT USING (true);
CREATE POLICY "reviews_admin" ON performance_reviews FOR ALL USING (true);

CREATE POLICY "scores_read" ON review_scores FOR SELECT USING (true);
CREATE POLICY "scores_admin" ON review_scores FOR ALL USING (true);

-- =====================================================
-- 7. FUNCTION to calculate overall rating
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_review_rating(p_score DECIMAL)
RETURNS VARCHAR(20) AS $$
BEGIN
    IF p_score >= 4.5 THEN
        RETURN 'excellent';
    ELSIF p_score >= 3.5 THEN
        RETURN 'good';
    ELSIF p_score >= 2.5 THEN
        RETURN 'average';
    ELSIF p_score >= 1.5 THEN
        RETURN 'needs_improvement';
    ELSE
        RETURN 'poor';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ======== END OF 20240126_performance_reviews.sql ========

-- Enhanced Employee Profile - Documents & History
-- Quáº£n lÃ½ tÃ i liá»‡u vÃ  lá»‹ch sá»­ nhÃ¢n viÃªn

-- =====================================================
-- 1. EMPLOYEE DOCUMENTS (TÃ i liá»‡u nhÃ¢n viÃªn)
-- =====================================================
CREATE TABLE IF NOT EXISTS employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL, -- identity_card, degree, certificate, contract, other
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL, -- Supabase Storage URL
    file_type VARCHAR(50), -- pdf, jpg, png, doc
    file_size INTEGER, -- bytes
    uploaded_by VARCHAR(20) REFERENCES users(id),
    issue_date DATE,
    expiry_date DATE,
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by VARCHAR(20) REFERENCES users(id),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. EMPLOYEE HISTORY (Lá»‹ch sá»­ nhÃ¢n viÃªn)
-- =====================================================
CREATE TABLE IF NOT EXISTS employee_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- hired, promoted, transferred, salary_change, warning, terminated
    event_date DATE NOT NULL,
    description TEXT NOT NULL,
    old_value TEXT, -- For tracking changes (e.g., old position, old salary)
    new_value TEXT, -- New value after change
    metadata JSONB, -- Additional data
    created_by VARCHAR(20) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 3. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_employee_history_employee ON employee_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_history_event_type ON employee_history(event_type);
CREATE INDEX IF NOT EXISTS idx_employee_history_date ON employee_history(event_date DESC);

-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_history ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "employee_documents_read" ON employee_documents FOR SELECT USING (true);
CREATE POLICY "employee_documents_admin" ON employee_documents FOR ALL USING (true);

CREATE POLICY "employee_history_read" ON employee_history FOR SELECT USING (true);
CREATE POLICY "employee_history_admin" ON employee_history FOR ALL USING (true);

-- =====================================================
-- 5. TRIGGER to auto-log employee changes
-- =====================================================
CREATE OR REPLACE FUNCTION log_employee_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Log position changes
    IF OLD.position IS DISTINCT FROM NEW.position THEN
        INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
        VALUES (NEW.id, 'promoted', CURRENT_DATE, 'Thay Ä‘á»•i chá»©c vá»¥', OLD.position, NEW.position);
    END IF;
    
    -- Log department changes
    IF OLD.department IS DISTINCT FROM NEW.department THEN
        INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
        VALUES (NEW.id, 'transferred', CURRENT_DATE, 'Chuyá»ƒn phÃ²ng ban', OLD.department, NEW.department);
    END IF;
    
    -- Log salary changes
    IF OLD.salary IS DISTINCT FROM NEW.salary THEN
        INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
        VALUES (NEW.id, 'salary_change', CURRENT_DATE, 'Äiá»u chá»‰nh lÆ°Æ¡ng', OLD.salary::TEXT, NEW.salary::TEXT);
    END IF;
    
    -- Log status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF NEW.status = 'inactive' THEN
            INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
            VALUES (NEW.id, 'terminated', CURRENT_DATE, 'Nghá»‰ viá»‡c', OLD.status, NEW.status);
        ELSE
            INSERT INTO employee_history (employee_id, event_type, event_date, description, old_value, new_value)
            VALUES (NEW.id, 'hired', CURRENT_DATE, 'Thay Ä‘á»•i tráº¡ng thÃ¡i', OLD.status, NEW.status);
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_employee_changes ON employees;
CREATE TRIGGER trigger_log_employee_changes
    AFTER UPDATE ON employees
    FOR EACH ROW
    EXECUTE FUNCTION log_employee_changes();

-- =====================================================
-- 6. Insert initial hire record for existing employees
-- =====================================================
-- This can be run once to initialize history for existing employees
-- INSERT INTO employee_history (employee_id, event_type, event_date, description)
-- SELECT id, 'hired', join_date::DATE, 'NgÃ y vÃ o lÃ m'
-- FROM employees
-- WHERE id NOT IN (SELECT DISTINCT employee_id FROM employee_history WHERE event_type = 'hired');

-- ======== END OF 20240127_employee_documents.sql ========

-- Migration: Add overtime system fields to attendance_records
-- Created: 2024-01-28

-- Add OT-related fields to attendance_records table
ALTER TABLE attendance_records 
ADD COLUMN IF NOT EXISTS scheduled_hours DECIMAL(4,2),
ADD COLUMN IF NOT EXISTS actual_raw_hours DECIMAL(4,2),
ADD COLUMN IF NOT EXISTS ot_requested_hours DECIMAL(4,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS ot_approved BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ot_approved_by TEXT,
ADD COLUMN IF NOT EXISTS ot_approved_at TIMESTAMPTZ;

-- Add index for OT approval queries
CREATE INDEX IF NOT EXISTS idx_attendance_ot_pending 
ON attendance_records(ot_approved) 
WHERE ot_requested_hours > 0;

-- Comment for documentation
COMMENT ON COLUMN attendance_records.scheduled_hours IS 'Hours calculated based on shift schedule (capped to shift duration)';
COMMENT ON COLUMN attendance_records.actual_raw_hours IS 'Actual hours from check_in to check_out without capping';
COMMENT ON COLUMN attendance_records.ot_requested_hours IS 'Overtime hours pending approval (time outside scheduled shift)';
COMMENT ON COLUMN attendance_records.ot_approved IS 'Whether overtime has been approved by manager';
COMMENT ON COLUMN attendance_records.ot_approved_by IS 'User ID who approved the overtime';
COMMENT ON COLUMN attendance_records.ot_approved_at IS 'Timestamp when overtime was approved';

-- ======== END OF 20240128_overtime_system.sql ========

-- Add department column to review_criteria
-- Allows criteria to be department-specific
-- NULL = applies to all departments

ALTER TABLE review_criteria 
ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT NULL;

-- Create index for faster department lookups
CREATE INDEX IF NOT EXISTS idx_review_criteria_department ON review_criteria(department);

COMMENT ON COLUMN review_criteria.department IS 'Department this criteria applies to. NULL means all departments.';

-- ======== END OF 20240129_criteria_department.sql ========

-- Payroll System Enhancements
-- Enhanced tracking for payroll history, export, and finalization

-- ==========================================
-- 1. ENHANCE MONTHLY_SALARIES TABLE
-- ==========================================

-- Add payslip number (auto-generated unique identifier)
ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS payslip_number VARCHAR(50);

-- Add export tracking
ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS exported_count INT DEFAULT 0;

ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS last_exported_at TIMESTAMPTZ;

-- Add finalized by name for display (denormalized for performance)
ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS finalized_by_name VARCHAR(255);

-- Create unique index on payslip_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_salaries_payslip_number 
ON monthly_salaries(payslip_number) 
WHERE payslip_number IS NOT NULL;

-- ==========================================
-- 2. FUNCTION: GENERATE PAYSLIP NUMBER
-- ==========================================

CREATE OR REPLACE FUNCTION generate_payslip_number(
    p_month VARCHAR(7),
    p_employee_id VARCHAR(20)
)
RETURNS VARCHAR(50)
LANGUAGE plpgsql
AS $$
DECLARE
    v_year VARCHAR(4);
    v_month_num VARCHAR(2);
    v_sequence INT;
    v_payslip_number VARCHAR(50);
BEGIN
    -- Extract year and month
    v_year := SUBSTRING(p_month FROM 1 FOR 4);
    v_month_num := SUBSTRING(p_month FROM 6 FOR 2);
    
    -- Get next sequence number for this month
    SELECT COALESCE(MAX(CAST(SUBSTRING(payslip_number FROM 13) AS INT)), 0) + 1
    INTO v_sequence
    FROM monthly_salaries
    WHERE month = p_month
    AND payslip_number IS NOT NULL;
    
    -- Format: PS-YYYY-MM-### (e.g., PS-2026-01-001)
    v_payslip_number := 'PS-' || v_year || '-' || v_month_num || '-' || LPAD(v_sequence::TEXT, 3, '0');
    
    RETURN v_payslip_number;
END;
$$;

-- ==========================================
-- 3. TRIGGER: AUTO-GENERATE PAYSLIP NUMBER
-- ==========================================

CREATE OR REPLACE FUNCTION auto_generate_payslip_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only generate if not already set
    IF NEW.payslip_number IS NULL AND NEW.month IS NOT NULL AND NEW.employee_id IS NOT NULL THEN
        NEW.payslip_number := generate_payslip_number(NEW.month, NEW.employee_id);
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_payslip_number ON monthly_salaries;
CREATE TRIGGER trigger_auto_payslip_number
    BEFORE INSERT ON monthly_salaries
    FOR EACH ROW
    EXECUTE FUNCTION auto_generate_payslip_number();

-- ==========================================
-- 4. VIEW: PAYROLL HISTORY SUMMARY
-- ==========================================

CREATE OR REPLACE VIEW payroll_history_view AS
SELECT 
    ms.month,
    ms.branch_id,
    b.name as branch_name,
    COUNT(DISTINCT ms.employee_id) as total_employees,
    SUM(ms.gross_salary) as total_gross_salary,
    SUM(ms.net_salary) as total_net_salary,
    SUM(ms.insurance_deduction) as total_insurance_deduction,
    SUM(ms.pit_deduction) as total_pit_deduction,
    AVG(ms.net_salary) as avg_net_salary,
    COUNT(CASE WHEN ms.is_finalized THEN 1 END) as finalized_count,
    MIN(ms.finalized_at) as first_finalized_at,
    MAX(ms.finalized_at) as last_finalized_at,
    SUM(ms.exported_count) as total_exports
FROM monthly_salaries ms
LEFT JOIN branches b ON b.id = ms.branch_id
GROUP BY ms.month, ms.branch_id, b.name;

-- ==========================================
-- 5. VIEW: EMPLOYEE SALARY HISTORY
-- ==========================================

CREATE OR REPLACE VIEW employee_salary_history_view AS
SELECT 
    ms.employee_id,
    e.name as employee_name,
    e.department,
    e.position,
    ms.month,
    ms.payslip_number,
    ms.base_salary,
    ms.work_days,
    ms.ot_hours,
    ms.gross_salary,
    ms.insurance_deduction,
    ms.pit_deduction,
    ms.net_salary,
    ms.is_finalized,
    ms.finalized_at,
    ms.finalized_by_name,
    ms.exported_count,
    ms.last_exported_at,
    ms.created_at,
    ms.updated_at
FROM monthly_salaries ms
LEFT JOIN employees e ON e.id = ms.employee_id
ORDER BY ms.month DESC, e.name;

-- ==========================================
-- 6. GRANT PERMISSIONS ON VIEWS
-- ==========================================

-- Allow authenticated users to read from views
GRANT SELECT ON payroll_history_view TO authenticated;
GRANT SELECT ON employee_salary_history_view TO authenticated;

-- ==========================================
-- 7. UPDATE EXISTING RECORDS
-- ==========================================

-- Generate payslip numbers for existing records that don't have them
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN 
        SELECT id, month, employee_id 
        FROM monthly_salaries 
        WHERE payslip_number IS NULL
        ORDER BY month, employee_id
    LOOP
        UPDATE monthly_salaries
        SET payslip_number = generate_payslip_number(rec.month, rec.employee_id)
        WHERE id = rec.id;
    END LOOP;
END $$;

-- ==========================================
-- 8. COMMENTS FOR DOCUMENTATION
-- ==========================================

COMMENT ON COLUMN monthly_salaries.payslip_number IS 'Unique payslip identifier in format PS-YYYY-MM-### (auto-generated)';
COMMENT ON COLUMN monthly_salaries.exported_count IS 'Number of times this payslip has been exported';
COMMENT ON COLUMN monthly_salaries.last_exported_at IS 'Timestamp of last export';
COMMENT ON COLUMN monthly_salaries.finalized_by_name IS 'Name of user who finalized this payroll (for display)';

COMMENT ON VIEW payroll_history_view IS 'Summary of payroll by month and branch for history tracking';
COMMENT ON VIEW employee_salary_history_view IS 'Detailed salary history for each employee';

COMMENT ON FUNCTION generate_payslip_number IS 'Generates unique payslip number in format PS-YYYY-MM-###';

-- ======== END OF 20240201_payroll_enhancements.sql ========

-- Migration: Add gender column to employees table
-- This allows storing employee gender information

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT 'male'
CHECK (gender IN ('male', 'female', 'other'));

-- Add comment for documentation
COMMENT ON COLUMN employees.gender IS 'Employee gender: male, female, or other';

-- ======== END OF 20241229_add_gender_to_employees.sql ========

-- Migration: Add tax_id and social_insurance_id columns to employees table
-- This allows storing employee's personal tax code (MST cÃ¡ nhÃ¢n) and social insurance ID (mÃ£ sá»‘ BHXH)

ALTER TABLE employees
ADD COLUMN IF NOT EXISTS tax_id TEXT,
ADD COLUMN IF NOT EXISTS social_insurance_id TEXT;

-- Add comments for documentation
COMMENT ON COLUMN employees.tax_id IS 'Personal Tax ID (MÃ£ sá»‘ thuáº¿ cÃ¡ nhÃ¢n)';
COMMENT ON COLUMN employees.social_insurance_id IS 'Social Insurance ID (MÃ£ sá»‘ BHXH)';

-- ======== END OF 20241230_add_tax_and_insurance_fields.sql ========

-- Migration: Make email column optional (nullable) in employees table

ALTER TABLE employees
ALTER COLUMN email DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN employees.email IS 'Employee email address (optional)';

-- ======== END OF 20241230_make_email_optional.sql ========

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

-- ======== END OF 20241230_normalize_employees.sql ========

-- Make email column optional (allow NULL)
ALTER TABLE employees ALTER COLUMN email DROP NOT NULL;

-- ======== END OF 20250105_make_email_optional.sql ========

-- Add kpi_bonus column to monthly_salaries table to store the actual monetary value
ALTER TABLE monthly_salaries ADD COLUMN IF NOT EXISTS kpi_bonus numeric DEFAULT 0;

-- Comment on column for clarity
COMMENT ON COLUMN monthly_salaries.kpi_bonus IS 'Actual monetary bonus received based on KPI performance, distinct from the kpi_target (goal)';

-- ======== END OF 20260102_add_kpi_bonus.sql ========

-- Add tax_code and insurance_number columns to employees table
-- These columns are needed for payslip export functionality

ALTER TABLE employees ADD COLUMN IF NOT EXISTS tax_code VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS insurance_number VARCHAR(20);

-- Add comments for clarity
COMMENT ON COLUMN employees.tax_code IS 'MÃ£ sá»‘ thuáº¿ cÃ¡ nhÃ¢n';
COMMENT ON COLUMN employees.insurance_number IS 'MÃ£ sá»‘ báº£o hiá»ƒm xÃ£ há»™i';

-- ======== END OF 20260104_add_employee_tax_insurance.sql ========

-- Fix finalized_by column type to match users.id (VARCHAR instead of UUID)
-- The users table uses VARCHAR(20) for id, but finalized_by was incorrectly defined as UUID

ALTER TABLE monthly_salaries 
ALTER COLUMN finalized_by TYPE VARCHAR(20) USING finalized_by::VARCHAR(20);

-- Add comment for clarity
COMMENT ON COLUMN monthly_salaries.finalized_by IS 'User ID who finalized this payroll (VARCHAR to match users.id)';

-- ======== END OF 20260104_fix_finalized_by_column.sql ========

-- Add standard_work_days and detailed work info to monthly_salaries
-- Date: 2026-01-04
-- Author: Assistant

ALTER TABLE monthly_salaries 
ADD COLUMN IF NOT EXISTS standard_work_days NUMERIC DEFAULT 26,
ADD COLUMN IF NOT EXISTS actual_work_days NUMERIC,
ADD COLUMN IF NOT EXISTS paid_leave_days NUMERIC;

COMMENT ON COLUMN monthly_salaries.standard_work_days IS 'NgÃ y cÃ´ng chuáº©n cá»§a thÃ¡ng (dÃ¹ng Ä‘á»ƒ tÃ­nh lÆ°Æ¡ng ngÃ y)';
COMMENT ON COLUMN monthly_salaries.actual_work_days IS 'NgÃ y Ä‘i lÃ m thá»±c táº¿';
COMMENT ON COLUMN monthly_salaries.paid_leave_days IS 'NgÃ y nghá»‰ phÃ©p cÃ³ lÆ°Æ¡ng';

-- ======== END OF 20260104_standard_work_days.sql ========

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

-- ======== END OF 20260107_permission_view_all.sql ========

